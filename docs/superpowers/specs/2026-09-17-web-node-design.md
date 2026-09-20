# web-node — 在浏览器里运行 Node.js 源码

- **日期**：2026-09-17
- **状态**：MVP 已实现并验证
- **上游源码**：`/Users/tangjianghong/Downloads/node`（Node.js v26.9.1，`v26.x`，`7a3437d9986`）
- **项目位置**：`/Users/tangjianghong/Downloads/web-node`

---

## 1. 目标与范围

### 目标
让 Node.js 源码在浏览器标签页内运行，形态对齐 StackBlitz WebContainers：**毫秒级启动、零服务端、离线可用**。

### 参考事实（调查结论）
WebContainer **不是**"把 Node 编译成 WASM"。它的真实做法是：

1. **JS 层跑在浏览器自己的 JS 引擎上**（不搬 V8），只有原生/syscall 层编译成 wasm；
2. `internalBinding()` 是唯一的"引擎替换点"，背后接 wasm 层的 fs / net / timer / process；
3. 虚拟文件系统 + ServiceWorker 虚拟 TCP；
4. 自研 npm client。

我们的 γ 路线与它同构，只是把 wasm 原生层**先用 TypeScript 实现**，将来按热点替换为 wasm。

### MVP 范围（本次交付）
- ✅ 纯 JS 运行层：bootstrap、realm、模块 loader（CJS + ESM 子集）
- ✅ 虚拟文件系统：内存目录树 + OPFS 持久化
- ❌ 里程碑 3：ServiceWorker 虚拟网络
- ❌ 里程碑 4：npm client
- ❌ 里程碑 5：真实构建工具（vite/webpack）

---

## 2. 架构

```
主线程 Main Thread
  UI (原生 DOM)  ──  RuntimeClient  ──┐
                                     │ MessagePort（结构化克隆）
═════════════════════════════════════▼═══════════════════════════
Runtime Worker (Dedicated Web Worker)
  ┌───────────────────────────────────────────────────────────┐
  │ bootstrap：bindings → realm → primordials → core → global  │
  ├───────────────────────────────────────────────────────────┤
  │ ModuleLoader (CJS + ESM 子集)                              │
  ├───────────────────────────────────────────────────────────┤
  │ Realm：internalBinding 分发表 + builtin 注册表              │
  │   ├── 真 Node 源码（vendored，8 个文件）                    │
  │   └── TS 实现（buffer/fs/events/util/...）                  │
  ├───────────────────────────────────────────────────────────┤
  │ bindings (TS)：fs/timers/buffer/util/config/constants/...   │
  ├───────────────────────────────────────────────────────────┤
  │ VFS：内存目录树（权威） ──write-behind──▶ OPFS（持久化）     │
  └───────────────────────────────────────────────────────────┘
```

### 关键决策
| 决策 | 理由 |
|---|---|
| 运行时放 Dedicated Worker | 不阻塞 UI；OPFS 同步句柄仅 Worker 可用；为将来 SharedArrayBuffer/Atomics 留位 |
| "进程" = 独立 realm，不做真多进程 | 与 WebContainer 一致的取舍；`child_process` 直接 not-implemented |
| 白名单外一律抛结构化错误 | 绝不返回 `undefined`，避免"诡异崩溃" |
| binding 只认 VFS 接口 | 每层可独立测试，后端可替换 |
| 用户模块用**参数注入**沙箱全局 | 避免污染宿主 `globalThis`（Vitest 下尤其重要）；`installGlobals` 可关 |

---

## 3. 运行时核心

### Bootstrap 顺序
```
primordials.js（真源码）→ domexception.js / messageport.js（真源码）
  → Realm：注册 internalBinding 分发表 + builtin 解析器
  → process / console / Buffer
  → ModuleLoader + 沙箱全局注入
  → 执行用户入口
```

### 模块系统
- **CJS**：自研 resolver（builtin 优先 → 相对/绝对路径 → `node_modules` 逐级向上 → 目录 `package.json#main` / `index.js`），按绝对路径缓存。
- **ESM**：静态 `import` / `export` → CJS 转换（`src/node-runtime/loader/esm-transform.ts`）。
  - 支持：`import x from`、`import {a} from`、`import * as`、`import 'm'`、`export default/const/function/class`、`export {}`、`export * from`。
  - **不支持**：top-level await、live bindings、`import.meta.resolve`。

### "引擎替换点"
`Realm.internalBinding(name)` 是唯一接管点。命中白名单 → 返回 TS 实现；否则抛 `NotImplementedError`（带 binding 名与提示）。

---

## 4. Binding 白名单

| binding | 实现来源 | 内容 |
|---|---|---|
| `config` | TS | 平台/特性静态开关 |
| `constants` | TS（由 VFS errno 派生） | errno / open flags / signals |
| `types` | TS | 全部 `is*` 类型断言 |
| `fs` | TS + VFS | fd 表 + 同步原语 + nextTick 回调变体 |
| `timers` | TS | setTimeout/Interval/Immediate + 高精度时间源 |
| `util` | TS | `getOwnNonIndexProperties` / `getConstructorName` 等 |
| `buffer` | TS | atob/btoa 桥 + isAscii/isUtf8 |
| `symbols` | TS | 内部 symbol 表 |
| `errors` | TS | source-map / uncaught 挂钩（空实现） |
| `performance` | TS | `performance.now()` |
| `process_methods` | TS | cwd/chdir/exit/umask |
| `os` | TS | 静态宿主事实 |
| `string_decoder` | TS | decode 占位 |
| `icu` / `messaging` / `uv` | TS | 最小满足 |

**明确不支持**（抛错）：`crypto`、`zlib`、`tcp_wrap`、`udp_wrap`、`stream_wrap`、`worker`、`inspector`、`sea`、`ffi`、`quic`、`cares_wrap`、`http_parser` 等。

---

## 5. Vendored 真 Node 源码

由 `tools/vendor.mjs` 复制，`vendor/node-lib/MANIFEST.json` 记录 **上游 commit + 上游 sha256 + 产物 sha256 + 补丁说明**。

| 文件 | 说明 |
|---|---|
| `internal/per_context/primordials.js` | 零依赖，**3 处补丁**（见下） |
| `internal/per_context/domexception.js` | 零依赖 |
| `internal/per_context/messageport.js` | 零依赖 |
| `internal/constants.js` | 字符常量表 |
| `internal/encoding/util.js` | 编码工具 |
| `internal/querystring.js` | 依赖 shim `internal/errors` |
| `path.js` | 真实 Node path，依赖 3 个 shim |
| `querystring.js` | 真实 Node querystring |

### 补丁（全部记录在 MANIFEST）
`primordials.js`：引擎缺少 `Float16Array` / `Iterator` 时跳过而非崩溃（3 处，语义等价）。这是**唯一**对真源码的修改。

### 为什么其余不 vendored
`internal/errors.js` 是环形依赖枢纽（errors ↔ util ↔ inspect ↔ validators），全量 vendoring 会牵出 231 个文件。因此 `internal/errors` / `internal/fs/glob` / `internal/errors/error_source` / `internal/encoding` / `internal/util/trace_sigint` 由我们提供**最小等价 shim**（`src/node-runtime/builtins/internal-shims.ts`），只实现 vendored 文件实际用到的导出。例外：`internal/util.js`、`internal/util/types.js`、`internal/util/inspect.js`、`internal/util/comparisons.js`、`internal/util/colors.js`、`internal/util/{diff,parse_args/*}.js`、`internal/validators.js`、`internal/mime.js`、`assert.js` + `internal/assert/*`、`util.js` 本身依赖面可控，已换成真源码（M21–M24），只把它们脚下的 binding/shim 补齐。

---

## 6. 虚拟文件系统

- **权威层**：内存 inode 目录树（`Map<path, Entry>`），所有读写先改它。
- **持久层**：OPFS，debounce（400ms）写快照；Worker 内用 `FileSystemSyncAccessHandle`。
- **接口**：`Vfs`（`readFile/writeFile/stat/readdir/mkdir/rm/rename/chmod/...`），binding 只依赖接口。
- 错误带 POSIX errno（`ENOENT` / `EISDIR` / `ENOTEMPTY`…），可映射到 Node 错误码。
- 刷新页面自动回灌（已验证）。

---

## 7. 技术栈与结构

TypeScript + Vite + Vitest。无 UI 框架（原生 DOM），零运行时依赖。

```
web-node/
├─ src/
│  ├─ node-runtime/
│  │  ├─ runtime.ts          # NodeRuntime：装配 binding/realm/loader/global
│  │  ├─ realm.ts            # internalBinding 分发 + builtin 注册表
│  │  ├─ vm.ts               # CJS 编译
│  │  ├─ errors.ts           # NotImplementedError
│  │  ├─ vendored.ts         # 以 raw 文本加载 vendor/ 源码
│  │  ├─ bindings/           # 16 个 TS binding
│  │  ├─ builtins/           # node:* 模块（真源码 + TS 实现）
│  │  ├─ loader/             # CJS resolver + ESM transformer
│  │  └─ vfs/                # 内存树 + OPFS + posix
│  ├─ worker/runtime.worker.ts
│  ├─ client/index.ts
│  ├─ ui/                    # main.ts + style.css
│  └─ demo-project.ts
├─ vendor/node-lib/          # 真 Node 源码 + MANIFEST.json
├─ tools/                    # vendor.mjs + 依赖扫描
└─ test/                     # vfs.test.ts + runtime.test.ts
```

---

## 8. 测试策略

- **单元（Vitest）**：VFS 行为（9 条）、resolver/ESM 转换、binding 契约。
- **集成（Vitest）**：同一段脚本，断言 stdout —— 覆盖真源码 path/querystring、Buffer、fs、CJS、ESM、错误路径。
- **E2E（浏览器）**：Vite dev server + CDP 验证 boot → Run → 输出 → 刷新后 OPFS 仍在。
- 当前：**20/20 通过**，`tsc --noEmit` 干净，`vite build` 通过（worker 产物 182KB）。

---

## 9. 已知限制

> 本表按里程碑进展刷新（当前至 **M17**）。早期版本里「无 streams / 无网络 / 无 npm」等条目均已解决，不再列出。
>
> **vendoring 进展**：`lib/stream.js` + `internal/streams/*`（整套流）、`lib/events.js`、`lib/async_hooks.js` + `internal/async_hooks.js` + `internal/async_local_storage/*` + `internal/promise_hooks.js`、`lib/path.js`、`lib/querystring.js`、`lib/punycode.js`、`lib/domain.js`、`lib/diagnostics_channel.js`、`lib/string_decoder.js`、`internal/util/types.js`、`internal/util/inspect.js`、`internal/util/comparisons.js`、`internal/util/colors.js`、`internal/util.js`、`internal/util/diff.js`、`internal/util/parse_args/*`、`internal/validators.js`、`internal/mime.js`、`assert.js`、`internal/assert/{utils,assertion_error,myers_diff}.js`、`internal/streams/{state,from,utils}.js`、`internal/constants.js`、`internal/encoding/util.js`、`internal/querystring.js`、`internal/per_context/*` 以及 `util.js` 已用 Node 真源码（MANIFEST 55 个文件）。

| 限制 | 说明 |
|---|---|
| ESM 为转换实现 | 不支持 top-level await / live bindings |
| `stream.finished` 的回调形式 | 返回 no-op `cleanup()` |
| `fork` 的 IPC | `send`/`message` 明确抛 `notImplemented`，不静默 no-op |
| child 剩余工作是 host promise 时 | 退出判定不可见（见 M7 变更记录） |
| `os` 返回静态假数据 | 浏览器无可信宿主信息 |
| glob 未实现 | `path.matchesGlob` 抛错 |
| `file:`/`git+`/`link:` 说明符 | npm 未支持 |
| Buffer 未池化 | `allocUnsafe`/`from(string)` 不做 slab 池化（`.byteOffset` 恒为 0） |
| promise hooks 不触发 | V8 promise 未插桩，`createHook({ promiseResolve })` 不会响（tick/timer/AsyncResource 会） |

---

## 10. 后续里程碑

已完成：虚拟网络（M3）、npm client（M4）、构建工具（M5）、进程表面（M7）、stream 收尾（M8）、Buffer 共享内存（M9）、整套 stream + events 换真源码（M10–M16）、真 `async_hooks` + `AsyncLocalStorage`（M17）、真框架跑起来（M18，Vue 3 SFC 在页内被 Vite 编译并运行）、更多 vendored 真源码（M19）、真 `string_decoder`（M20）、真 `internal/util/types`（M21）、真 `internal/util/inspect`（M22）、真断言栈（M23）、真 `util` 模块（M24：`lib/util.js` + `lib/internal/util.js`，真 `promisify`/`parseArgs`/`MIMEType`/`parseEnv` 等）。

接下来：

1. **promise hooks（M17 遗留，可选）**：要让 `createHook` 的 `promiseResolve` 真响，需要 V8 promise 级插桩，代价大，暂缓。
2. **npm 再进一步**：`file:`/`git+`/`link:` 说明符、`overrides`/`resolutions`、并发下载限流。
3. **性能**：把热点 binding（buffer/fs）替换为 wasm；引入 SharedArrayBuffer + Atomics 做同步 syscall。
4. **更多框架 / 工具链**：React（SWC / Babel）、Svelte、TypeScript 项目、Tailwind / PostCSS 管线。
