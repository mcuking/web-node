# DEVLOG — web-node

> 开发日志 + 进度快照。**每次改动都往这里追加一条**，让下次开工能 30 秒内知道「做到哪了 / 下一步从哪开始」。
>
> - 追加规则：新条目写在最上面 `## 变更记录` 区域顶部（倒序），一条一段，包含 **改了什么 / 为什么 / 涉及文件**。
> - 每隔一段把「当前状态」和「下一步」两节更新一次，保证它始终反映最新事实。

---

## 当前状态

**阶段**：M5 真实构建工具已落地（**esbuild** WASM），M5b 接入 **rollup 的官方 WASM 构建**；M5c 把 **Vite 本体**跑了起来（`vite build` → VFS）；M5d 又把 Vite 的 **dev server** 在页内跑通（`createServer` + `listen` + 按需转换，预览真实渲染）；M5e 把 **HMR** 接通了——ServiceWorker 代理不了 WebSocket，于是 HMR 改走 **BroadcastChannel**；M5f 补齐 **CSS 热更（`css-update`）与按端口隔离通道**；M3.5d 把预览从路径前缀升级为 **子域名真源隔离**（`<port>.localhost`，仅 dev server）；M6 把 npm 客户端收尾（**lockfile + 完整性校验 + peer 自动安装**）；M7 补上了运行时的 **进程与 shell 表面**（`child_process` 全家族 + 受控 `ProcessHost` + mini-shell），并把 npm 的 **`.bin` shim 与生命周期脚本**接到这个表面上；M8 把 **stream** 的几处近似实现换成真语义（字节精确 `read(n)`、objectMode 双向分离、`autoDestroy`、暂停模式的 `readable` 驱动、chunk 一律交付 `Buffer`）；M9 让 **Buffer 的 `slice`/`subarray` 与 `from(ArrayBuffer)`** 共享底层内存（Node 同语义）；M10 开始**扩大 vendoring**（第一块真源码 `internal/streams/state.js` 接管 highWaterMark，默认值/ per-side 键 / 校验 / `read(n)` 增长全对齐）；M11 拿真源码 `Readable.from` 时反手修了两个 stream 核心 bug；M12 把流状态形状（`_readableState`/`_writableState`）对齐 Node 并接上真谓词；M13 把 **`internal/streams/destroy.js` 真源码接进来**；M14 再把 **`internal/streams/end-of-stream.js` 接进来**（`finished()` 就是真实现）；M15 换掉自研 `EventEmitter`，改用 **Node 真 `events.js`**（`_events` 形状 / `prependListener` / `errorMonitor` / `captureRejections`），并把 `stream.addAbortSignal` 接到真源码；M16 把**整个 `stream` 模块换成真源码**（`lib/stream.js` + `internal/streams/*`：Readable/Writable/Duplex/Transform/PassThrough/pipeline/finished/compose/duplexPair/operators + `stream/promises`），删掉手写 stream；M17 把 **`async_hooks` 也换成真源码**（`lib/async_hooks.js` + `internal/async_hooks.js` + `internal/async_local_storage/*`），落在自研 `async_wrap` 绑定上，并让 tick / timer 成为真 async resource——hook 会触发、`AsyncLocalStorage` 能跨异步边界传 store；M18 把**真框架**跑了起来——@vitejs/plugin-vue 在页内编译 **Vue 3 SFC**，`vite build` 产出生产 Vue bundle、`createServer` 在预览里跑真实可交互 Vue 应用（计数器可点、HMR 生效）；M19 又拉了一批量：**真 `punycode.js` / `domain.js` / `diagnostics_channel.js`**（后两者跑在真 `async_hooks` 上，`diagnostics_channel` 配一个小 JS binding）；M20 把 **`string_decoder` 也换成真源码**——把 `src/string_decoder.cc` 那个 native 状态机用 JS 逐字节重写（`bindings/string_decoder.ts`）；M21 再把 **`internal/util/types.js` 与 `src/node_types.cc`** 搬过来（`types` binding 对齐 native 表面，`util.types` 直接指向真模块）；M22 把 **真 `internal/util/inspect.js`** 整份搬来（`util.inspect` / `util.format` / `formatWithOptions` 就是真源码，并修了一个只有生产 minify 才会暴露的 `<Buffer …>` bug）；M23 把**断言栈**整体换成真源码：**`lib/assert.js` + `internal/assert/{utils,assertion_error,myers_diff}` + `internal/util/comparisons`（真 `isDeepStrictEqual`）+ `internal/util/colors` + 真 `internal/validators.js`**，并给每个编译单元打 `sourceURL` —— 从此**堆栈里有真文件名**、`assert.ok(falsy)` 能还原出触发表达式（如 `assert.ok(0)`）；M24 把 **整个 `util` 模块换成真源码**：**`lib/util.js` + `lib/internal/util.js`**（真 `promisify`/`callbackify`/`inherits`/`deprecate`/`styleText`/`stripVTControlCharacters`/`toUSVString`/`MIMEType`/`parseArgs`/`diff`/`parseEnv`），并给 `util` binding 补上 `defineLazyProperties`/`constructSharedArrayBuffer`/`parseEnv`/`privateSymbols`；M25 把 **Web EventTarget 栈换成真源码**：**`lib/internal/event_target.js` + `internal/webidl.js` + `internal/perf/utils.js`**（真 `EventTarget`/`Event`/`CustomEvent`/`NodeEventTarget`/`defineEventHandler`/`isEventTarget`），并让 `performance` binding 对齐 `node_perf_common.h` 的 milestone 枚举；M26 又把 **`AbortController`/`AbortSignal` 换成真源码**（`lib/internal/abort_controller.js`，建在刚接好的真 `EventTarget` 上，真 `AbortSignal.timeout`/`any`/`abort`/`throwIfAborted`）；M27 把 **`console` 换成真源码**（`lib/console.js` + `internal/console/*` + `internal/cli_table` + `internal/trace_events` + 真 `internal/util/debuglog`），真 `console.table`/`count`/`group`/`time`/`Console` 类上线；M28 把 **`os` 换成真源码**（`lib/os.js`，站在对齐 `src/node_os.cc` 的静态 `os` binding 上）；M29 把 **`timers` 换成真源码**（`lib/timers.js` + `internal/timers.js` + `timers/promises.js` + `internal/{linkedlist,priority_queue}.js`），真 `Timeout`/`ref`/`unref`/`refresh`/`Symbol.toPrimitive` 与真 `timers/promises` 上线，`timers` binding 内置一个代替 libuv 的驱动；M30 把 **`worker_threads` 的消息传递半边换成真源码**（`internal/worker/io.js` + `internal/per_context/messageport.js` + 真 `internal/worker/js_transferable.js`）：真 `MessageChannel`/`MessagePort`/`BroadcastChannel`/`receiveMessageOnPort`/`markAsUncloneable`，`messaging` binding 用 JS 重实现 `src/node_messaging.cc` 的可见契约（纠缠组、缓冲、关闭握手、端口转移、DataCloneError 全套）；M31 把 **`readline` 整份换成真源码**（`lib/readline.js` + `readline/promises.js` + `internal/readline/{interface,emitKeypressEvents,promises}.js` + `internal/repl/history.js`）：真行编辑器、真按键解码器、真 ANSI 光标函数与真历史环，`terminal` 只是 `{input,output}` 流对，不需要 TTY。已部署到 **GitHub Pages**：<https://mcuking.github.io/web-node/>。

> 预览 UI：右侧 Output / Preview 双 tab，**自动发现监听端口**（1.5s 轻量轮询），iframe 加载子域名（dev）或 `/preview/<port>/`（构建）。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 纯 JS 运行层（realm / bindings / module loader） | ✅ 完成 |
| M2 | 虚拟文件系统（内存树 + OPFS 持久化） | ✅ 完成 |
| M3 | 网络（虚拟 TCP + ServiceWorker 桥 + 预览） | ✅ 完成（基础版） |
| S | **stream 前置**（Readable/Writable/pipe/背压 + chunked） | ✅ 完成 |
| M4 | **npm client**（registry + tarball + node_modules 写入） | ✅ 完成 |
| M3.5a | **keep-alive**（持久连接 + pipelining + 客户端连接池） | ✅ 完成 |
| M3.5b | **浏览器侧真流式**（SW 直转 ReadableStream） | ✅ 完成 |
| M3.5c | **https**（http 同名壳，无 TLS） | ✅ 完成 |
| M3.5d | 子域名路由（`<port>.localhost`） | ✅ 完成（dev server） |
| M5 | **构建工具：esbuild WASM**（安装→初始化→打包→写回） | ✅ 完成 |
| M5b | **真实打包器：rollup WASM**（ESM + tree-shaking → VFS） | ✅ 完成 |
| M5c | **Vite 本体**（真实 production build → VFS） | ✅ 完成 |
| M5d | **Vite dev server**（页内编排 + 预览） | ✅ 完成 |
| M5e | **Vite HMR**（非 WebSocket 的 BroadcastChannel 通道） | ✅ 完成 |
| M5f | **HMR 收尾**（CSS `css-update` + 按端口隔离通道） | ✅ 完成 |
| M6 | **npm 收尾**（lockfile + 完整性校验 + peer 自动安装） | ✅ 完成 |
| M7 | **child_process + 受控 spawn 面**（fork/exec/spawn + mini-shell + `ProcessHost`） | ✅ 完成 |
| M7 | **npm `.bin` shim + 生命周期脚本**（JS shim + 依赖/根项目脚本） | ✅ 完成 |
| M8 | **stream 收尾**（字节精确 `read(n)` + `objectMode` 分离 + `autoDestroy` + `readable` 驱动 + chunk 交付 `Buffer`） | ✅ 完成 |
| M9 | **Buffer 共享内存**（`slice`/`subarray` + `from(ArrayBuffer)` 返回视图） | ✅ 完成 |
| M10 | **扩大 vendoring**（真源码 `internal/streams/state.js` 接管 highWaterMark） | ✅ 完成 |
| M11 | **修 stream 核心 bug**（同步 push 递归、异步迭代错误传播）+ 真源码 `Readable.from` | ✅ 完成 |
| M12 | **对齐流状态形状**（`_readableState`/`_writableState`）+ 真源码谓词 | ✅ 完成 |
| M13 | **vendor `internal/streams/destroy.js`**（真 `destroy`/`_undestroy` + `[kState]` 位域）+ `finished()` 接真谓词 | ✅ 完成 |
| M14 | **vendor `internal/streams/end-of-stream.js`**（真 `eos`/`finished`，含 options + AbortSignal）| ✅ 完成 |
| M15 | **vendor Node 真 `events.js`**（替换自研 EventEmitter）+ 真 `stream.addAbortSignal`；`internal/streams/readable.js` 已 vendor 并就绪 | ✅ 完成 |
| M16 | **整套 stream 换真源码**（`lib/stream.js` + `internal/streams/*`：Writable/Duplex/Transform/PassThrough/pipeline/compose/duplexPair/operators + `stream/promises`），删除手写 stream | ✅ 完成 |
| M17 | **真 `async_hooks`**（`lib/async_hooks.js` + `internal/async_hooks.js` + `internal/async_local_storage/*` 换成真源码，落在自研 `async_wrap` 绑定上）+ tick/timer 真实 async resource（hook 会触发、`AsyncLocalStorage` 跨异步边界传 store） | ✅ 完成 |
| M18 | **真框架跑起来**：@vitejs/plugin-vue 在页内编译 **Vue 3 单文件组件**（SFC），`vite build` 出生产 Vue bundle、`createServer` 在预览里跑真实可交互 Vue 应用（计数器可点、HMR 生效） | ✅ 完成 |
| M19 | **更多 vendored 真源码**：`punycode.js`、`domain.js`、`diagnostics_channel.js`（跑在真 `async_hooks` 上，配 JS `diagnostics_channel` binding） | ✅ 完成 |
| M20 | **真 `string_decoder`**：把 `src/string_decoder.cc` 的 native 解码状态机用 JS 逐字节重写（`bindings/string_decoder.ts`），`lib/string_decoder.js` 换真源码；删掉自研实现 | ✅ 完成 |
| M21 | **真 `internal/util/types`**：vendor `lib/internal/util/types.js`，`types` binding 对齐 `src/node_types.cc` 表面（补 `isBigIntObject`、修 boxed-primitive 语义、去掉多余的 wasm 谓词）；`util.types` 指向真模块 | ✅ 完成 |
| M22 | **真 `internal/util/inspect`**：vendor `lib/internal/util/inspect.js`（`util.inspect` / `format` / `formatWithOptions` 换真源码）；补 `util` binding 的 `constants`/`getOwnNonIndexProperties`/`previewEntries`，新增 `internal/bootstrap/realm`、`internal/url` shim；`console` 改走真 `formatWithOptions`；`Buffer` 补 `hexSlice` + `<Buffer>` 自定义 inspect | ✅ 完成 |
| M23 | **真断言栈**：vendor `lib/assert.js` + `internal/assert/{utils,assertion_error,myers_diff}` + `internal/util/comparisons`（真 `isDeepStrictEqual`）+ `internal/util/colors` + 真 `internal/validators.js`；补 `internal/errors` 的断言 code 与 `HideStackFramesError`、`constants.os`、`buffer.compare`、`url.isURL`；编译器给每个单元打 `sourceURL`（新增 `source-registry`），堆栈从此有真文件名，`assert.ok(falsy)` 能还原触发表达式 | ✅ 完成 |
| M24 | **真 `util` 模块**：vendor `lib/util.js` + `lib/internal/util.js`（+ `internal/util/parse_args/*`、`internal/mime`、`internal/util/diff`）；删手写 `builtins/util.ts`，`util.promisify`/`callbackify`/`inherits`/`deprecate`/`styleText`/`stripVTControlCharacters`/`toUSVString`/`parseEnv`/`MIMEType`/`parseArgs`/`diff` 全为真源码；补 `util` binding（`defineLazyProperties`/`constructSharedArrayBuffer`/`parseEnv`/`guessHandleType`/`privateSymbols`/真 `sleep`）与 `uv` binding 的 `getErrorMap` | ✅ 完成 |
| M25 | **真 Web EventTarget 栈**：vendor `lib/internal/event_target.js` + `internal/webidl.js` + `internal/perf/utils.js`；删 `internal/event_target` 的 stub（旧 `isEventTarget()` 恒为 false），真 `EventTarget`/`Event`/`CustomEvent`/`NodeEventTarget`/`defineEventHandler`/`isEventTarget` 上线；`performance` binding 补齐 `node_perf_common.h` 的 milestone 枚举 + `milestones`；顺带修了一个只有 worker 才暴露的启动 bug（真 `internal/util.js` 加载时读 `process`，浏览器 worker 无 `process` 全局） | ✅ 完成 |
| M26 | **真 `AbortController`/`AbortSignal`**：vendor `lib/internal/abort_controller.js`；删旧 shim（之前直接 re-export host `AbortController`/`AbortSignal`），真 `AbortSignal.timeout`/`any`/`abort`/`throwIfAborted`/`reason`（DOMException `AbortError` code 20）；顺带把 `messaging` binding 补上 `DOMException`/`structuredClone`/`setDeserializerCreateObjectFunction`，`symbols` binding 改为 memo（重复读取符号身份稳定） | ✅ 完成 |
| M27 | **真 `console`**：vendor `lib/console.js` + `internal/console/{constructor,global}.js` + `internal/cli_table.js` + `internal/trace_events.js` + 真 `internal/util/debuglog.js`（+ `internal/readline/{utils,callbacks}.js`）；删手写 `builtins/console.ts`，真 `Console` 类与 `table`/`count`/`group`/`time`/`assert`/`dir`/`createTask` 上线；`process.stdout`/`stderr` 改为真 `Writable`（lazy getter+setter），新增 `trace_events` binding（inert） | ✅ 完成 |
| M28 | **真 `os`**：vendor `lib/os.js`；删手写 `builtins/os.ts`；`os` binding 对齐 `src/node_os.cc` 表面（`getOSInformation` 元组、`getLoadAvg(out)`、`getAvailableParallelism`/`getPriority`/`setPriority`/`isBigEndian`）；新增 `credentials` binding（`getTempDir`）；`internal/errors` 补 `ERR_SYSTEM_ERROR` | ✅ 完成 |
| M29 | **真 `timers`**：vendor `lib/timers.js` + `lib/internal/timers.js` + `lib/timers/promises.js` + `internal/{linkedlist,priority_queue}.js`；删手写 `builtins/timers.ts`；`timers` binding 实现 `src/timers.cc` 表面 + 一个代替 libuv 的驱动（`scheduleTimer`/`setupTimers`/`processTimers`/`processImmediate`）；runtime 在构造时调 `getTimerCallbacks(runNextTicks)` + `setupTimers`，`activeCount` 计入真队列，reset 时用公共 `clearTimeout`/`clearImmediate` 清空 | ✅ 完成 |
| M30 | **真 `worker_threads` 消息传递**：vendor `internal/worker/io.js` + `internal/per_context/messageport.js` + `internal/worker/js_transferable.js`；`messaging` binding 用 JS 重实现 `src/node_messaging.cc` 的可见契约（纠缠组/缓冲/关闭握手/端口转移/DataCloneError）；新增 `worker` binding、`internal/deps/undici/undici`（`createFastMessageEvent`）与 `worker_threads` 模块 | ✅ 完成 |
| M31 | **真 `readline`**：vendor `lib/readline.js` + `lib/readline/promises.js` + `internal/readline/{interface,emitKeypressEvents,promises}.js` + `internal/repl/history.js`；删掉 unsupported 占位；新增 `internal/process/permission` shim（永远 disabled，对齐 `--permission` 关时的 `src/node_permission.cc`） | ✅ 完成 |
| D | **GitHub Pages 部署**（子路径站点 + gh-pages 发布） | ✅ 完成 |

**在线 demo**：<https://mcuking.github.io/web-node/>

**质量门禁**：`tsc --noEmit` 干净 · `vitest run` **326/326 通过（37 files）** · `vite build` 绿（worker ~1259KB / index ~10.8KB / css ~4.1KB）

### 网络层怎么走通的（M3）

```
浏览器 URL  /preview/3000/…
      │
      ▼
 ServiceWorker (public/sw.js)          ← 拦截同源 /preview/<port>/ 请求
      │  postMessage + MessageChannel
      ▼
 主线程 RuntimeClient                   ← 转发到 runtime worker
      │  postMessage
      ▼
 Runtime Worker ──► VirtualNetwork.dial(3000)   ← 虚拟端口表（纯 TS）
      │
      ▼
 用户的 http.createServer handler
```

- **虚拟 TCP**：`src/node-runtime/net/network.ts` —— 端口表 + 双工字节管道，`write` 永远异步交付，`dial()` 抛 EADDRINUSE/ECONNREFUSED。
- **`net` / `http`**：`src/node-runtime/builtins/{net,http}.ts` —— 自建 TS 等价实现（**不是** vendored 真源码，`describe()` 里 origin 标 `web-node`）。real `lib/net.js` 和 `lib/http.js` 依赖 stream / async_wrap / http_parser，全量 vendor 会牵出几十个文件。
- **SW 桥**：`public/sw.js` + `RuntimeClient.installServiceWorkerBridge()` + worker 的 `http` 消息类型。
- **预览 UI**：右侧面板 Output / Preview 双 tab，自动发现监听端口，iframe 加载 `/preview/<port>/`。

**MVP 限制**（已知）：
- **子域名路由仅在 dev server 可用**：`<port>.localhost:5199` 需要 dev 中间件与 `<port>.localhost` 的 wildcard DNS（浏览器把 `*.localhost` 解析到 loopback）。构建产物 / `vite preview` / GitHub Pages 没有这个 wildcard，自动回退到路径前缀 `/preview/<port>/`（`src/ui/preview-url.ts` 按环境选）。
- 路径前缀模式下：绝对路径资源（`/app.js`）会落在前缀外；HTML 响应会注入 `<base>` 修正**相对路径**资源。dev 子域名模式没有此限制（每个预览是真实源）。

### stream 层怎么走通的（前置）

```
fs.createReadStream(p)  ─┐
req (IncomingMessage)   ─┼─►  Readable ──pipe()──►  Writable  ─┬─►  fs.createWriteStream(p)
Readable.from(iter)     ─┘        ▲        背压: write()===false           └─►  res (ServerResponse,
                                  └────── dest 'drain' ── resume()             无 Content-Length → chunked)
```

- **`stream`**：`src/node-runtime/builtins/stream.ts`（新，纯 TS，`origin: 'web-node'`）。真 `lib/stream*.js` 是 30+ 文件的簇，所以自建可观察表面：`Readable`/`Writable`/`Duplex`/`Transform`/`PassThrough` + `pipe`/`pipeline`/`finished` + `stream/promises`。
- **背压是真的**：`write()`/`push()` 过 high-water mark 返回 `false`，Writable 排空后发 `'drain'`，`pipe()` 暂停源并在 `'drain'` 时 `resume()`。`req.pipe(res)` 因此能把背压一路传回读端，而不是把整个 body 吞进内存。
- **`fs` 流**：`fs.createReadStream`/`createWriteStream` + `fs.ReadStream`/`fs.WriteStream`。VFS 是同步的，所以 `_read()` 按需拉下一块——背压不是装饰。
- **`http`**：`IncomingMessage` 改成 `Readable`、`ServerResponse` 改成 `Writable`（没设 `Content-Length` 就用 `Transfer-Encoding: chunked` 分帧）、`ClientRequest` 改成 `Writable`。`HttpMessageReader` 新增 chunked 解码（含 `chunk-size`/`chunk-data`/`chunk-crlf` 状态机）。

**怎么跑起来**：
```bash
# 必须用 fnm 的独立 Node，不要用 ClawHive 内置 Electron Node
export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v22.19.0/installation/bin:$PATH"
cd /Users/tangjianghong/Downloads/web-node
npx vite --port 5199 --strictPort    # → http://localhost:5199/
npx vitest run                        # 单测
npx tsc --noEmit                      # 类型检查
npx vite build                        # 生产构建
node tools/vendor.mjs                 # 重新 vendor 真 Node 源码
```

**验证清单**（改完运行时必跑一遍）：
1. 打开 http://localhost:5199/ → 状态栏显示 `runtime ready`
2. 点 **▶ Run** → 终端出现 `=== web-node demo ===` 全段输出，并看到 `http server  : listening on http://localhost:3000`
3. **再点 2 次 Run** → 每次都有完整输出（验证无缓存空跑）
4. 切到 **Preview** tab → iframe 渲染出绿色标题 “Hello from your in-browser Node.js server” + 6 行事实表
5. 浏览器控制台执行 `await (await fetch('/preview/3000/api/info')).text()` → 返回运行时的 JSON
6. `fetch('/preview/9999/')` → 502 + `ECONNREFUSED`（错误要正确上浮，不能静默）
7. 刷新页面 → 文件树里 `output/report.txt` 仍在（验证 OPFS 持久化）
8. 点 **Reset project** → 回到完整 demo（含 `lib/facts.js`）

**stream 附加清单**（本里程碑）：
9. Run 输出里应有 `-- stream --`、`read stream : 197 bytes in 13 chunks of <=16`、`pipeline    : facts-upper.txt written`
10. `await (await fetch('/preview/3000/download/facts.txt')).text()` → 197 字节 facts 文本（`fs.createReadStream().pipe(res)`）
11. `await (await fetch('/preview/3000/api/stream')).text()` → `tick 1;tick 2;tick 3;tick 4;tick 5;done`（5 次 `res.write()` → chunked）
12. `await fetch('/preview/3000/api/upload', { method: 'POST', body: '...' })` → `{"bytes":N}`；再查 `/api/ls?dir=/project/output` 应看到 `upload.txt`
13. `/api/ls?dir=/project/output` → `facts-upper.txt`、`facts.txt`、`report.txt`（+ 上传后 `upload.txt`）

---

## 下一步（从这里继续）

按优先级：

1. ~~**给 `internal/async_hooks` 一个真实实现**~~ ✅ **已解决（2026-09-20，M17）**。
2. ~~**跑一个真前端框架**~~ ✅ **已解决（2026-09-20，M18）**：@vitejs/plugin-vue 在页内编译 Vue 3 SFC，`vite build` 出生产 bundle、dev server 在预览里跑真实可交互应用（计数器可点 + HMR）。顺带修了两个真问题：**Vite 5.4 的依赖预打包（esbuild）在无文件系统下不可用**（改用 `optimizeDeps.disabled`，让 Vite 直接供 node_modules 的 ESM 源码）、**esbuild-wasm 必须钉在 Vite 5.4 驱动的 0.21 线**。
2b. ~~**继续拉 vendored 真源码**~~ ✅ **已解决（2026-09-20，M19）**：`punycode.js` / `domain.js` / `diagnostics_channel.js` 已换真源码（后两者就坐在真 `async_hooks` 上）。下面“继续 vendoring”一节给出下一步批次的候选。
2c. ~~**`string_decoder` 换真源码**~~ ✅ **已解决（2026-09-20，M20）**：把 `src/string_decoder.cc` 的 native 解码状态机用 JS 重写（`bindings/string_decoder.ts`），真 `lib/string_decoder.js` 直接跑在上面；并让 `internal/util` 的 `normalizeEncoding`/`encodingsMap` 与 Node 对齐。
2d. ~~**`internal/util/types` 换真源码**~~ ✅ **已解决（2026-09-20，M21）**：真 `lib/internal/util/types.js` + `types` binding 对齐 `src/node_types.cc`；`util.types` 直接指向真模块。
2e. ~~**`internal/util/inspect` 换真源码**~~ ✅ **已解决（2026-09-20，M22）**：真 `lib/internal/util/inspect.js`（`util.inspect`/`format`/`formatWithOptions`）；补 `util` binding 的 `constants`/`getOwnNonIndexProperties`/`previewEntries`，新增 `internal/bootstrap/realm` + `internal/url` shim，`console` 走真 `formatWithOptions`，`Buffer` 补 `hexSlice` + `<Buffer>` 自定义 inspect。剩余近似：`getPromiseDetails` 恒 pending、`getProxyDetails` 恒 undefined（V8 不同步暴露）。
2f. ~~**`assert` 与 `internal/validators` 换真源码**~~ ✅ **已解决（2026-09-20，M23）**：真 `lib/assert.js` + `internal/assert/{utils,assertion_error,myers_diff}` + `internal/util/comparisons`（真 `isDeepStrictEqual`）+ 真 `internal/validators.js`；补 `internal/errors` 的断言 code、`constants.os`、`buffer.compare`、`url.isURL`；编译器给每个单元打 `sourceURL`（新增 `source-registry`），堆栈从此有真文件名，`assert.ok(falsy)` 能还原真表达式。差异：`getErrorSourceExpression` 无 tokenizer（嵌入表达式的调用会返回整条语句）、`HideStackFramesError` 不真隐帧。
2g. ~~**`util` 换真源码**~~ ✅ **已解决（2026-09-20，M24）**：真 `lib/util.js` + `lib/internal/util.js`（+ `internal/util/parse_args/*`、`internal/mime`、`internal/util/diff`）；补 `util` binding（`defineLazyProperties`/`constructSharedArrayBuffer`/`parseEnv`/`privateSymbols`/真 `sleep`）。差异：无 libuv → `getSystemErrorMap()` 为空、`getCallSites` 仍为 `[]`。
2h. ~~**Web EventTarget 栈换真源码**~~ ✅ **已解决（2026-09-20，M25）**：真 `lib/internal/event_target.js` + `internal/webidl.js` + `internal/perf/utils.js`；删 `internal/event_target` stub（旧 `isEventTarget()` 恒为 false）；`performance` binding 补 milestone 枚举 + `milestones`。顺带修了 worker-only 启动 bug（真 `internal/util.js` 加载时读 `process`）。
2i. ~~**`internal/abort_controller` 换真源码**~~ ✅ **已解决（2026-09-20，M26）**：真 `lib/internal/abort_controller.js`（真 `AbortController`/`AbortSignal`，建在真 `EventTarget` 上）；补 `messaging` binding 的 `DOMException`/`structuredClone`，新增 `internal/worker/js_transferable` shim（`markTransferMode` inert）。剩：全局 `AbortController`/`AbortSignal` 仍镜像宿主（有意偏离）。
2j. ~~**`console` 换真源码**~~ ✅ **已解决（2026-09-20，M27）**：真 `lib/console.js` + `internal/console/*` + `internal/cli_table` + `internal/trace_events` + 真 `internal/util/debuglog`；删手写 `builtins/console.ts`；`process.stdout`/`stderr` 改真 `Writable`（lazy getter+setter），新增 `trace_events` binding。剩：`internal/readline/*` 当时只被 console 的 `clear()` 用到（M31 已把整个 `readline` 换成真源码并验证）。
2k. ~~**`os` 换真源码**~~ ✅ **已解决（2026-09-21，M28）**：真 `lib/os.js`；删手写 `builtins/os.ts`；`os` binding 对齐 `src/node_os.cc` 表面；新增 `credentials` binding（`getTempDir`）。
2l. ~~**`timers` 换真源码**~~ ✅ **已解决（2026-09-21，M29）**：真 `lib/timers.js` + `lib/internal/timers.js` + `lib/timers/promises.js` + `internal/{linkedlist,priority_queue}.js`；删手写 `builtins/timers.ts`；`timers` binding 实现 `src/timers.cc` 表面并内置一个代替 libuv 的驱动；runtime 构造时 `getTimerCallbacks(runNextTicks)` + `setupTimers`。剩：异常从 timer 回调抛出时只有一次重入（无可捕获的 uncaughtException 循环）。
2m. ~~**`worker_threads` 消息传递换真源码**~~ ✅ **已解决（2026-09-21，M30）**：真 `internal/worker/io.js` + `internal/per_context/messageport.js` + 真 `internal/worker/js_transferable.js`；`messaging` binding 用 JS 重实现 `src/node_messaging.cc` 的可见契约（纠缠组/缓冲/关闭握手/端口转移/DataCloneError 全套）；新增 `worker` binding + `internal/deps/undici/undici`（只 `createFastMessageEvent`）+ 真部分 `worker_threads` 模块。剩：端口不参与“进程存活”（有意）；`MessageEvent` 是本 realm `Event`；`JSTransferable` 的 clone/transfer 钩子未接。
2n. ~~**`readline` 换真源码**~~ ✅ **已解决（2026-09-21，M31）**：真 `lib/readline.js` + `lib/readline/promises.js` + `internal/readline/{interface,emitKeypressEvents,promises}.js` + `internal/repl/history.js`；删掉 unsupported 占位；新增 `internal/process/permission` shim（永远 disabled）。剩：无真实 TTY（`terminal:true` 只是把流当终端用，raw mode 不可用）；历史写盘走虚拟 `fs`。
3. **继续 vendoring（按 ROI 排序）**：
   - **`internal/fs/*`**：我们已是自研 `fs`，其上层模块（`fs/promises`、`internal/fs/*`）可逐个尝试真源码。
   - **`internal/errors.js`**：目前仍是 shim（断言已逼它长大一截）。真文件是环形依赖枢纽（211 文件），全量 vendoring 不现实，但可继续按需拓宽。
   - **`util` 里剩下的自研块**：⚠️ 已过时——M24 已把 `lib/util.js` 整份换成真源码。
   - **`lib/timers.js` + `internal/timers.js`**：⚠️ 已过时——M29 已整份换成真源码（含一个代替 libuv 的驱动）。
   - **`internal/worker/io.js`（MessagePort/MessageChannel）**：⚠️ 已过时——M30 已整份换成真源码（含一个 JS 重实现的 `messaging` binding）。
   - **`readline` / `internal/readline/*`**：⚠️ 已过时——M31 已整份换成真源码（含 `readline/promises` 与 `internal/repl/history`）。
4. **promise hooks（M17 跲尾，可选）**：`async_hooks` 现在看得见 tick/timer/AsyncResource，但 V8 promise 未插桩，`promiseResolve` 不响。真做需要 `promiseHook` 级别的插桩，代价大，先放着。
5. **npm 再进一步**：`file:`/`git+`/`link:` 说明符、`overrides`/`resolutions`、并发下载限流。
6. **child_process 收尾（M7 遗留）**：child 剩余工作是 host promise（如 in-flight `fetch`）时退出判定不可见；`fork` 的 IPC（`send`/`message`）目前明确抛 `notImplemented`。M16 把 child 的生命周期事件改为**订阅时延一个 macrotask**（让 stdout 的 `data` 先于 `exit`，对齐真 Node）；若后续发现时序副作用，可再评估。
7. **Buffer pooling 遗留（M9 尾声）**：`allocUnsafe` / `from(string)` 未做 8KB slab 池化（`.byteOffset` 恒为 0、`.buffer.byteLength === length`）；与语义无关，但可观测。
8. **把 vendored 源改为按需加载**：`vendored.ts` 现在是 eager `import.meta.glob`，每个 vendor 文件都进 bundle（M31 后 worker 达 **~1259KB**，其中 inspect 100KB、util 20KB、assert 家族 ~60KB、event_target ~40KB、abort_controller ~15KB、console+debuglog ~60KB、os ~8KB、timers+timers/promises ~40KB、worker/io ~14KB、readline 家族 ~86KB）；若在意体积，可改成按文件 code-split。
9. **`console.createTask` / inspector 面**：真 console 的 `createTask` 走 `async_hooks` 的 `createTask`；真 `initializeGlobalConsole` 的 snapshot/inspector 分支在我们这里不可达（`hasInspector:false`）。
10. **补 `internal/util/inspect` 等 shim 的保真度**；把 `internal/streams/duplexify` 的 `internal/blob` 从 `isBlob` stub 扩到真 `Blob` 包装（当前够用）。

---

## 变更记录

### 2026-09-21 · M31 真 `readline`（`lib/readline.js` + `internal/readline/*`）

**目标**：`readline` 一直是 unsupported 占位（访问任何属性都抛 `NotImplementedError`），但它的依赖面全部是纯 JS：`events` / `string_decoder` / `timers` / `internal/validators` / `internal/util` / `internal/util/inspect` / `internal/readline/{utils,callbacks}`（前两者已 vendor）。更关键的是，它需要的“终端”只是一个 `{ input, output }` 流对——线编辑器、按键解码器、ANSI 光标函数、历史环全是流上的普通代码，标签页里没有 TTY 也能全程跑通。于是整份换成真源码。

**改了什么**

1. **vendor 6 个文件**（MANIFEST 75 → **81**，均 0 patch）：`lib/readline.js`、`lib/readline/promises.js`、`lib/internal/readline/interface.js`、`lib/internal/readline/emitKeypressEvents.js`、`lib/internal/readline/promises.js`、`lib/internal/repl/history.js`（`interface.js` 顶层 require 它，仅终端模式的 `_addHistory` 用到）。
2. **`readline` 从 `unsupported` 切到 vendored**：`readline`（+ `node:readline`）与 `readline/promises`（+ `node:readline/promises`）现在是真模块；`readline/promises` 是独立的 `Interface`（不是 `readline.Interface` 的子类，实测 Node 如此）。
3. **新增 `internal/process/permission` shim**：这是 `internal/repl/history.js` 写历史文件前要问的“权限模型”。标签页没有这玩意儿，且 `src/node_permission.cc` 在 `--permission` 关时也报告“未启用、所有 scope 都允许”。于是 `isEnabled()` 恒 false、`isAuditMode()` 恒 false、`has()` 恒 true、`drop()` 空操作、`availableFlags()` 返回真实清单；`internal/options` 补 `--permission`/`--permission-audit` 两个默认值。
4. **demo 加一段 `-- readline --`**：用捕获式 Writable 展示 ANSI 光标串，用 `emitKeypressEvents` 解码 `a` / `↑` / `Ctrl-C`，再用一个 `Readable.from` 跑一遍行拆分。
5. **新增 `test/readline.test.ts`（9 条）**：期望值全部先跑真 Node v26.9.0 取——导出面（含 `readline/promises` 与 `readline.promises` 同一对象、且两个 `Interface` 不同类）、跨 chunk 的行拆分与 close 时冲尾行、`question()` 写提示并回答案、`for await` 逐行、四个光标函数的逐字节 ANSI、非终端下 `prompt()`/`write()` 只写提示、5 串转义序列的按键解码（含 `sequence` 为 `undefined` 而非 `null` 这个细节）、`readline/promises` 两次 `question()` 与提示回显、终端模式的行回显与有界历史（最近在前）。

**有意偏离 / 局限**：
- 没存真实 TTY：`terminal: true` 只是“把流当终端用”。`process.stdin.isTTY` 仍为 false（与已记录的全局偏离一致）；真正需要 raw mode 的交互（`process.stdin.setRawMode`）仍不可用。
- 历史写盘走我们的虚拟 `fs`（服务的是 OPFS/VFS），不是宿主磁盘。
- 未验证 REPL 本身（`repl` 仍是 unsupported）：`internal/repl/history.js` 只是为了满足 `interface.js` 的顶层 require。

**验证**：`tsc --noEmit` 干净 · `vitest run` **326/326（37 files，+9）** · `vite build` 绿（worker 1173 → **1259.32KB**，readline 家族约 86KB）；demo 本地跑出 `-- readline --` / `cursor : "\u001b[3;4H\u001b[2K"` / `keypress : a, up, c+ctrl` / `edit lines : ["first","second"]`。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{readline.js,readline/promises.js,internal/readline/*,internal/repl/history.js}` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,unsupported.ts,internal-shims.ts,index.ts}`、`src/demo-project.ts`、`test/readline.test.ts`（新）、README/README_zh、设计文档。

### 2026-09-21 · M30 真 `worker_threads` 消息传递（`internal/worker/io.js`）

**目标**：`worker_threads` 一直是 unsupported spec（只有 `isMainThread`/`parentPort` 几个常量）。但 Node 的 `MessagePort`/`MessageChannel`/`BroadcastChannel` 的 JS 半边（`lib/internal/worker/io.js`）本来就是**纯 JS 跑在 native 端口句柄上**的，依赖面早已齐备（真 `stream`、真 `internal/event_target`、真 `internal/util`）。于是这轮把它整份换成真源码，并用 JS 重实现 `src/node_messaging.cc` 的可见契约。

**改了什么**

1. **vendor 3 个文件**（MANIFEST 73 → **75**）：`lib/internal/worker/io.js`、`lib/internal/per_context/messageport.js`、`lib/internal/worker/js_transferable.js`（后者替换旧 shim）。新增 `internal/deps/undici/undici` 小 shim：vendored 图里只用到 `createFastMessageEvent`，不值得打进 600KB 的 undici。
2. **`messaging` binding 重写**（`src/node-runtime/bindings/messaging.ts`，把原来写在 `misc.ts` 里的 DOM 面一起搬过去），对齐 `src/node_messaging.cc` 的**可观察契约**：
   - **纠缠组**：`MessageChannel` 是一个匿名两成员 `SiblingGroup`；`BroadcastChannel` 加入按名字共享的命名组（同名频道互相广播）；
   - **缓冲**：`receiving_messages_` 门（未 `start()` 的消息先留在队列里，加监听/调 `start()` 再投）；
   - **关闭握手**：`close()` 把该端口从组里摘除，匿名组只剩 1 个成员时向它补一条 Node 的“空消息”，它也跟着关（两边都发 `close`）；
   - **端口转移**：transfer list 里的端口“关闭发送端句柄 + 把端点交给消息”，接收端拿到**新建的句柄**，且消息图里对它的引用（递归替换为 token 再还原）会指向同一个新句柄；
   - **`DataCloneError` 全套**：`Found invalid value in transferList.` / `MessagePort in transfer list is already detached` / 重复 ArrayBuffer / 重复 MessagePort / source port / 消息里出现但未列入 transferList；
   - `receiveMessageOnPort`（同步取，不 start）、`stopMessagePort`、`drainMessagePort`、`moveMessagePortToContext`（单 context，即恒等）、`ref`/`unref`/`hasRef`。
3. **消息体走真 structured clone**：`postMessage` 先用“端口感知”的替换把端口换成 token 字符串，再把其余可转移对象交给宿主 `structuredClone({transfer})`，收到后还原 token。ArrayBuffer 转移后发送端真 detached（与 Node 一致）。
4. **`symbols` binding 补 6 个符号**（`oninit` / `no_message_symbol` / `messaging_{clone,transfer,deserialize,transfer_list}_symbol`）；`util` binding 补 `privateSymbols.transfer_mode_private_symbol` 与 `kDisallowCloneAndTransfer/kTransferable/kCloneable`；新增 `worker` binding（`isMainThread`/`threadId`/`getEnvMessagePort`）；`internal/buffer` 补 `markAsUntransferable`/`isMarkedAsUntransferable`。
5. **`binding.factory` 拿到 binding 表**（`BindingFactory(ctx, table)`）：Node 的 binding 是各自独立的 C++ 对象，而我们这边 `messaging` 必须拿到 `symbols` 里那几个符号才能按 `src/node_messaging.cc` 的方式驱动端口。注册表顺序不变，读取一律惰性。
6. **`worker_threads` 变真部分**（`builtins/worker-threads.ts`）：`MessageChannel`/`MessagePort`/`BroadcastChannel`/`receiveMessageOnPort`/`markAsUncloneable`/`markAsUntransferable`/`moveMessagePortToContext` 都来自真 io.js；`Worker`/`postMessageToThread` 明确抛 notImplemented（标签页里开不了线程）。demo 也加了一段 `-- worker_threads --`。
7. **新增 `test/message-channel.test.ts`（9 条）**：期望值全部先跑真 Node v26.9.0 取——导出面与端口形状（`instanceof`、`[object EventTarget]`、`hasRef`）、构造器/无 new/无参/非法 transferList 的**逐字符错误**、structured clone 与缓冲、投递顺序、`receiveMessageOnPort` 同步且不 start、`close` 双向传播、端口转移（接收端拿到端口、发送端句柄变 stale、再次转移报 detached）、ArrayBuffer 转移、整个 `DataCloneError` 面、`BroadcastChannel` 同名广播。

**有意偏离 / 局限**：
- **端口不参与“进程存活”**：Node 里一个 refed 且带监听的空闲端口会让进程活着不退出（实测确认）；这里 `ref`/`unref` 只做 `hasRef()` 所需的记账，不把空闲端口算进“还有活干”，否则任何建了 channel 的脚本都会永久挂住。有未投递消息时当然仍然算活。
- **`MessageEvent` 是本 realm 的 `Event` 子类**（不是宿主/undici 的 `MessageEvent`）：宿主那个 `MessageEventInit` 只接受宿主自己的 `MessagePort`，拿我们转过来的端口会在 `ports` 校验上抛错，而 `BroadcastChannel` 的 `dispatchEvent` 又要求事件是本 realm `Event` 的实例。代价：sandbox 里 `event instanceof MessageEvent` 不成立（这个 runtime 本来就没装全局 `MessageEvent`；把 realm 的类塞进全局会让 Vite bundle 里的 `class MessageEvent` 撞名——已实测）。`e.data`/`e.ports`/`e.type`/`e.target` 都是真的。
- **`JSTransferable` 的 clone/transfer 钩子未接**：`markTransferMode`（`AbortSignal` 用它声明可转移）现在真的会盖章，但宿主 `structuredClone` 不读它，所以 `structuredClone(signal)`/转移 `AbortSignal` 仍会抛 DataCloneError（与 M26 之前的行为一致，非回归）。
- timer 回调抛异常、`setImmediate` 与 `setTimeout(0)` 的相对顺序等 M29 已记录的偏离不变。

**验证**：`tsc --noEmit` 干净 · `vitest run` **317/317（36 files，+9）** · `vite build` 绿；本地与线上（真浏览器）跑 demo 都能看到 `-- worker_threads --` / `sync receive` / `channel msg`（`ports=1`）/ `transferred`。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{internal/worker/io.js,internal/worker/js_transferable.js}` + MANIFEST、`src/node-runtime/binding*`（`context.ts`/`index.ts`/`misc.ts`/`util.ts`/`messaging.ts` 新增）、`src/node-runtime/builtins/{vendored-builtins.ts,internal-shims.ts,index.ts,undici.ts,worker-threads.ts,unsupported.ts}`、`src/node-runtime/runtime.ts`、`src/demo-project.ts`、`test/message-channel.test.ts`（新）、README/README_zh、设计文档。

### 2026-09-21 · M29 真 `timers`（`lib/timers.js` + `internal/timers.js`）

**目标**：手写的 `builtins/timers.ts` 只实现了 `setTimeout`/`setInterval`/`setImmediate` 与清除，`Timeout.ref()`/`unref()`/`hasRef()`/`refresh()` 全是空函数，`clearTimeout(number)`（原始 id）不符合规范，`timers/promises` 是近似品。真 `lib/timers.js` 的依赖面也已齐（`internal/validators`/`internal/util`/`internal/util/debuglog`/`internal/async_hooks`/`internal/linkedlist`），于是整份换成真源码。

**改了什么**

1. **vendor 5 个文件**（MANIFEST 68 → **73**）：`lib/timers.js`、`lib/internal/timers.js`、`lib/timers/promises.js`、`internal/linkedlist.js`、`internal/priority_queue.js`。
2. **删掉手写 `builtins/timers.ts`**，换成 vendored 条目（`timers`、`timers/promises`）。真 `Timeout` 类（`ref`/`unref`/`hasRef`/`refresh`/`close`/`[Symbol.toPrimitive]`/`[Symbol.dispose]`）、真 `knownTimersById`（支持 `clearTimeout(数字)`）、真 `Immediate`、真 `insert`/`unenroll`/`active`/`unrefActive`、真 `TimersList`/PriorityQueue、真 `timers/promises`（含 `scheduler.wait/yield` 与 `setInterval` 异步迭代器）。
3. **`timers` binding 重写为真 `src/timers.cc` 的表面 + 一个代替 libuv 的驱动**：
   - 提供 `immediateInfo`（`Int32Array(3)`，`[kCount,kRefCount,kHasOutstanding]`）与 `timeoutInfo`（`Int32Array(1)`）——`internal/timers.js` 直接往它们里写，必须是 TypedArray；
   - `getLibuvNow` 对齐 `Environment::GetNowUint64`（自 binding 创建起算的**整数毫秒**）；
   - `scheduleTimer(ms)` 武装一个宿主 timer 代表 “下一个到期时间”的 uv_timer；`setupTimers(processImmediate, processTimers)` 收起 JS 回调；`toggleTimerRef`/`toggleImmediateRef` 跟踪 ref 状态（`toggleImmediateRef(true)` 会安排一次 check）。
   - **`runTimers()` 复现 `Environment::RunTimers`**：调 JS `processTimers(getLibuvNow())`，再按返回值 `±expiry` 重新武装（`0` = 队列空、`>0` = 还剩 refed、`<0` = 只剩 unrefed）；回调用抛异常时按 `src/env.cc` 的 `ret.IsEmpty()` 循环重入队列（重新武装后重抛）。
   - **`runCheck()` 复现 `Environment::CheckImmediate`**：一个宿主 macrotask 代表“事件循环转了一圈”，`do { processImmediate() } while (kHasOutstanding)`；批结束后若还有待处理的 immediate 就再排一次。
4. **runtime 构造时装上 timer 回调**（对齐 `internal/bootstrap/node.js`）：`getTimerCallbacks(() => this.#runNextTicks())` 取得 `processImmediate`/`processTimers`，再 `setupTimers(...)`。为此把 `nextTick` 的排空逻辑抽成 `#scheduleNextTickDrain`/`#drainNextTicks`，新增 `#runNextTicks()`（`internal/timers.js` 在列表之间调它）。
5. **`activeCount` 计入真队列**：新增 `#activeWorkCount()` = 运行时自身宿主 timer 数 + binding 的 `__liveCount()`（已武装的 refed 到期 / refed timeout / 任一代未决 immediate）。`proc/host.ts` 用它判定子进程是否结束，所以子程序里的 `setTimeout` 必须被看见（否则 “cannot be run synchronously” 的判定会漏）。
6. **每轮 run 清空定时器队列**：`#clearAllTimers` 除清宿主句柄外，还通过**公共 `clearTimeout`/`clearImmediate`** 逐个清掉真队列里的条目（同时维护链表、优先队列与 ref 计数），再 `binding.__reset()` 丢掉驱动句柄。**为什么不用直接清空内部表**：`timerListQueue` 是带私有字段的 PriorityQueue，直接清 `timerListMap` 会留下队列里的悬空节点，让 `processTimers` 死循环；走公共路径才一致。
7. **新增 `test/timers.test.ts`（8 条）**：期望值先跑真 Node v26.9.0 取——导出表、`Timeout` 状态（`hasRef`/`_idleTimeout`/`_repeat`/`unref`/`ref`/`close`）、`+t` 原始强转 + `clearTimeout(数字)`、`setImmediate` 的 `Immediate` 形状、到期顺序、透传额外参数、interval 重复直到清除、`timers/promises`（含 `scheduler.wait/yield` 与异步迭代器、与 `require('timers/promises')` 同一对象）、以及“pending timer 抬高 `activeTimers`、下次 run 被清空”。

**有意偏离 / 局限**：异常从 timer 回调抛出时，驱动会重新武装一次并让异常上浮（Node 有可捕获的 `uncaughtException` 循环，这里没有）；`setImmediate` 与 `setTimeout(0)` 的相对顺序与 Node 一样不确定。

**验证**：`tsc --noEmit` 干净 · `vitest run` **308/308（35 files，+8）** · `vite build` 绿（worker 1104 → **1145.47KB**）；本地 `vite preview`（`?v=m29a`）真浏览器跑：`keys: ...` / `ctor/hasRef/idle/repeat: Timeout true 20 null` / `unref/ref: true false true true` / `primitive: number true` / `cleared: true` / `args: x 3` / `interval: 3 true` / `p1: v` / `p2: w` / `wait: ok` / `yield: true` / `p-interval: i,i,i` / `same: true` / `DONE`，无 `SHOULD-NOT-PRINT`，**exit 0**。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{timers.js,internal/timers.js,timers/promises.js,internal/linkedlist.js,internal/priority_queue.js}` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,index.ts}`（删 `timers.ts`）、`src/node-runtime/bindings/timers.ts`（重写）、`src/node-runtime/runtime.ts`、`test/timers.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-21 · M28 真 `os`（`lib/os.js`）

**目标**：手写的 `builtins/os.ts` 是一堆直接返回常量的函数（没有 `constants`、没有 `Symbol.toPrimitive` 强制转换、`networkInterfaces` 恒为 `{}`、`userInfo` 不看 options、根本没有 `getPriority`/`setPriority`/`machine`）。真 `lib/os.js` 依赖面很小（`internal/errors` + `internal/util` + `internal/validators`，都是已有的），于是整份换成真源码。

**改了什么**

1. **vendor `lib/os.js`**（MANIFEST 67 → **68**）。
2. **删掉手写 `builtins/os.ts`**，换成 vendored 条目（`id: 'os'`、`aliases: ['node:os']`、`deps: ['internal/errors','internal/util','internal/validators']`）。现在 `os.arch()`/`os.platform()` 读 **sandbox `process`**，`os.constants` 走真 `internalBinding('constants').os` 并 `ObjectFreeze(constants.signals)`，`os.tmpdir()` 走真 `getTempDir()`；`module.exports` 上的 `EOL`/`devNull` 改为不可写的 `ObjectDefineProperties`，并补上真源码安装的 `[Symbol.toPrimitive]` 强制转换 hook。
3. **`os` binding 对齐 `src/node_os.cc` 表面**：新增 `getOSInformation()`（真源码拆一个 `[type, version, release, machine]` 元组）、`getLoadAvg(out)`（真源码传一个 `Float64Array` 要填）、`getAvailableParallelism`、`getPriority`/`setPriority`（真源码读 `0` / 返回 `0` 表示成功）、`isBigEndian`（是值不是函数，模块顶层就读）；删掉旧的多余函数（`getOSType`/`getOSRelease`/`getOSVersion`/`getMachine`/`getTmpdir`）；`getInterfaceAddresses` 由 `{}` 改为 `[]`（真源码按 7 元组步长遍历，数组才是对的空值）。
4. **新增 `credentials` binding**（`getTempDir: () => '/tmp'`，`cacheDir: '/tmp'`）：真 `os.tmpdir()` 直接 `internalBinding('credentials').getTempDir()`；把 `credentials` 从 `UNSUPPORTED_BINDINGS` 移到 `REGISTRY`。
5. **`internal/errors` 补 `ERR_SYSTEM_ERROR`**（`'A system error occurred'`）：真源码的 `getCheckedFunction` 包装器在 binding 返回 `undefined` 时抛它。我们的 binding 从不失败，故只在错误分支可达，仅为形状忠实。
6. **新增 `test/os.test.ts`（7 条）**：把真源码比旧 shim 多出来的行为钉住——`Symbol.toPrimitive` 强制转换、`constants.signals` 冻结/`constants` 本身不冻结、`loadavg` 的 `Float64Array` 解码、`userInfo()` 字段、`networkInterfaces()` 空对象、`setPriority` 的 `ERR_OUT_OF_RANGE` 校验。期望值先跑真 Node v26.9.0 确认结构，数值用 sandbox 自身的。

**一个测试技巧（重要）**：vendored 模块是硬编码参数编译的，`process` 对它们是**自由变量**（即 embedder 的全局），不是注入的参数。worker 里 `globalThis.process` 就是 sandbox process（`installGlobals` 默认 true），所以线上 `os.platform()` 得到 `linux`；但 vitest 里测试都传 `installGlobals:false`，宿主 `globalThis.process` 是真 Node 的，会得到 `darwin`。因此 os 测试在运行期间临时把 `globalThis.process` 换成 `runtime.sandboxGlobals.process`，结束后还原——这是复现 worker 真实环境，不是绕过。

**为什么**：`os` 是 npm 包和库常用的环境探测面；旧 shim 缺 `constants`/`machine`/优先级，会让用户代码走错分支。

**验证**：`tsc --noEmit` 干净 · `vitest run` **300/300（34 files，+7）** · `vite build` 绿（worker 1096 → **1104.38KB**）；本地 `vite preview`（`?v=m28a`）真浏览器（worker 内）跑：`Browser web-node browser wasm32` / `platform/arch: linux wasm32` / `/home/web-node /tmp web-node` / `LE "\n" /dev/null` / `total/free: 1073741824 536870912` / `parallelism/loadavg/priority: 11 [0,0,0] 0` / `signalsFrozen: true UV_UDP_REUSEADDR: 4` / `coerce: Browser linux wasm32 web-node`，**exit 0**。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/os.js` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,index.ts,internal-shims.ts}`（删 `os.ts`）、`src/node-runtime/bindings/{misc.ts,index.ts}`、`test/os.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M27 真 `console`（`lib/console.js` + `internal/console/*`）

**目标**：手写的 `builtins/console.ts` 里 `count`/`countReset`/`group`/`groupEnd`/`table`/`time`/`timeEnd` 全是假的（恒输出 `label: 1` / `0ms` / 直接 `inspect`），`Console` 类也不完整。真 `lib/console.js` + `internal/console/*` 的依赖面已经齐了（inspect / debuglog / cli_table / trace_events / colors 都能搞定），于是整份换成真源码。

**改了什么**

1. **vendor 9 个文件**（MANIFEST 59 → **67**）：`console.js`、`internal/console/constructor.js`、`internal/console/global.js`、`internal/cli_table.js`、`internal/trace_events.js`、`internal/util/debuglog.js`、`internal/readline/utils.js`、`internal/readline/callbacks.js`（后两个只在 `clear()` 且 stdout 是 TTY 时可达，保持忠实备着）。
2. **删掉手写 `builtins/console.ts`**：真 `Console` 类 + 真 `console.table`（ASCII 框线）/`count`/`countReset`/`group`（真缩进）/`groupCollapsed`/`time`/`timeLog`/`timeEnd`/`assert`/`dir`/`dirxml`/`Console` 构造器，以及 `console instanceof Console` 的 `Symbol.hasInstance`。
3. **`internal/util/debuglog` 从 shim 换成真源码**：真 `debuglog()`（按 `NODE_DEBUG` 订阅）、真 `time`/`timeLog`/`timeEnd`/`kNone`（console.time 就是它们）。为此在 runtime 构造时调一次 `initializeDebugEnv(process.env.NODE_DEBUG)`（对齐 Node 在 `internal/process/pre_execution.js` 里的初始化）——否则第一次 `debug(...)` 会因 `debugImpls` 未初始化而抛错。
4. **`process.stdout`/`stderr` 改为真 `Writable`**（lazy getter + setter，`_write` 同步排空到 binding 的 stdout/stderr 汇）：真 console 写的是 `stream.write(string, cb)` 并探测 `listenerCount('error')`/`once`/`removeListener`，裸对象不够。setter 是必需的——spawn host 会把子进程的管道流 `proc.stdout = ...` 赋上去。
5. **绑定全局 console 的流**：在 runtime 里调 `internal/console/constructor` 的 `kBindStreamsLazy(process)`（Node 在 `initializeGlobalConsole` 里做同一件事）。**关键：传我们的 sandbox `process`**，不能依赖模块里的自由变量 `process`——vendored 模块经硬编码参数编译，自由 `process` 在 Node/Vitest 下是**宿主** process（测试都传 `installGlobals:false`），让它自己取会把 console 输出写到宿主而非 runtime 的 stdout 汇。`initializeGlobalConsole` 剩下的 snapshot/inspector 部分在我们这里恒为 no-op（`hasInspector` 为 false），故只复现绑定流这一步。
6. **新增 `trace_events` binding**（inert：`usePerfetto:false`、`trace:()=>{}`、`getCategoryEnabledBuffer:()=>new Uint8Array(1)`）与 `inspector` binding 毂（仅在不可达分支被引用）。`internal/trace_events.js` 换真源码，依赖 `internal/constants` 的 `CHAR_*`。
7. **`internal/errors` 再补两个 code**：`ERR_CONSOLE_WRITABLE_STREAM`、`ERR_INCOMPATIBLE_OPTION_PAIR`（`isStackOverflowError` 已有）。
8. **spawn host 的管道流**补上 `listenerCount`/`removeListener`/`addListener`，使子进程里的真 console 也能写入。
9. **新增 `test/console.test.ts`（8 条）**：期望值先跑真 Node v26.9.0 取（分 stdout/stderr）——`log/info/debug`→stdout、`warn/error`→stderr、`%s/%d/%o` 插值、`count/countReset/group` 序列、`table` 框线表、`assert` 只输失败且在 stderr、`dir` 带 options、`time` 格式、`console instanceof Console`。

**为什么**：`console` 是最常用的调试面，之前的假 `table`/`count`/`group`/`time` 会误导用户。换真源码后其行为与 Node 一一对应。

**验证**：`tsc --noEmit` 干净 · `vitest run` **293/293（33 files，+8）** · `vite build` 绿（worker 1037 → **1096.46KB**）；本地 `vite preview`（`?v=m27a`）真浏览器跑：`count` 序列、`group` 缩进、真 `┌─┬─┐` 框线表、`Assertion failed: boom x`、`str=x num=3 obj={ a: 1 }`、`t: 0.035ms`，**exit 0**。

**保留的偏离（有意）**：全局 console 的流在 runtime 构造时就绑好（Node 在 pre_execution 里绑）；我们不做 snapshot/inspector 那半段。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{console.js,internal/console/*,internal/cli_table.js,internal/trace_events.js,internal/util/debuglog.js,internal/readline/*}` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,index.ts,process.ts,internal-shims.ts}`（删 `console.ts`/`internalDebuglogSpec`）、`src/node-runtime/bindings/{misc.ts,index.ts}`、`src/node-runtime/proc/host.ts`、`src/node-runtime/runtime.ts`、`test/console.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M26 真 `AbortController`/`AbortSignal`（`lib/internal/abort_controller.js`）

**目标**：`internal/abort_controller` 之前是 shim，直接 re-export 宿主环境的 `AbortController`/`AbortSignal`。M25 把真 `EventTarget` 接上之后，真 `lib/internal/abort_controller.js` 的依赖面已经齐了（它就建在 `internal/event_target` + `internal/webidl` + `internal/validators` 上），于是整份换成真源码。

**改了什么**

1. **vendor `lib/internal/abort_controller.js`**（MANIFEST 58 → **59**）。
2. **删掉 `internalAbortControllerSpec` shim**，换真源码：真 `AbortController`/`AbortSignal`（`AbortSignal` 直接继承真 `EventTarget`），真 `AbortSignal.timeout()` / `any()` / `abort()` / `throwIfAborted()` / `reason`（默认 DOMException `AbortError`，`code 20`），以及 `aborted()` / `transferableAbortSignal()` / `transferableAbortController()`。
3. **新增 `internal/worker/js_transferable` shim**（`origin: 'web-node'`）：给 `markTransferMode`/`setup`/`structuredClone` + `kClone`/`kDeserialize`/`kTransfer`/`kTransferList` 符号。传输机制本身是 inert 的——这个运行时没有 message port 可传，所以 `markTransferMode` 是 no-op，而不是假装序列化能用。
4. **`messaging` binding 长大**：补上 `DOMException`（`internal/abort_controller` 用它构造 `AbortError`）、`structuredClone`、`setDeserializerCreateObjectFunction`、`exposeLazyDOMExceptionProperty`。
5. **`symbols` binding 改为 memo**：之前 `symbolsBinding` 每次调用都 `Symbol(name)` 新造，重复读取同一名字会得到不同身份；改为缓存后，`internal/per_context/domexception.js` 与将来的 `internal/worker/io.js` 看到的是同一批符号。
6. **依赖声明顺序很关键**：`internal/abort_controller` 的 eager deps 把 `events` 放第一位——Node 的文件在顶层就要 `events` 的 `kMaxEventTargetListeners`，而 `internal/event_target` 顶层也要 `events`；先物化 `events` 才不会把它们接到半成品 `module.exports` 上。`internal/worker/io`（MessageChannel）只在 `[kTransferList]` 里 lazy 取，而我们不做 postMessage，因此故意不注册。
7. **新增 `test/abort-controller.test.ts`（6 条）**：期望值先跑真 Node v26.9.0 取——`AbortSignal` 继承真 `EventTarget`、默认 reason 是 `AbortError`(code 20) 且 `throwIfAborted` 抛之、abort 监听器只触发一次、`timeout()`/`any()`/`abort()` 静态方法、`AbortSignal.any` 传播 reason、transfer 辅助导出。

**为什么**：AbortController/AbortSignal 已被 stream / events / pipeline 广泛用作取消通道。之前 re-export 宿主实现，意味着取消失效、事件相关行为可能与 Node 不一致；现在它站在真 `EventTarget` 上，语义与 Node 对齐。

**保留的偏离（有意）**：全局 `AbortController`/`AbortSignal` 仍镜像宿主全局（Node 会把内部实现装为全局）。原因：本运行时的 `fetch` 是宿主 `fetch`，互换全局可能引入宿主/Node 信号互操作问题；内部模块（stream/events）已统一用真源码那一份。

**验证**：`tsc --noEmit` 干净 · `vitest run` **285/285（32 files，+6）** · `vite build` 绿（worker 1018 → **1037.37KB**）；本地 `vite preview`（`?v=m26a`）真浏览器跑：`proto=EventTarget`、`reason=AbortError:20`、`once=AbortError`、`stream=xy`、`addAbortSignal=AbortError`、`timed out=TimeoutError`，**exit 0**。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/internal/abort_controller.js` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,internal-shims.ts,index.ts}`、`src/node-runtime/bindings/misc.ts`、`test/abort-controller.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M25 真 Web EventTarget 栈（`internal/event_target` + `internal/webidl`）

**目标**：`internal/event_target` 一直是个 stub——`isEventTarget()` 恒为 `false`，只有一个 `kEvents`/`kWeakHandler`/`kResistStopPropagation` 符号。真 `lib/internal/event_target.js` 依赖面可控（`internal/errors`/`internal/validators`/`internal/util`/`util`/`internal/webidl`/`events`/`internal/perf/utils`），于是把整条 Web EventTarget 栈换成真源码。

**改了什么**

1. **vendor 3 个文件**（MANIFEST 55 → **58**）：`internal/event_target.js`、`internal/webidl.js`、`internal/perf/utils.js`。
2. **删掉 `internal/event_target` stub**，改用真源码：真 `EventTarget`/`Event`/`CustomEvent`/`NodeEventTarget`/`defineEventHandler`/`initEventTarget`/`isEventTarget`，以及 `kEvents`/`kWeakHandler`/`kResistStopPropagation`（现在与 `events.js`/`internal/streams/operators` 看到的是同一批真符号）。
3. **`events.js` 的 `internal/event_target` 从 eager deps 里摘掉**：真 `event_target.js` 顶部会 eager `require('events')`，而 `events.js` 只在其函数体内 lazy require `event_target`（对齐 Node）。两边都 eager 会让循环加载时 `events` 处于 `loading`，把空的 `module.exports` 交出去（`kMaxEventTargetListeners` 变 undefined）。摘要后按需物化，不再死锁。
4. **`performance` binding 对齐 `src/node_perf_common.h`**：补 `constants`（`NODE_PERFORMANCE_MILESTONE_*`，`TIME_ORIGIN_TIMESTAMP=0`/`TIME_ORIGIN=1`/…/`BOOTSTRAP_COMPLETE=7`/`INVALID=8`）与 `milestones` 数组；milestone 由 `performance.timeOrigin` 推出（ns/μs，对应 `PerformanceState::Initialize`）。`internal/perf/utils.js` 因此拿到真 `now`/`getTimeOriginTimestamp`。
5. **新增 `test/event-target.test.ts`（6 条）**：期望值先跑真 Node v26.9.0 取——真类导出、`NodeEventTarget` 派发、`isEventTarget` 对普通对象为假（真实现返回 `obj?.constructor?.[kIsEventTarget]`，即 `undefined`）、重入派发报 `ERR_EVENT_RECURSION`、`events.on(target, …)` 真能迭代、`internal/webidl` 的 `converters.DOMString`/`convertToInt`/`requiredArguments`/`type`。
6. **顺带修一个 worker-only 启动 bug**：真 `lib/internal/util.js` 在**加载时**读 `process.versions/platform`，而它在 `process` 自身的构建链里（`process → events → internal/util`）。Node/Vitest 下有真 `process` 全局所以测试全绿，浏览器 worker 没有 → `new NodeRuntime()` 抛 `ReferenceError: process is not defined`，页面显示 “runtime not initialised”。修法：物化任何模块前先给 `globalThis.process` 播种一个最小 stand-in（`platform`/空 `versions` 与真对象一致），`#installGlobals()` 后换成真 process。提交 `e21f69a`。

**为什么**：这是一直以来 “vendoring 真源码” 的延续，且 event_target 是 `events` / stream operators / abort 系列的共享底座。真的 `EventTarget` 让将来接 `AbortSignal`、Web streams 互操作都有真实基础，不再是恒假的 stub。

**验证**：`tsc --noEmit` 干净 · `vitest run` **279/279（31 files，+6）** · `vite build` 绿（worker 943.38 → **1018.09KB**）；本地 `vite preview`（`?v=m25a`）真浏览器跑 `/project/index.js`：`events.on` 异步迭代器得到 `["hello"]`、`stream.Readable.from` 得到 `abc`、`events.once({signal})` abort 后抛 `AbortError`、**exit 0**。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{internal/event_target.js,internal/webidl.js,internal/perf/utils.js}` + MANIFEST、`src/node-runtime/builtins/{vendored-builtins.ts,internal-shims.ts,index.ts}`、`src/node-runtime/bindings/misc.ts`、`src/node-runtime/runtime.ts`、`test/event-target.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M24 真 `util` 模块（`lib/util.js` + `lib/internal/util.js`）

**目标**：`util` 还一直是手写的 112 行壳（`promisify`/`callbackify`/`inherits`/`deprecate`/`styleText` 都是简化版，`parseArgs` 直接抛错）。真 `lib/util.js` 与 `lib/internal/util.js` 均为纯 JS，于是把整个模块换掉。

**改了什么**

1. **vendor 6 个文件**（MANIFEST 49 → **55**）：`util.js`、`internal/util.js`、`internal/util/diff.js`、`internal/util/parse_args/{parse_args,utils}.js`、`internal/mime.js`。
2. **`util` builtin 换成真源码**：删掉手写 `src/node-runtime/builtins/util.ts`。`util.format`/`inspect`/`types`/`isDeepStrictEqual` 继续走真源码；新增真 `promisify`（含 `util.promisify.custom`）、`callbackify`、`inherits`、`deprecate`、`styleText`、`stripVTControlCharacters`、`toUSVString`、`getSystemErrorName/Map/Message`、`parseEnv`、`MIMEType`/`MIMEParams`、`parseArgs`、`diff`、`transferableAbort*`/`aborted`、`TextEncoder/TextDecoder`。
3. **`util` binding 补齐** `internal/util.js` 需要的东西：`defineLazyProperties`（照 `src/node_util.cc` 实现——每键一个懒取值的 getter，首次访问时 `require(id)[key]` 并缓存）、`constructSharedArrayBuffer`、`guessHandleType`、`privateSymbols`（`arrow_message_private_symbol`/`decorated_private_symbol`）、`parseEnv`（**逐行移植 `src/node_dotenv.cc` 的 `ParseContent`**）、真 `sleep`（`Atomics.wait`）。
4. **新 `uv` binding 函数**：`getErrorMap`/`getErrorMessage`/`errname`（本环境无 libuv errno 表，返回空 Map / `Unknown system error <n>`，已在测试里写明这一差异）。
5. **BindingContext 新增 `requireBuiltin`**（由 runtime 懒指向 `realm.require`），供 `defineLazyProperties` 这种需要反向 require 的 binding 使用。
6. **两个新 shim**：`internal/encoding`（把 native `TextEncoder`/`TextDecoder` 导出去）与 `internal/util/trace_sigint`（`setTraceSigInt` no-op）；`internal/abort_controller` 已有 shim 直接满足 `lib/util.js` 的懒加载。
7. **`internal/errors` shim 再拓宽**：补 `ERR_NO_CRYPTO`/`ERR_NO_TYPESCRIPT`/`ERR_WEBASSEMBLY_NOT_SUPPORTED`/`ERR_FALSY_VALUE_REJECTION`（带 `reason` 属性）/`ERR_INVALID_MIME_SYNTAX`/`ERR_PARSE_ARGS_*`，新增 `ErrnoException`/`ExceptionWithHostPort`/`UVExceptionWithHostPort`/`overrideStackTrace`/`uvErrmapGet`。
8. **新测试 `test/util.test.ts`（6 条）**：期望值全部先跑真 Node v26.9.0 取；覆盖 format/inspect/types/isDeepStrictEqual、真 `promisify`（含 `.custom`）/`callbackify`/`inherits`/`deprecate`、string 助手、**`parseEnv` 的 dotenv 解析**、真 `MIMEType`/`parseArgs`/`diff`，以及 errno 表的差异。
9. **与 Node 的差异（已注明）**：无 libuv，所以 `getSystemErrorMap()` 为空、`getSystemErrorName(-2)` 返回 `Unknown system error -2`（Node 是 `ENOENT`）；`getCallSites` 仍返回 `[]`；`parseEnv` 已逐行移植。

**验证**：`tsc --noEmit` 干净 · `vitest run` **273/273**（+6）· `vite build` 绿（worker 860.74 → **943.06KB**）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{util.js,internal/util.js,internal/util/diff.js,internal/util/parse_args/*,internal/mime.js}` + MANIFEST、`src/node-runtime/bindings/{util.ts,misc.ts,context.ts}`、`src/node-runtime/runtime.ts`、`src/node-runtime/builtins/{index.ts,internal-shims.ts,vendored-builtins.ts}`、删除 `src/node-runtime/builtins/util.ts`、`test/util.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M23 真 `assert` 全家桶（+ 真 `internal/validators`，+ 真 `isDeepStrictEqual`，+ 堆栈真文件名）

**目标**：`assert` 一直是我们手写的 112 行简化版，`internal/validators` 也只是一堆 no-op 占位。真 `lib/assert.js` 是纯 JS，于是按惯例把整条断言栈搬过来。

**改了什么**

1. **vendor 8 个文件**（MANIFEST 41 → **49**）：`assert.js`、`internal/assert.js`、`internal/assert/utils.js`、`internal/assert/assertion_error.js`、`internal/assert/myers_diff.js`、`internal/util/comparisons.js`、`internal/util/colors.js`、`internal/validators.js`。
2. **`assert` builtin 换成真源码**：删掉手写 `assert-impl.ts`，`assert` / `assert.ok` / `strict` / `deepStrictEqual` / `partialDeepStrictEqual` / `throws` / `match` / Myers 彩色 diff / `AssertionError` 全是 Node 的。
3. **`internal/validators` 换成真源码**：删掉 no-op shim；`validateString` / `validateObject`（位域）/ `validateInteger` / `validateOneOf` … 现在是真的会报错的，报错文案也与 Node 一致。
4. **`util.isDeepStrictEqual` 换成真 `internal/util/comparisons`**（手写版只比较可枚举自属性；真版处理 Map/Set/typed array/循环引用/prototype）。
5. **`internal/errors` shim 补齐断言用到的 code**：`ERR_AMBIGUOUS_ARGUMENT` / `ERR_ASSERTION` / `ERR_CONSTRUCT_CALL_REQUIRED` / `ERR_INVALID_THIS` / `ERR_UNKNOWN_SIGNAL` / `ERR_SOCKET_BAD_PORT`，并给每个 code 类挂上 `HideStackFramesError` 静态属性（validators 会解构它）。
6. **`internal/util` shim 补 `setOwnProperty`**；新增 `internal/errors/error_source` shim。
7. **`constants` binding 改成 Node 命名空间形状**：补 `os: { signals, errno, priority, dlopen, UV_UDP_REUSEADDR }`（validators 读 `internalBinding('constants').os.signals`），并把 unix 信号表补全。
8. **`buffer` binding 补 `compare`**（comparisons 用它短路 buffer 相等），**`url` builtin 补 `isURL` / `isURLInstance`**。
9. **编译器给每个单元打 `sourceURL` + 新增 `source-registry`**（新文件 `src/node-runtime/source-registry.ts`）：loader 给用户/依赖模块、`compileCjs` 给 vendored 模块都登记源码并追加 `//# sourceURL=…`。收益：① **堆栈里出现真文件名**（不再是 `<anonymous>`）；② `internal/errors/error_source` 能从 CallSite 找回源码行，`assert.ok(falsy)` 于是能打印真表达式。
   - 同时把编译路径从 `new Function(...params, body)` 换成 **`compileTagged`——单行 `(function(...params){ body\n//# sourceURL=url\n})` 的间接 `eval`**。原因：V8 的 `Function` 包装会吃掉两行，导致所有帧报 `line+2`（实测 `/project/index.js:3:26` 其实是第 1 行），而单行 eval 包装的偏移为 **0**，堆栈行号与源码一一对应（已加回归测试）。
10. **新测试 `test/assert.test.ts`（7 条）**：期望值全部先跑真 Node v26.9.0 取得；覆盖相等/不等/深度 diff（逐字节 Myers 输出）/throws/match/fail/自定义消息、`assert.ok(falsy)` 的表达式还原、`util.isDeepStrictEqual` 的结构比较，以及真 validators 的报错文案。
11. **与 Node 的差异（已在代码注释与测试里写明）**：
    - `getErrorSourceExpression` 走的是「CallSite + sourceURL + 源码登记」这条路，而非 V8 内部的 `getErrorSourcePositions`；它没有真的 tokenizer，所以**嵌在表达式中间**的调用会返回整条语句（到 `;` / 匹配 `)` 为止），而 Node 会精确到子表达式。
    - `HideStackFramesError` 只是别名同一个类，**不会真的隐藏栈帧**（我们无法改写已捕获的 stack）。

**验证**：`tsc --noEmit` 干净 · `vitest run` **267/267**（+8）· `vite build` 绿（worker 757 → **860.74KB**）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{assert.js,internal/assert.js,internal/assert/*,internal/util/comparisons.js,internal/util/colors.js,internal/validators.js}` + MANIFEST、`src/node-runtime/source-registry.ts`（新）、`src/node-runtime/vm.ts`、`src/node-runtime/loader/index.ts`、`src/node-runtime/bindings/{constants.ts,buffer.ts}`、`src/node-runtime/builtins/{index.ts,internal-shims.ts,util.ts,url.ts,vendored-builtins.ts}`、删除 `src/node-runtime/builtins/assert-impl.ts`、`test/assert.test.ts`（新）、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M22 真 `internal/util/inspect`（`util.inspect` / `util.format` 换成真源码）

**目标**：`util.inspect` 一直是自研的极简版（只处理标量/数组/对象）。真文件 `lib/internal/util/inspect.js`（3067 行）是纯 JS，所以按惯例把它整份搬过来，只补它脚下缺的 native/shim。

**改了什么**

1. **vendor `lib/internal/util/inspect.js`**（MANIFEST 40 → **41**）。
2. **`util` builtin**：`inspect`/`format`/`formatWithOptions` 直接指向真模块（连同 `inspect.custom`、`inspect.defaultOptions`、`inspect.colors`），删掉自研格式化/遍历实现。
3. **`util` binding 对齐 `src/node_util.cc`**：新增 `constants`（V8 promise 状态 kPending/kFulfilled/kRejected、exit-info 字段、property filters ALL_PROPERTIES/ONLY_ENUMERABLE/SKIP_STRINGS/SKIP_SYMBOLS，值照 `v8-promise.h`/`v8-object.h`）；`getOwnNonIndexProperties` 按 filter 位（ONLY_ENUMERABLE/SKIP_STRINGS/SKIP_SYMBOLS）取值；`previewEntries` 实现 Map/Set/Array 条目预览与 `[entries, isKeyValue]` 慢路径。
4. **新增两个 shim spec**：`internal/bootstrap/realm`（真源码只用到 `BuiltinModule.exists(id)`，对着 realm 的公开模块表判定）、`internal/url`（`url` builtin 已含 WHATWG + file-URL 助手，直接 re-export）。
5. **`internal/util` shim 补**：`isError`（native error 或 `Error[Symbol.hasInstance]`）、`join`、`removeColors`。
6. **`internal/errors` 补 `isStackOverflowError`**（真实实现，缓存本 realm 的栈溢出 name/message）。
7. **`internal/validators` 对齐 Node**：新增 `kValidateObjectAllowNullable/Array/Function`（1/2/4），`validateObject` 改按位域判定（旧对象参数仍兼容）。
8. **`buffer` 补两样**：`Buffer.prototype.hexSlice(start,end)`（真 inspect 渲染 `[Uint8Contents]` 需要）与 `Buffer.prototype[inspect.custom]`（复刻 `lib/buffer.js`，得到 `<Buffer 01 02>`）。
9. **`console` 改走真 `util.formatWithOptions({}, …)`**（对齐 `lib/internal/console/constructor.js`）——修了 `console.log('%o', x)` 直出占位符的 bug。
10. **新测试 `test/util-inspect.test.ts`**（9 条）：期望值全部先跑真 Node v26.9.0 取得；覆盖 depth/sorted/showHidden/maxStringLength、Map/Set/WeakMap/typed/Buffer/Date/RegExp、ArrayBuffer 内容转储、循环引用 `<ref *1>`、`format`/`formatWithOptions`、`inspect.custom` 与 `colors`、无栈错误 `[Error: x]`，以及 console.log 端到端。
11. **两处 JS 无法复刻的差异，已在测试里显式断言为近似**：`getProxyDetails` 恒 `undefined`（Proxy 不可探测）→ 代理打印成普通对象；`getPromiseDetails` 恒 `kPending`（V8 不同步暴露 promise 状态）→ 已 settle 的 promise 仍打 `<pending>`。真 Node 分别为 `Proxy({ a: 1 })` 与 `Promise { 1 }`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **258/258**（+9）· `vite build` 绿（worker 653 → 757KB，inspect.js ~100KB 已计入；改按需加载是待办）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/internal/util/inspect.js` + MANIFEST、`src/node-runtime/bindings/util.ts`、`src/node-runtime/builtins/{util.ts,console.ts,internal-shims.ts,vendored-builtins.ts,index.ts,buffer.ts}`、`test/util-inspect.test.ts`、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M21 真 `internal/util/types`（+ `src/node_types.cc` 对齐）

**目标**：`internal/util/types` 一直是自研。真文件很小（`lib/internal/util/types.js` 约 120 行，纯 JS），只靠 `internalBinding('types')` 与 `internal/` 原始值。这轮把它搬过来，顺便把上次为了它临时校过的 binding 对齐 native。

**改了什么**

1. **vendor `lib/internal/util/types.js`**（MANIFEST 39 → **40**）：真文件 `module.exports = { ...internalBinding('types'), isArrayBufferView, isDataView, isTypedArray, isUint8Array, ... }`，并用 `ObjectDefineProperties` 挂上惰性 `isKeyObject` / `isCryptoKey`（无 OpenSSL 时直接 `return false`，永远不会 require `internal/crypto/keys`）。
2. **`types` binding 对齐 `src/node_types.cc`**：把它减到 native 真实暴露的表面（`VALUE_METHOD_MAP` + `isAnyArrayBuffer` + `isBoxedPrimitive`），删掉多余的类型数组/`isWasm*`（那些应由 JS 层或别的 binding 提供）；补上漏掉的 `isBigIntObject`；修 `isBoxedPrimitive`（原实现把 `1n` `Symbol()` 这些**原始值**也算作 boxed，错了）、`isSymbolObject`（同理）。
3. **`util.types` 指向真模块**：`builtins/util.ts` 不再维护局部 `types` 字面量，改为 `ctx.require('internal/util/types')`。
4. **新测试 `test/internal-util-types.test.ts`**（5 条）：导出面与真 Node `util.types` 逐字对齐（43 个键）；view/typedarray/dataview 区分；**原始值不是 boxed**；promise/date/regexp/集合/asynfunction/generator；`isKeyObject`/`isCryptoKey` 无 OpenSSL 时 false。

**一个测试环境的坑（已处理并写进测试注释）**：realm 在测试里跑在**宿主 global** 上（`installGlobals` 仅在 worker 里为 true），所以模块内未限定的 `process` 在测试中是**宿主的 process**（有 openssl）；真实 Worker 里 `process` 就是 realm 自己的 shim（无 openssl）。测试里就一次临时把 `globalThis.process` 换成 shim 来跑真短路径，`finally` 还原。

**验证**：`tsc --noEmit` 干净 · `vitest run` **249/249**（+5）· `vite build` 绿（worker 652KB → ~653KB）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/internal/util/types.js` + MANIFEST、`src/node-runtime/bindings/types.ts`、`src/node-runtime/builtins/{util.ts,internal-shims.ts,vendored-builtins.ts,index.ts}`、`test/internal-util-types.test.ts`、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M20 真 `string_decoder`（把 `src/string_decoder.cc` 搬成 JS）

**目标**：上一轮的“继续 vendoring”把 `string_decoder` 标为“差一个 native decoder binding”。这轮把它做掉：真 `lib/string_decoder.js` 直接跑，删自研实现。

**改了什么**

1. **新 `src/node-runtime/bindings/string_decoder.ts`**：`src/string_decoder.cc` 的逐字节移植。它维护一段小 native 状态 buffer（`state[0..4)` 不完整字符缓冲 / `state[4]` missingBytes / `state[5]` bufferedBytes / `state[6]` encodingField），导出 `encodings`（顺序 = encoding 码）、字段偏移常量、`kSize`、`decode(state, view)`、`flush(state)`。字段布局照 `src/string_decoder.h`，encoding 码照 `InitializeStringDecoder`。
2. **换真源码**：`lib/string_decoder.js` vendor（MANIFEST 38 → **39**），删掉自研 `src/node-runtime/builtins/string_decoder.ts`（及其在 `builtins/index.ts` 的注册）。
3. **`internal/util` 对齐 Node**：`normalizeEncoding` 从“nginx 式 toLowerCase”改成 Node 真的 `slowCases` 分支；新增 `encodingsMap`（从 `internalBinding('string_decoder').encodings` 构建）。真 `string_decoder.js` 靠这两个把 encoding 名归一到 canonical 再存数字码。
4. **新测试 `test/string-decoder.test.ts`**（12 条）：覆盖所有编码、跨 chunk 多字节 UTF-8（€ 拆 2+1、emoji 拆 2+2 与 1+3）、U+FFFD 回退、base64/base64url 回吐 1–2 字节、utf16le 奇数字节、任意 ArrayBuffer view、`ERR_UNKNOWN_ENCODING` / `ERR_INVALID_ARG_TYPE`、以及遗留的 `lastChar`/`lastNeed`/`lastTotal`/`text()`。期望值全部先跑真 Node v26.9.0 取。

**为什么**：`string_decoder` 是“纯 JS 层靠 native 层”的又一范式——真 `lib/string_decoder.js` 只是薄薄一层，native 部分（一个状态机）换 JS 重写后，真源码就能原样拉过来。

**验证**：`tsc --noEmit` 干净 · `vitest run` **244/244**（+12）· `vite build` 绿（worker 645KB → ~652KB）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/string_decoder.js` + MANIFEST、`src/node-runtime/bindings/{string_decoder.ts,index.ts,misc.ts}`、`src/node-runtime/builtins/{internal-shims.ts,vendored-builtins.ts,index.ts}`、`test/string-decoder.test.ts`、`README.md`/`README_zh.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M19 再拉一批 vendored 真源码（`punycode` / `domain` / `diagnostics_channel`）

**目标**：继续拉闸——把那些“纯 JS、只坐在我们已经提供的 shim 上”的顶层模块换成 Node 真源码，而不是自研近似实现。

**改了什么**

1. **新 vendor 三个文件**：`lib/punycode.js`（**零 native 依赖**，只读 `internalBinding('util').isInsideNodeModules`）、`lib/domain.js`（坐在 `events` + 真 `async_hooks` + `internal/async_hooks` 的 `useDomainTrampoline` 上）、`lib/diagnostics_channel.js`（坐在真 `async_hooks` 上；`TracingChannel` 直接用 `AsyncLocalStorage`）。MANIFEST 35 → **38**。
2. **新 `diagnostics_channel` binding**（`bindings/misc.ts`）：只做 native 层真正提供的那点东西——一个可写的 `subscribers` 数组（JS 侧按 index 增减）、`notifyChannelActive/Inactive`（个 Set 记账）、`linkNativeChannel`（本 tab 无 native addon，接受回调但不链接任何东西）。
3. **补 shim**：`internal/util` 加 `WeakReference`（`domain` 用它做 ref-counted 弱引用）；`internal/util/types` 加 `isPromise`（`diagnostics_channel` 判断订阅结果是否要 await）。
4. **新增 `test/vendored-modules.test.ts`**（5 条）：punycode 编解码 + 导出面；domain `run` 错误路由 + 方法/导出面；diagnostics_channel 订阅发布 + `hasSubscribers` + **`tracingChannel` 的 start/end**（这条需要真 async_hooks 才能过）。期望值全部先跑真 Node v26.9.0 取得。

**为什么**：M17 把真 `async_hooks` 接进来后，`domain` 和 `diagnostics_channel` 这两个一直“望而却步”的模块突然只需一个小 binding。M19 正好验证了这条路径：**先拉真 native 层（async_wrap），依赖它的纯 JS 模块就一个个能原样拉过来**。

**验证**：`tsc --noEmit` 干净 · `vitest run` **232/232**（+5）· `vite build` 绿（worker 597KB → ~645KB）。

**涉及文件**：`tools/vendor.mjs`、`vendor/node-lib/{punycode,domain,diagnostics_channel}.js` + MANIFEST、`src/node-runtime/bindings/{misc,index}.ts`、`src/node-runtime/builtins/{internal-shims,vendored-builtins}.ts`、`test/vendored-modules.test.ts`、`README.md`/`README_zh.md`（新增“Vendored 真源码现状”一节）、`docs/superpowers/specs/2026-09-17-web-node-design.md`。

### 2026-09-20 · M18 真框架跑起来（Vue 3 SFC，Vite 在页内编译）

**目标**：把 DEVLOG「下一步」里的“前端生态验证”做成真东西——不再只是“能跑 Vite”，而是让页内 Vite 真的编译并驱动一个 **Vue 3 单文件组件**应用。

**改了什么**

1. **demo 的站点换成真 Vue SFC**：`site/src/App.vue` 是 `script setup` + `template`（一个 `ref` 计数器 + `defineProps`），`site/src/main.js` 用 `createApp(App, { greeting })` 挂载，并保留 `import.meta.hot.accept('./message.js', ...)` 一段——改 `message.js` 会**重挂载**拿到新 greeding，而不是整页刷新。
2. **Vite 构建 / dev 都挂上 `@vitejs/plugin-vue`**：`Vite build` → 真 Vue 生产 bundle（产物含 Vue 运行时 + 编译后的渲染函数）；`Vite dev` → 在预览里跑真实可交互的 Vue 应用（计数器可点）、且 HMR 生效。
3. **demo 依赖表加 `vue` / `@vitejs/plugin-vue` / `vite` / `esbuild-wasm` 等**，npm 安装后即可用。
4. **两个真坑的修复**（都写进了注释）：
   - **Vite 5.4 的依赖预打包（`optimizeDeps`）走 esbuild，而 esbuild-wasm 没有文件系统**（读文件直接 `not implemented on js`）。有框架在场时预打包是必需的，于是 `optimizeDeps: { disabled: true }`，让 Vite 跳过预打包，直接从 node_modules 供各依赖**自己的 ESM 源码**。
   - **esbuild-wasm 必须钉在 0.21 线**（`^0.21.5`）：Vite 5.4 按 esbuild 0.21 的 API 驱动它，版本不匹配会在转换时直接抛错。
5. **新增 `test/_m18.test.ts`**（可行性回归）：把 `/tmp/v18` 的 `node_modules`（vue + vite + plugin-vue + esbuild-wasm + rollup wasm）灌进 VFS，跑两条路径并断言：生产构建产物含 Vue 渲染代码（`createElementBlock`）与模板文案；dev server 把 `/src/App.vue` 按需编成 JS（响应体无 `<template>` 标签）、把 bare import 重写成 `/node_modules/vue/...`。

**为什么**：前序里程碑把 Vite 本体、dev server、HMR 一个个跑通了，但“真框架”是另一道关——SFC 编译要插件链、`<template>` 要模板编译器、运行时要有响应式。它能跑起来，才说明 vendoring / VFS / ESM loader / HMR 这一整套组合是真的够用。

**验证**：`vitest run` **227/227**（+1）· 浏览器端到端（本地 dev server + 跨源预览 iframe）：预览里 Vue 应用渲染、点按钮 `count is 0 → 3` 响应式生效、`__vue_app__` 挂载、改 `message.js` 触发 HMR 重挂载、`Vite build` 出 Vue bundle + CSS。截图已存。

**顺带**：把 `test/child-process.test.ts` 里 4 处固定 `await tick(20)` 换成“等到输出稳定”的辅助函数——固定 sleep 在并行满载时会偶发超时（本轮就偶发了一次）；断言不变，只是把等待变稳。

### 2026-09-20 · M17 真 `async_hooks`（+ 真实 async resource 的 tick / timer）

**背景**：之前在 `internal-shims.ts` 里手写了一个 `internal/async_hooks`，只有个空壳 `AsyncResource`，且 `enabledHooksExist()` 恒为 `false`。而 `async_hooks` 正好是之前一直跳过的那块——end-of-stream 里的 `AsyncContextFrame.current() || enabledHooksExist()` 分支永远只能走 false 那条。

**改了什么**

1. **新增 `async_wrap` 绑定**（`bindings/async_wrap.ts`）：把我们之前在 C++ 的那一层（`Environment::AsyncHooks`）用 JS 做出来——`async_hook_fields`/`async_id_fields`/`async_ids_stack`（typed array）、`execution_async_resources`、`constants`（`kInit/kBefore/...`，索引逐个对齐 `src/env.h`）、`Providers`（70 个 provider 名→id，照 `src/async_wrap.h` 顺序）、以及 `setupHooks`/`setCallbackTrampoline`/`setPromiseHooks`/`queueDestroyAsyncId`/`registerDestroyHook`/`pushAsyncContext`/`popAsyncContext`/`clearAsyncIdStack`。初始值对齐真 `AsyncHooks()`：`executionAsyncId=1`、`trigger=0`、`counter=1`、`defaultTrigger=-1`、`kCheck=1`。
2. **换成真源码**：`internal/async_hooks.js`、`async_hooks.js`（公开模块）、`internal/async_context_frame.js`、`internal/promise_hooks.js`、`internal/async_local_storage/{async_hooks,run_scope}.js` 全部 vendor（MANIFEST 现在 35 个文件）。删掉手写的 `internalAsyncHooksSpec` / `internalAsyncContextFrameSpec`。
3. **CJS 模块现在能拿到 `internalBinding`**：`vm.ts` 的 `CJS_PARAMS` 加上 `internalBinding`，`realm.ts` 注入 `(name) => this.internalBinding(name)`。没有这个，真 `internal/async_hooks.js` 一加载就 `internalBinding is not defined`。
4. **bootstrap 接 hook**：仿 Node 的 `lib/internal/bootstrap/node.js`，realm 一建好就 `internalBinding('async_wrap').setupHooks(require('internal/async_hooks').nativeHooks)`，这样排队的 `destroy` 能回到 JS 语义。
5. **tick / timer 变成真的 async resource**：`process.nextTick` 建 `TickObject`，`timers.setTimeout/setInterval/setImmediate` 建 `Timeout`/`Immediate`，都在排程时 `emitInit`、回调外裹 `emitBefore/emitAfter`、触发后 `emitDestroy`（tick/timer 都在 Node 的 `internal/process/task_queues.js` / `internal/timers.js` 里干这个）。这是让 `createHook` 真的能看到 tick/timer、让 `AsyncLocalStorage` 真能跨 `nextTick`/`setTimeout` 传 store 的关键。
6. **error codes**：补 `ERR_ASYNC_CALLBACK`(TypeError) / `ERR_ASYNC_TYPE`(TypeError) / `ERR_INVALID_ASYNC_ID`(RangeError)；`errors` 绑定补 `exitCodes`（`internal/async_hooks` 拿 `kGenericUserError`）。symbols 绑定补 `resource_symbol` / `trigger_async_id_symbol`。`internal/options` 的默认值补 `--async-context-frame: false`（我们走 async_hooks 版的 ALS，不开 AsyncContextFrame）。

**已知限制**（写进 README 的 Not yet）：本 tab 不插桩 V8 promise，所以 promise hooks 不触发（`promiseResolve` 不会响）；`setPromiseHooks` 会给一个可用的 stop 函数，但注册后不会真的看到 promise。

**为什么**：逻辑上这是 vendoring 的“最后一块拼图”——流、事件都换真源码后，剩下能拉的就是 async_hooks；而且真 async_hooks 带一个真 `AsyncLocalStorage`（在浏览器里跑 Node 代码时，跨异步边界的上下文本就是硬需求）。做法上也对得上 web-node 的约定：**能原样跑的 Node 源码就原样跑**，跑不了的 native 层（这里叫 `async_wrap`）自己用 JS 补，并在 MANIFEST 里溯源。

**涉及文件**

新增：`src/node-runtime/bindings/async_wrap.ts`、`vendor/node-lib/{async_hooks.js,internal/async_hooks.js,internal/promise_hooks.js,internal/async_context_frame.js,internal/async_local_storage/*}`、`test/async-hooks.test.ts`（6 条，期望值先跑真 Node v26 取得）。修改：`tools/vendor.mjs`、`src/node-runtime/bindings/{index,misc}.ts`、`src/node-runtime/vm.ts`、`src/node-runtime/realm.ts`、`src/node-runtime/runtime.ts`、`src/node-runtime/builtins/{index,internal-shims,timers,process,vendored-builtins}.ts`、`src/demo-project.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **226/226**（+6）· 浏览器端到端 demo：`async_hooks: init:TickObject / init:Timeout / tick={"user":"tang"} / timer={"user":"tang"}`、`als outside : undefined`。

### 2026-09-20 · oracle 切到 fnm Node v26.9.0

**目标**：M16 发现 vendored 真源码是 **Node v26.9.1-dev**，而旧实测基准是 fnm **v22.19.0**（非同一版本）。统一基准。

**做了什么**
- `fnm install 26.9.0`（最新发行版；距 vendored checkout 的 `v26.9.0-1-g7a3437d` 只差一个 commit）。
- 实测比对 v26.9.0 vs v22.19.0 vs vendored：
  - **EOF `readable` 事件次数**：v26 = `1` / v22 = `2` / vendored = `1` ✅
  - HWM 背压 `write` 返回值：v26 `true,true,false,false, needDrain=true` — 与测试期望一致
  - `getDefaultHighWaterMark()` = 65536 / obj = 16；`_readableState.readable` = `undefined`；`finished()` 无 callback → `ERR_INVALID_ARG_TYPE`；`Readable.from(array).toArray()` 保类型
- 结论：**vendored 源对 Node 26 忠实**，v26.9.0 可当新基准。

**为什么** 基准与真源码版本不一致会让「断言对齐」变得含糊（到底对不对得上 Node）。现统一到 v26.9.0。

**涉及文件**：`docs/DEVLOG.md`、`README.md`、`README_zh.md`（开发说明改用 v26.9.0 路径；附注 v22.19.0 仍保留）。测试无需改动（断言本就是 v26 行为）。


### 2026-09-20 · M16 整套 stream 换成真 Node 源码

**目标**：把 M15「下一步」第 1 项做完——不再手写 stream，整个 `stream` 模块直接用 Node 的源码。

**改了什么**

1. **新 vendor 11 个文件**：`stream.js`、`stream/promises.js`、`internal/streams/{writable,duplex,transform,passthrough,pipeline,compose,operators,duplexpair,duplexify}.js`（manifest 18 → **29** 个文件）。
2. **删除自写 `src/node-runtime/builtins/stream.ts`**（~1650 行）：公开 `stream` / `node:stream` / `stream/promises` / `node:stream/promises` 现在就是真源码。
3. **补齐 shim**：`internal/abort_controller`（转发全局 `AbortController`/`AbortSignal`）、`internal/buffer`（`FastBuffer` = 本运行时的 `Buffer`，保 `Buffer.isBuffer()` 不变）、`internal/util/types`（`isArrayBufferView`/`isUint8Array` 等）、`internal/assert`、`internal/blob`（`isBlob`）；`internal/util` 补 `assignFunctionName` + `promisify.custom`；`internal/event_target` 补 `kWeakHandler`；`internal/errors` 补 `ERR_ILLEGAL_CONSTRUCTOR` / `ERR_STREAM_ALREADY_FINISHED` / `ERR_STREAM_{CANNOT_PIPE,DESTROYED,UNABLE_TO_PIPE,WRITE_AFTER_END}` / `ERR_INTERNAL_ASSERTION` / `ERR_INVALID_RETURN_VALUE`（含 formatter）。
4. **模块加载器修一个循环依赖 bug**：`stream.js` 中途会把 `module.exports` 换成 `Stream`（legacy 的 Stream），而 `duplexpair.js` / `stream/promises.js` 又反向 `require('stream')`。`realm.ts` 的 `require` 之前只回一个快照值，看不到中途重赋值；改为保留 live 的 `module.exports` 引用（`ModuleRecord.moduleObj`），循环 require 就能拿到已赋值的部分。
5. **`process.nextTick` 改成真正独立的队列**：原来直接用 `queueMicrotask`，导致嵌套 nextTick 被排到已有 promise 微任务之后（`a,b,m,c`）；现按 Node 语义排空到尽才跑微任务（`a,b,c,m`）。
6. **child_process 生命周期事件延一个 macrotask**：虚拟 child 在 `spawn()` 里同步跑完，stdout 是订阅时回放；同步回放会落在调用方 `stdout.on('data')` 之前（此时 `resume_` 未跑、`kSync` 未清）→ 输出被缓到 `exit` 之后。改为延一个 macrotask 再订阅，顺序对齐真 Node：**spawn → data → exit → close**。
7. **http 的 outgoing 关闭 autoDestroy**：`ClientRequest` / `ServerResponse` 都是 `Writable` 子类，真 Writable 在 `finish` 后会自动 destroy → 触发 `_destroy` → 提前断开 socket（`socket hang up`）。Node 的 `OutgoingMessage` 本就是 `autoDestroy:false`，照此设。

**发现（写进下一节）**：真源码来自 `/Users/tangjianghong/Downloads/node`，而它是 **Node v26.9.1-dev**，与断言基准 fnm **v22.19.0** 不是同一版本。多数语义一致，但有可观测差异，例：v26 在没人监听时跳过 EOF 处的空 `readable` 事件（`end signals=1`，v22 为 2）。测试已按 vendored 源的真实行为写并加了版本注释。

**为什么** 自己维护一份 stream 会持续跟 Node 行为发散（增量、背压、`afterFinished`、`pipe` 错误传播……）；换成真源码后这些语义与 `stream/promises`、`operators`、`compose` 一次性对齐，也让上层（`fs`/`http`/`net`）坐的底座变成 Node 自己的。

**验证**（先跑真 Node v22.19.0 实测，v26 差异处已注明）
- 单测：**210 → 220**（新增 `test/stream-vendored.test.ts` 10 条；之前基于旧行为的断言同步修正：`stream.finished` 需 callback（promise 用 `stream.promises`）、`state.readable/writable` 为 `undefined`、HWM 边界 `write` 返回 false、EOF `readable` 次数）。
- 浏览器端到端：`stream fam : transform=DUPLEX compose=compose!`、`events : prepend then on (maxListeners=10)`、`abortsignal: AbortError / ABORT_ERR`、`pipeline : facts-upper.txt written`、`premature : ERR_STREAM_PREMATURE_CLOSE (Premature close)`。

**代价 / 取舍**：`vendored.ts` 是 eager 加载，worker **468KB → ~550KB**（整套 stream 真源码）。已在「下一步」记了改按需加载。

**涉及文件**
新增：`vendor/node-lib/{stream.js,stream/promises.js,internal/streams/{writable,duplex,transform,passthrough,pipeline,compose,operators,duplexpair,duplexify}.js}`（+ MANIFEST）；`test/stream-vendored.test.ts`。删除：`src/node-runtime/builtins/stream.ts`。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/{index,vendored-builtins,internal-shims,http,child_process}.ts`、`src/node-runtime/{realm,runtime}.ts`、`test/{stream,stream-state,stream-eos,stream-destroy}.test.ts`、`src/demo-project.ts`、`README.md`、`README_zh.md`。

### 2026-09-20 · M15 换成真 `events.js`（并探清 stream 整模块替换的完整依赖）

**目标**：继续把 stream 家族换成真 Node 源码。原计划直接 vendor `internal/streams/readable.js`，而实测发现一个关键前置：

> **readable.js 直接写 `this._events = {...}` 并调 `Stream.call(this, options)`**（legacy.js → `EE.call(this)`）。它用的是 Node 真 EventEmitter 的 `_events` 存储，而我们自研的 EventEmitter 是 Map + 私有字段（`#events`）——用 `.call()` 调用会直接报 `Class constructor EventEmitter cannot be invoked without 'new'`，而 `_events` 也根本不存在。

所以这条路只能从地基开始：**先换 EventEmitter**。

**改了什么**

1. **新增真源码 `events.js`，删掉自研 `src/node-runtime/builtins/events.ts`**。公开 `events` / `node:events` 现在就是 Node 的 EventEmitter：真的 `_events` / `_eventsCount` 形状、`prependListener` 顺序、`errorMonitor`、`captureRejections`、`newListener`/`removeListener` 时序、`once`/`on` 静态辅助、`setMaxListeners`/`eventNames` 等。
2. **新增真源码 `internal/streams/add-abort-signal.js`**，并把 `stream.addAbortSignal`（之前直接抛 `not implemented`）接到它。现在：已 aborted → 立即 `AbortError/ABORT_ERR` destroy；飞行中 abort → 同样；非 signal / 非 stream 参数报真 `ERR_INVALID_ARG_TYPE`。
3. **新增 vendored 前置**：`internal/streams/legacy.js`、`internal/fixed_queue.js`、`internal/streams/readable.js`。其中 **`readable.js` 已 vendor 并实测可在本运行时运行**（`new Readable()`、精确 `read(n)`、`data`/`end` 事件全对），距“成为 `stream.Readable`”只差把它所在的整块一起换掉（见下一步）。
4. **新增/补齐 shim**：`internal/options`（`getOptionValue`）、`internal/util/debuglog`（恒返回禁用态的 logger，**不调用回调**，与 Node 一致）、`internal/util/inspect`、`internal/event_target`、`internal/events/symbols`、`internal/streams/compose`（显式抛未实现）、`internal/webstreams/adapters`、`internal/streams/iter/*`；`internal/util` 补 `spliceOne`；`internal/errors` 补 `ERR_UNHANDLED_ERROR`、`ERR_METHOD_NOT_IMPLEMENTED`、`ERR_UNKNOWN_ENCODING`、`ERR_STREAM_PUSH_AFTER_EOF`、`ERR_STREAM_UNSHIFT_AFTER_END_EVENT`、`ERR_STREAM_ITER_MISSING_FLAG` 与 `genericNodeError` / `kEnhanceStackBeforeInspector`。

**为什么**

- 自研 EventEmitter 是底座：`fs`/`http`/`net`/`child_process`/`stream` 全都坐在它上面。换成真源码后，所有事件语义（包括 `captureRejections` 这类微妙的）自动对齐 Node，且是后续 vendor `readable.js`/`writable.js`/`net.js` 的硬前置。

**代价 / 取舍**

- `vendored.ts` 用 eager `import.meta.glob`，所以每个 vendor 文件都进 bundle。M15 后 worker 从 ~357KB 长到 **~468KB**（events.js 36KB + readable.js 62KB + 几个小文件）。readable.js 目前是“已就绪未接入”，這 62KB 暂时是预付成本；已在「下一步」里记了把它改按需加载的选项。

**验证**（期望值全部先跑真 Node v22.19.0 实测）

- 单测：193 → **210**（新增 `test/events.test.ts` 10 条、`test/stream-add-abort-signal.test.ts` 4 条、`test/vendored-readable.test.ts` 3 条）。
- 浏览器端到端（本机 5199 + Chrome CDP）打印：`events     : prepend then on (maxListeners=10)`、`abortsignal: AbortError / ABORT_ERR`。

**踩坑**

- 又踩了「模板字面量内禁反引号」：给 `src/demo-project.ts` 的 `index.js` 模板加注释时写了 `` `events` ``，导致 TS 把后面的模板全解析错（报一串 `';' expected`）。已记入 MEMORY。

**涉及文件**

新增：`vendor/node-lib/events.js`、`vendor/node-lib/internal/streams/legacy.js`、`internal/streams/add-abort-signal.js`、`internal/streams/readable.js`、`internal/fixed_queue.js`（+ MANIFEST）；`test/events.test.ts`、`test/stream-add-abort-signal.test.ts`、`test/vendored-readable.test.ts`。删除：`src/node-runtime/builtins/events.ts`。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/builtins/index.ts`、`src/node-runtime/builtins/stream.ts`、`src/demo-project.ts`。

### 2026-09-20 · M14 接真源码 `internal/streams/end-of-stream.js`

**目标**：把 DEVLOG「下一步」第 1 项做完——`finished()` 手写版换成 Node 的真实现。同时把 `destroy.js` 留下来的三块 shim 缺口（`async_hooks` / `async_context_frame` / `events/abort_listener`）补上。

**改了什么**

1. **新增真源码 `internal/streams/end-of-stream.js`**（`npm run vendor`，manifest 12 → **13** 个文件）。它导出 `eos` / `finished` / `kEosNodeSynchronousCallback`。
2. **`finished()` 直接委派给 vendored `eos`/`finished`**（`stream.ts`）。公共签名改成 Node 的 `finished(stream[, options], callback)`：带回调返回 `cleanup()`，否则返回 Promise；`stream/promises.finished` 也接受 `options`。
   - 于是现在真支持 **options 对象**：`readable:false` / `writable:false` / `error:false` / `signal`。
   - `signal` → 用 **真 AbortSignal**：已 aborted 立即报错，飞行中 abort 也报错，错误都是 `AbortError` / `ABORT_ERR`。
3. **新增三块 internal shim**（`internal-shims.ts`）：
   - `internal/async_hooks`：`enabledHooksExist()` 永远 false，`AsyncResource` 退化为同步直调（正是真源码在 hooks 关闭时走的那条分支）。
   - `internal/async_context_frame`：`current()` 永远 undefined。
   - `internal/events/abort_listener`：按 Node 契约写（针对宿主原生 `AbortSignal`），返回带 `Symbol.dispose` 的对象。
4. **接回 pipeline**：`pipeline()` 本来就调 `finished(last)`；现在这条路径也走真源码（源出错→目的端被 destroy 的语义保持）。
5. 删掉 `stream.ts` 里手写的 `finished` 及其辅助 `prematureClose`/`erroredOf`。

**为什么**

- 手写版有个真 bug：`finished(stream, opts)` 会把 `opts` 丢掉（只收 `cb`），导致 `signal`/`readable:false` 完全不生效。接真源码后这个类问题一次性消失。
- end-of-stream 是 `pipeline`/`stream/promises` 的公共地基，换成真实现后错误传播、半关闭判定、中止语义全部对齐 Node。

**验证**（期望值全部先跑真 Node v22.19.0 实测）

- 单测：183 → **193**（新增 `test/stream-eos.test.ts` 10 条：已结束/已 end、`readable:false`、premature-close、destroy-error、飞行中/已完成 abort、cleanup、干净结束、pipeline 源错传播）。
- 浏览器端到端（本机 5199 + Chrome CDP）打印：`end-of-strm: AbortError / ABORT_ERR`、`end-of-strm: readable:false waited for the writable half`。

**涉及文件**

新增：`vendor/node-lib/internal/streams/end-of-stream.js`（+ MANIFEST）、`test/stream-eos.test.ts`。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/builtins/index.ts`、`src/node-runtime/builtins/stream.ts`、`src/demo-project.ts`。

### 2026-09-20 · M13 接真源码 `internal/streams/destroy.js` + `finished()` 用真谓词

**目标**：把 DEVLOG「下一步」里的第 1 项做完——流的状态形状（M12）已经对齐，现在把**真实的 destroy 链**接进来。

**改了什么**

1. **新增真源码 `internal/streams/destroy.js`**（`npm run vendor`，manifest 现有 12 个文件）。它导出 `destroy` / `undestroy` / `errorOrDestroy`，是 Node 自己生命周期管理的实现。
2. **`[kState]` 位域适配层**（`stream.ts`）：vendored destroy 不再藏在 `#private`，而是把 `_readableState`/`_writableState` 上那个 symbol 键控的位域（`kDestroyed`/`kClosed`/`kCloseEmitted`/`kErrorEmitted`…）做成**读写视图**：读时由实时字段重算，写时把生命周期位折回字段。这样 `w[kState] |= kDestroyed` 这种真源码写法能直接驱动我们的流，不需要第二份事实源；构造期常量（`kObjectMode`/`kAutoDestroy`/`kEmitClose`/`kConstructed`）和错误对象本身仍归我们所有。
   - 为此给两个 state 视图补上必要的**可写属性**（Node 的 state 是可变对象）：`errored`/`destroyed`/`closed`/`closeEmitted`/`errorEmitted`/`constructed`，以及 `undestroy` 会重置的 `reading`/`ended`/`endEmitted`（readable）与 `ending`/`finished`/`finalCalled`/`prefinished`（writable）。
3. **`destroy()` 改走真源码**：`Readable`/`Writable`/`Duplex` 的 `destroy()` 不再是手写的“置位 + defer 发射”，而是 `streamDestroy.destroy.call(this, err)`。顺序仍严格是 **nextTick 里先 `error` 后 `close`**（`emitErrorCloseNT`），且 `destroy()` 同步就把 `destroyed`/`closed`/`errored` 置好、但一帧不发射——与真 Node 逐条对上。
4. **`_undestroy()`**：`destroy.js` 的重置函数落在 `Readable.prototype`/`Writable.prototype`（Node 的受保护名，`net.js` 会调），可把已销毁的流重新置活。
5. **`finished()` 用真谓词重写**：不再只是听到 `end`/`finish`/`close` 就 resolve。现在它：
   - 用 `isReadableFinished`/`isWritableFinished`/`isDestroyed`/`willEmitClose` 判断“已完成”；
   - 已完成的流在**下一 tick** 异步回调（对齐 Node 的 immediate result）；
   - `close` 早于两半完成时，报真 `ERR_STREAM_PREMATURE_CLOSE`（除非是带错误的 destroy，那就报那个错误）；
   - **回调形式返回真正能用的 `cleanup()`**（移除自己挂的监听器）——修掉 DEVLOG 里记的“返回 no-op”遗留。
6. **公开谓词补齐**：`stream.isDestroyed` 现在与 Node 一致地导出（公开谓词就是 `isDestroyed`/`isDisturbed`/`isErrored`/`isReadable`/`isWritable` 五个）。
7. **`internal/errors` 补码**：`ERR_MULTIPLE_CALLBACK`、`ERR_STREAM_PREMATURE_CLOSE`（destroy.js/end-of-stream.js 需要）。

**为什么**

- destroy 是流生命周期里最容易写错的部分（重入、错误聚合、close 只发一次、半关闭）；用真源码能一次性把这些边界拉齐。
- `finished()` 之前把“提前关闭”当正常结束，会把真错误吞掉；现在能区分“正常结束”与“被提前关掉”。

**验证**（期望值全部先跑真 Node v22.19.0 实测）

- 单测：173 → **183**（新增 `test/stream-destroy.test.ts` 10 条：destroy 顺序/幂等/同步标志、`isDestroyed`、`_undestroy` 重置、`finished` 的 premature-close / destroy-error / cleanup / 干净结束）。
- 浏览器端到端（本机 5199 + Chrome CDP）打印：`destroy sync: destroyed=true closed=true errored=boom`、`destroy async: error:boom then close (isDestroyed=true)`、`premature  : ERR_STREAM_PREMATURE_CLOSE (Premature close)`。

**涉及文件**

新增：`vendor/node-lib/internal/streams/destroy.js`（+ MANIFEST）、`test/stream-destroy.test.ts`。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/builtins/stream.ts`、`src/demo-project.ts`。

### 2026-09-20 · M12 对齐流状态形状 + 接真源码谓词

**背景**：`Readable.from` 用的是真源码，但它只是冰山一角。Node 的 `internal/streams/utils.js`（`isReadable`/`isWritable`/`isDisturbed`/`isErrored`/`isDestroyed`…）全部建立在 `_readableState`/`_writableState` 之上；我们的流把这些状态藏在 `#private` 字段里，外界看不到，所以只能自己手写鸭子类型谓词。这一步先把状态形状对齐 Node，再接真谓词。

**改了什么**

1. **流状态对外可见**（`stream.ts`）：`Readable` 新增 `_readableState`，`Writable` 新增 `_writableState`，两者都是**身份稳定**的视图对象，属性用 getter 实时读内部状态（与 Node 一致：`r._readableState === r._readableState`）。字段包括 `objectMode`/`highWaterMark`/`buffer`/`length`/`ended`/`endEmitted`/`destroyed`/`closed`/`errored`/`errorEmitted`/`autoDestroy`/`emitClose`/`readable`/`dataEmitted` 等。
2. **公开 getter 对齐 Node**：`readable`（改为访问器：destroy/error/end 后为 false）、`readableEnded`、`readableAborted`、`readableDidRead`、`readableEncoding`、`readableBuffer`、`errored`、`closed`、`writableEnded`（Node 语义是 **end() 已调用**，即 kEnding，非 finish）、`writableFinished`、`writableCorked`、`writableAborted`、`writableBuffer`、`writableErrored`。`destroyed` 补上 setter（`http`/`net` 会手动置位）。
3. **新增错误/数据追踪**：`#dataEmitted`（`readableDidRead`/`isDisturbed` 依赖）、`#errored`/`#errorEmitted`、writable 的 `errorEmitted`、`finishEmitted`（`writableFinished` 真义是 finish 已发射）。`destroy()` 现在会记下错误并置 `closed`。
4. **vendoring `internal/streams/utils.js`**（11 个文件）：`stream.isReadable/isWritable/isDisturbed/isErrored` 不再是自己写的鸭子类型，而是 Node 官方谓词。

**为什么**

- 之前 `stream.isReadable(x)` 只是 `typeof x.read === 'function'`：已结束的流仍报 `true`，没有 `isDisturbed`/`isErrored`，与 Node 差异大。
- 状态形状是后续接真 `readable.js`/`writable.js`（需 kState 位域）的先决条件；先把外部可见契约（`_readableState`）立对。
- `writableEnded`/`writableFinished` 语义错位（之前 `writableEnded` 返回的是 finish 后的值）已修正。

**涉及文件**

新增：`vendor/node-lib/internal/streams/utils.js`（+ MANIFEST）、`test/stream-state.test.ts`（9 条，期望值全部来自真 Node v22 实测）。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/stream.ts`、`src/demo-project.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **173/173** · 浏览器端到端：`predicates : live isReadable=true / ended isReadable=false isDisturbed=true`。

### 2026-09-20 · M11 修两个 stream 核心 bug + `Readable.from` 改用真源码

**背景**：继续扩大 vendoring，目标是 `Readable.from`。量真 Node 基准时反而搜出两个真 bug（用手写实现时的实现缺陷），先修 bug 再接真源码。

**改了什么**

1. **修：`_read()` 里同步 `push()` 会无限递归 / 重复发块（runaway）**。
   - 复现：`new Readable({ read(){ this.push('x'); this.push(null); } })`。旧实现 `push() -> #drain() -> #maybeRead() -> _read() -> push() ...` 自递归，`on('data')` 收到上百个块（`Maximum call stack size exceeded`），`for await` 永不结束。
   - 修法：给 `#drain()` 加**重入锁 `#draining`** + 内层进度循环（`stream.ts`）：同步 push 只把数据放回 buffer，由外层同一趟循环读取；旧代码靠 `#reading` 标志防重入，但 `push()` 会在调 `#drain()` 前清掉它，所以拦不住。
   - 现在是：该源只产出 **1 个块**，`end` 正常触发。

2. **修：异步迭代器不在 `error` 时 reject（会变成未捕获异常）**。
   - 旧 `[Symbol.asyncIterator]` 只监听了 `data`/`end`。`destroy(err)` 经 `defer` 发射 `'error'` 时无监听者 → EventEmitter 直接抛出 → 变成 uncaught（在 `for await` 里表现为挂死）。
   - 修法：加 `once('error')` 监听，把挂起的 `next()` reject，并让后续 `next()` 也 reject。这正是 `for await` 的错误通道。

3. **`Readable.from` 改用 Node 真源码**（`vendor/node-lib/internal/streams/from.js`，`npm run vendor` 生成，manifest 现有 10 个文件）。它只用 `Readable` 公开 API，所以能直接落位。相比旧手写版：
   - **字符串 / Buffer 是整个一块**（旧版把 `'abc'` 拆成 `'a','b','c'`、把 Buffer 拆成逐字节数字）。
   - **`null` 值抛 `ERR_STREAM_NULL_VALUES`**（旧版把 `null` 当 EOF 静默结束）。
   - **`destroy()` 会调 `iterator.return()`**：async generator 的 `finally` 会跑，资源能释放（旧版不调）。
   - **非可迭代入参抛 Node 原文案**：`The "iterable" argument must be an instance of Iterable. Received null / type number (42)`。

4. **`internal/errors` 保真度**（`internal-shims.ts`）：
   - `ERR_INVALID_ARG_TYPE` 改用 Node 的完整构造算法（`type`/`an instance of`/`one of ...`/Received 描述），新增 `ERR_STREAM_NULL_VALUES`。
   - validators 改为传**原始值**（而非 `typeof` 字符串），于是报错与 Node 一致（如 `must be of type string. Received type number (5)`）。
   - `AbortError` 对齐 Node：`name = 'AbortError'`、默认 message `The operation was aborted`。

**为什么**

- 第 1、2 个是真 bug：`read(){ push(x); push(null) }` 是最常见的自定义 Readable 写法；流内错误不可捕获会让任何 `for await` 崩。
- `Readable.from` 是高使用率 API，且旧实现有多个可观测差异（分块数、null、generator 清理）。
- 错误文案/类型是对外契约，用真源码后必须把 errors 层对齐。

**涉及文件**

新增：`vendor/node-lib/internal/streams/from.js`（+ MANIFEST）、`test/readable-from.test.ts`（8 条）。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/node-runtime/builtins/stream.ts`、`src/demo-project.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **164/164** · 浏览器端到端：`hwm default : 65536 bytes / 16 objects`、`from(string): 1 chunk(s) -> ["abc"]`。

### 2026-09-20 · M10 扩大 vendoring：真源码 `internal/streams/state.js` 接管 highWaterMark

**目标**：开始把手工 TS 实现换成 **Node 真源码 + shim**（DEVLOG「下一步」第 1 项）。选 `internal/streams/state.js` 作第一个，因为它是纯 JS（零 `internalBinding`、零外部依赖，只需 `internal/errors`/`internal/validators`/`primordials`）且语义可观测。

**改了什么**

- **vendor `internal/streams/state.js`**（`tools/vendor.mjs` 新增一项，`npm run vendor` 重生成，manifest 现有 9 个文件）。注册为 builtin `internal/streams/state`（`origin: 'node-source'`），依赖 `internal/errors` + `internal/validators`。
- **`stream` 的 highWaterMark 改由真源码计算**：删掉手写的 `DEFAULT_HWM = 16*1024` / `OBJECT_HWM = 16`，改用 vendored 的 `getHighWaterMark(state, options, duplexKey, isDuplex)`。因此：
  - **默认值对齐 Node v22**：byte 模式 **65536**（之前写死 16384）、object 模式 **16**。
  - **支持 Duplex 的 per-side 键**：`readableHighWaterMark` / `writableHighWaterMark`，以及 `readableObjectMode` / `writableObjectMode`（普通 `Readable`/`Writable` 会忽略对面那个键，与 Node 一致）。
  - **校验对齐**：非法 hwm（负数/小数）抛 `ERR_INVALID_ARG_VALUE`。
- **公开 `stream.getDefaultHighWaterMark` / `stream.setDefaultHighWaterMark`**（真 Node 22 已有）。
- **`read(n)` 的 hwm 增长**（关闭 M8 遗留项）：`read(n)` 当 `n > hwm` 时把 hwm 提升到 **下一个 2 的幂**（`computeNewHighWaterMark`，上限 1 GiB 否则 `ERR_OUT_OF_RANGE`）。例：`read(100000)` → hwm 变 131072。
- **错误类的类型对齐**（`internal-shims.ts`）：Node 的 `ERR_*` 类继承对应的内建类型并保留其 `name`，code 只在 `.code` 上。现在 `new Readable({highWaterMark:-1})` 抛的是 **`TypeError`**（`instanceof TypeError` 成立，`constructor.name === 'TypeError'`，`.code === 'ERR_INVALID_ARG_VALUE'`），消息为 Node 原样的 `The property 'options.highWaterMark' is invalid. Received -1`（带点路径叫 `property`，否则叫 `argument`）。

**为什么**

- 默认 hwm 16384 vs 真 Node 65536 是真差异：会直接影响背压时机与吞吐，任何依赖“默认 hwm”的库都会算错。
- Duplex 的 per-side 键目前完全不生效（静默忽略），是常见写法（`new Duplex({ readableObjectMode: true })`）。
- 错误类型/文案也是对外契约（`instanceof TypeError`、`.code`、文案）。
- 用真源码而不是继续手写，是 vendoring 路线的第一块试金石：证明「纯 JS 模块直接 vendor + 注册」的管道通了。

**涉及文件**

新增：`vendor/node-lib/internal/streams/state.js`（+ MANIFEST 更新）、`test/stream-hwm.test.ts`（6 条）。修改：`tools/vendor.mjs`、`src/node-runtime/builtins/vendored-builtins.ts`、`src/node-runtime/builtins/stream.ts`、`src/node-runtime/builtins/internal-shims.ts`、`src/demo-project.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **156/156** · `vite build` 绿（worker ~313KB）· 浏览器端到端：`hwm default : 65536 bytes / 16 objects`。

### 2026-09-20 · M9 Buffer 共享内存：`slice`/`subarray` 与 `from(ArrayBuffer)` 不再拷贝

**目标**：把 Buffer 的视图语义对齐真 Node（v22 实测），这是 DEVLOG「下一步」第 2 项。

**改了什么**

- **`slice` / `subarray` 返回共享内存的视图**：改为 `new Buffer(this.buffer, byteOffset, length)`（即在底层 ArrayBuffer 上开窗口），而不是之前的拷贝。写入视图会回写到原 Buffer，反之亦然；`slice` 与 `subarray` 行为一致（与 Node 相同，两者都是 view）。越界/负索引的夹取仍由 `Uint8Array.prototype.subarray` 负责。
- **`Buffer.from(ArrayBuffer[, offset[, length]])` 返回视图**：不再拷贝，与 Node 一致（`Buffer.from(ab)` 改动会反映到原 ArrayBuffer）。
- **`Buffer.from(string | Buffer | Uint8Array)` 仍为拷贝**（Node 同此，保持不变）。
- **demo**：buffer 段落新增 `view shares : true`（通过 `subarray` 写回原 Buffer 验证）。

**为什么**

- 真 Node 基准（`/tmp/m9/buf.js`）逐条量出：`slice>writeThrough true` / `slice>readThrough true` / `slice>byteOffsetDelta 1` / `fromAB>shares true` / `fromAB2>shares true`，而 `fromBuf>copies true` / `fromU8>copies true`。
- 这是解析器/协议实现的核心假设：从读缓冲里切出一帧、之后复用该缓冲。若 `slice` 是拷贝，帧数据会在缓冲被覆写后“神秘地”变对/变错；若 `from(ArrayBuffer)` 是拷贝，对视图的改动会静默丢失。
- **副作用审查**：`http.ts` 的帧切分用的是原生 `Uint8Array`（`concat` 每次新建），不受影响；VFS 存的是 `Uint8Array` 并按 `.slice()` 拷贝，也不受影响。已在改动后全量回归确认。

**涉及文件**

修改：`src/node-runtime/builtins/buffer.ts`、`src/demo-project.ts`；新增：`test/buffer.test.ts`（5 条回归）。

**验证**：`tsc --noEmit` 干净 · `vitest run` **150/150**（新增 buffer 5 条）· `vite build` 绿 · 浏览器端到端：`view shares : true`。

### 2026-09-20 · M8 stream 收尾：字节精确 `read(n)` + `objectMode` 分离 + `autoDestroy`

**目标**：把 stream 里几处「近似 Node 行为」换成真语义。这些都是真 Node 与 web-node **可观测差异**，不是内部实现洁癖。

**改了什么**

- **`read(n)` 字节精确**：字节模式下 `read(3)` 从缓冲里精确切出 3 字节（需要时切碎一个 chunk 并把尾巴 `subarray` 留下），而不是交出整个缓冲 chunk。objectMode 仍然一次一个值；无参 `read()` 取走全部。
- **暂停模式由 `readable` 驱动**：新增 `#emittedReadable` / `#needReadable` 与合并延迟的 `#emitReadable()`（Node 语义：只在事件真正发出后才清标记，故一串 `push()` 只产生一个 `readable`）。`on('readable')` 现在会启动 `_read`（之前完全不会，paused 消费者永远拿不到数据）。
- **`readableObjectMode` / `writableObjectMode` 成为真实 getter**（之前是 `undefined`）。`Readable.from` 仍默认 objectMode，并且按 Node 把 `highWaterMark` 默认设为 **1**（惰性，不被无界 source 撑爆）。
- **objectMode 的 writable 不再把字符串重编码成 Buffer**：`decodeStrings` 在 objectMode 下强制为 false（Node 同此），所以 `w.write('str')` 交到 `_write` 的是字符串本身。
- **`autoDestroy`（默认开）**：`end`/`finish` 之后关闭流，且 `close` 触发时 `destroyed === true`（`end` 触发时仍为 `false`——与 Node 顺序一致）。用一个 `WeakMap` 注册表记录「读端/写端是否已完成」，**Duplex 要两端都完成才关**，避免半关（这是之前直接 `emit('close')` 的旧行为会踩的坑）。关闭走「软关闭」：置位 `destroyed` + 发 `close`，**不重入 `_destroy`**（否则 `http.ClientRequest` 会把 socket abort 掉）；这也与旧的 `emit('close')` 行为等价。
- **字节 chunk 一律交付 `Buffer`**：真 Node v22 下 `push('ab')` / `push(Uint8Array)` 到达 `data` / `read()` 时都是 `Buffer`，所以 `chunk.toString()` 应该是「解码」而不是「列出字节」。新增 `toBuffer()`，在 `#decode` 的字节-无编码分支包装。
- **文件头过时说明更新**：原先写着「`read(n)` 不精确切分、无 objectMode 分离、无 autoDestroy」，现已不成立。
- **demo**：stream 段落新增 pull API 展示（`readable` + `read(32)` 精确读 + `autoDestroy: closed, destroyed=true`）。

**为什么**

- 一条一条都是拿真 Node 当基准量出来的：`Readable.from(...).read(3)`、`read()` 无参同步 push、`data` 的 chunk 类型（`Buffer.isBuffer`）、`w.write('str')` 在 objectMode 下到底交什么、`end`/`close` 时的 `destroyed`、`Readable.from` 的 hwm。基准程序在 `/tmp/m8/` 下跑，输出逐条对齐。
- `read(n)` 不准、paused 模式完全不工作、objectMode 把字符串转 Buffer——这些会让任何真 Node 库（解析器、协议实现、流式压缩）在页内静默算错。

**涉及文件**

修改：`src/node-runtime/builtins/stream.ts`、`test/stream.test.ts`（+9 条回归）、`src/demo-project.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **145/145**（stream 从 18 → 26 条）· `vite build` 绿 · 浏览器端到端：`read stream : 197 bytes in 13 chunks of <=16` / `read(32) : 197 bytes in 7 exact reads` / `autoDestroy : closed, destroyed=true`。

### 2026-09-20 · M7 进程表面：`child_process` + mini-shell + npm `.bin`/生命周期脚本

**目标**：让运行时不仅能跑「一个」程序，还能跑一个「进程树」——并让 npm 的安装钩子（postinstall 等）真正有地方可跑。

**改了什么**

- **新增 `child_process` 真实实现**（原先只是 stub）：`exec` / `execFile` / `spawn` / `spawnSync` / `execSync` / `execFileSync`。派生的一切都走受控 `ProcessHost`，不存在真 OS 进程——每个 child 是同一事件循环上的**第二个模块注册表**，有自己的 `process` 视图（argv/env/cwd/pid/stdout/stderr）与自己的管道。
- **新增 mini-shell**（`src/node-runtime/shell/sh.ts`）：支持引号、`$VAR`/`${VAR}`、`;` `&&` `||`、`|`、`>` `>>` `<` `2>`、前导 `VAR=value`、`#` 注释与内建 `cd pwd echo true false exit`。**明确拒绝**（抛 `ShellUnsupportedError`，不静默降级）`$(…)`/反引号、子 shell、进程替换、glob、后台 `&`、here-doc、`export`/`unset`。管道按阶段串行传字节。
- **新增 `ProcessHost`**（`src/node-runtime/proc/`）：`spawn`/`run`/`runSync`/`activeChildren`/`reset`，负责 pid 分配、受控环境、stdout/stderr 缓冲与重放、stdin 泵、退出结算。
- **child 生命周期判定**：入口同步返回且 spawn 前后未在 timer 队列留下工作 → 结束；或 `process.exit()`/`process.kill()`；或被 kill/超时。child 的 `setTimeout`/`setInterval`/`queueMicrotask`/`process.nextTick` 被包装，抛错归因到该 child（栈进 child stderr + 非零退出），不会拖垮整个 worker。
- **npm `.bin` shim**（`src/node-runtime/npm/bin.ts`）：把包声明的 bin 以 **JavaScript shim** 写入 `node_modules/.bin/<name>`（`chmod 0o755`）。用 JS 而非 POSIX shell，是因为 mini-shell 无法执行 shell 脚本；shim 带 `SHIM_MARKER`，`proc/command.ts` 解析时跟随 marker 指向真实入口，保证 `process.argv[1]` 是真实入口而非 shim。同名冲突保留首个并 warn。
- **npm 生命周期脚本**（`src/node-runtime/npm/scripts.ts`）：`preinstall`/`install`/`postinstall`（依赖）+ `prepare`（根项目），复用同一 spawn 面，带全套 `npm_*` 生命周期环境变量（`npm_lifecycle_event`、`npm_package_json` 等）。脚本失败记为 warning 并继续（**有意偏离** npm），`ignoreScripts` 可整体关闭。无 `host` 时跳过并 warn。
- **loader 剥离 shebang**（`src/node-runtime/loader/index.ts` 新增 `stripShebang`）：`.bin` 入口以 `#!/usr/bin/env node` 开头，直接交给 `new Function` 是语法错误——Node 对主模块会剥离，这里必须同样处理。修掉 `Failed to compile /project/node_modules/hello/cli.js: Invalid or unexpected token`。
- **`fork` 的 IPC 明确抛错**：`fork` 可启动模块，但 `send()`/`disconnect()`/`'message'` 抛 `notImplemented('api', …)`，绝不静默 no-op。
- **接线**：worker 把安装期生命周期脚本的 stdout/stderr 转发到同一个终端（`onOutput`）；UI 展示 `[lifecycle] …` 与 `[bin] node_modules/.bin: …`；demo 新增 `child_process` 段落（同步 execFileSync → 嵌套 child → 拒绝 shell 脚本 → 管道）。

**为什么**

- M6 留下的 npm 缺口正是「安装钩子」，而钩子需要一个受控的进程表面。与其零散补丁，不如把 `child_process` 一次性做成真实实现：子程序继承同一别名表（`rollup`/`esbuild` 仍指 WASM 版）、同一 VFS、同一虚拟网络，于是「node 脚本调 node 脚本」在页内天然可嵌套。
- 能做什么就明说什么：**只有 JS 能被派生**（VFS 里能的，就是能跑的）；shell 脚本按名拒绝（`ENOEXEC`），不半执行。这既诚实，也解释了为什么 npm 的 `.bin` 必须写成 JS shim。

**涉及文件**

新增：`src/node-runtime/builtins/child_process.ts`、`src/node-runtime/proc/{command,host}.ts`、`src/node-runtime/shell/sh.ts`、`src/node-runtime/npm/{bin,scripts}.ts`、`test/child-process.test.ts`。
修改：`src/node-runtime/{runtime,loader/index,errors}.ts`、`src/node-runtime/builtins/{index,unsupported}.ts`、`src/node-runtime/npm/{install,index}.ts`、`src/worker/runtime.worker.ts`、`src/client/index.ts`、`src/ui/main.ts`、`src/demo-project.ts`、`test/runtime.test.ts`。

**验证**：`tsc --noEmit` 干净 · `vitest run` **136/136**（新增 29 条 child_process 测试）· `vite build` 绿 · 浏览器端到端：`child out : spawned pid 100 in /project; its own child said 42`、`sh script : ENOEXEC`、`shell pipe : 42 (via pipe)`。

### 2026-09-17 · M6 npm 收尾：lockfile + 完整性校验 + peer 自动安装

**目标**：把 M4 留下的 npm 缺口补齐到实用程度。

**1. `package-lock.json`（lockfileVersion 3）** —— `src/node-runtime/npm/lockfile.ts`（新）
- 安装结束写入 lockfile（根条目 + 每个包的 `node_modules/<name>` 条目）；条目自带 `version / resolved / integrity / dependencies / optionalDependencies / peerDependencies(+Meta) / bin / os / cpu`，**不依赖 packument 就能重装**。
- 二次安装：已锁版本若仍满足声明范围则直接复用（跳过解析与网络）；`lockedByName()` 取“最浅路径优先”。读不到/坏 lockfile 一律忽略，不影响安装。
- 实测：二次安装日志出现 `[lock] reused 16 package(s) from package-lock.json`。

**2. 完整性校验** —— `src/node-runtime/npm/integrity.ts`（新）
- 下载后用 WebCrypto（`crypto.subtle`）校验 registry 的 `dist.integrity`（SRI，通常 sha512）；老包只有 `dist.shasum`（sha1 hex）则校 sha1。**校验在写入 VFS 之前**，不匹配直接报错。
- 任一处失败都是致命错误（不静默）；无可计算算法时返回 `undefined` 放行（兼容极老的私有 registry）。

**3. peer 依赖自动安装**（npm 7+ 行为）
- 解析时收集每个已放置包的必选 `peerDependencies`（`peerDependenciesMeta.optional` 跳过），主图完成后把**任何层级都没满足**的 peer 装到根 `node_modules`。

**4. ️ 顺带修的真问题：optionalDependencies + 平台过滤**
- 一开始把 `optionalDependencies` 全部安装，结果把 esbuild 的**全平台原生二进制全装了（61 个包）**，还把 OPFS 快照撞到很大（下次启动变慢）。
- 按 npm 语义补上 **`os`/`cpu` 过滤**：不匹配目标平台（默认 `linux`/`wasm32`，即运行时自报的平台）的可选依赖**静默跳过**（`fsevents`、`@esbuild/darwin-*` 等）。安装数回到 11。

**测试**：100 → **107**。新增：lockfile 写入形状 + 二次安装零解析（计数 packument 调用）；SRI 匹配/不匹配、shasum 回退；registry integrity 不匹配则不写入；peer 缺失自动装到根并能 `require`；可选依赖解析失败静默；跨平台可选依赖静默跳过。

**仍不在范围**（需外部能力）：生命周期脚本与 `.bin` shim（二者都要能 spawn 进程，而运行时没有 `child_process`）；`file:`/`git+`/`link:` 说明符。

**浏览器实测**：Reset → Install deps → `installed 11 package(s)`，文件树出现 `package-lock.json`；再点一次 → `[lock] reused 16 package(s)`。

**涉及文件**：`src/node-runtime/npm/{integrity,lockfile,install,registry,index}.ts`、`src/client/index.ts`、`src/ui/main.ts`、`src/demo-project.ts`、`test/npm.test.ts`

### 2026-09-17 · M5f HMR 收尾：CSS 更新 + 通道按端口隔离

**目标**：把 M5e 的 HMR 补齐两处——CSS 热更（`css-update` 路径）与多端口隔离（两个 dev server 不能串台）。

**1. CSS HMR**
- site 新增 `src/style.css` 并在 `main.js` 里 `import './style.css'`；新增 **🎨 HMR CSS** 按钮（`hmrCssEdit()`）按调色板循环改写 `style.css`。
- 验证：`getComputedStyle(#app).color` 从 `rgb(94,241,165)` 原地变为 `rgb(124,196,255)`（`#7cc4ff`），**无 reload**（marker 存活）。Vite 直接走 `css-update` / `updateStyle` 路径，运行时照搬即可。

**2. 多端口隔离**
- 通道名从固定 `web-node-hmr` 改为 **按端口** `web-node-hmr:<port>`。SW 注入 shim 时已知预览端口，因此把 `PORT` 写进 shim；运行时桥用同一规则拼名（两边必须保持一致）。
- 子域名预览是**跨源**，shim 无法用 BroadcastChannel，仍经 `window.top` 中继；帧里新增 `port` 字段，主页面的 `installHmrRelay` 据此**按端口选通道**（`channelFor(port)`），且只把 runtime 的回复推给当前显示该端口的 iframe。
- 验证：活预览在 5173 时，在页面里同时监听 `web-node-hmr:5173` 与 `web-node-hmr:5174`，触发一次编辑 → **`{5173:1, 5174:0}`**。

**3. 顺手修的 UX/真实 bug**
- **端口自动发现**：`listen()` 启动的服务器会让 `client.run` 永不 resolve（不退回），以前端口下拉要手动 Refresh。新增 `startPortWatch()`（每 1.5s 轻量 `describe()`），端口集合变化才刷新 → 启动 dev server 后预览自动出现（也顺便保证 `hmrRelay.follow(port)` 被调用）。
- **`hmred` 反引号陷阱又中一次**（在 `demo-project.ts` 内嵌的 `vite-dev.mjs` 注释里）。同一条约定再现：内嵌源码字符串禁用反引号 / `${` / 反斜杠。

**测试**：仍 **100/100**（本里程碑为集成行为，主要靠 `tools/e2e-subdomain-hmr.mjs` 端到端验证）。

**线上验证（GitHub Pages / 路径前缀模式）**：`npm run deploy` 后跑 `tools/e2e-pages-hmr.mjs`——预览 src 为 `https://mcuking.github.io/web-node/preview/5173/`；JS HMR 原地变 `#1`、CSS 颜色 `rgb(94,241,165)` → `rgb(124,196,255)`，两次 marker 均存活。同源模式下 shim 直接用 BroadcastChannel（不经中继），验证了两条路径。

**新增验证工具**：`tools/e2e-subdomain-hmr.mjs` 扩到 JS+CSS 两阶段（含端口发现、每步超时、SW 重注册）；`tools/probe-hmr-ports.mjs`（端口隔离计数）；`tools/e2e-pages-hmr.mjs`（线上路径前缀模式）。

**涉及文件**：`public/sw.js`、`src/demo-project.ts`、`src/ui/main.ts`、`index.html`、`README.md`、`README_zh.md`、`tools/e2e-subdomain-hmr.mjs`、`tools/probe-hmr-ports.mjs`（新）

### 2026-09-17 · M3.5d 子域名路由：每个预览一个真实源（`<port>.localhost`）

**目标**：把 M3 长期挂账的「预览走路径前缀」换成 WebContainer 形态的真源隔离——`<port>.localhost:<devport>`（浏览器把 `*.localhost` 解析到 loopback），这样绝对路径、cookie、storage 都按真实站点行为。

**方案**：runtime/VFS/OPFS 仍单例住在主源（`localhost:5199`）；子域名只托一个 bootstrap 壳，经 `postMessage` 把请求中继回主源页面。
- **dev 中间件**（`plugins/dev-subdomains.ts`，新）：拦 `<port>.localhost` 上的 `/__webnode__/`，回一个 bootstrap 壳：注册子域名 SW → 把 SW 的每个虚拟请求 `window.top.postMessage(data, '*', ports)`（MessagePort 跨源转移）→ 同源子帧 `src='/'` 加载真应用（由 worker 从 VFS 供给）。其余路径一律放行给应用。
- **`public/sw.js` 新增 SUBDOMAIN_MODE**：shell 路径（`SUBDOMAIN_SHELL_PATH`）直接放行，不当作预览资源；按 `event.clientId → port` 记账 + referrer 兜底的路由保持。
- **HMR 跨源中继**：子域名是别的源，`BroadcastChannel` 听不到。上行：app 帧 → `window.top`（=主页面）→ 主页面的 `installHmrRelay` 进 BroadcastChannel；下行：runtime → 主页面 → 壳（`previewFrame.contentWindow`）→ app 帧（壳里新增一个 `__wnHmr` 监听转发）。
- **`src/ui/preview-url.ts`**（新，纯函数）：`previewUrl()` 按环境选——dev + `base==='/'` + loopback → 子域名壳；否则回退路径前缀。`prefixPreviewUrl()` 专供 pop-out 链接。

**踩过的坑（重要，别重犯）**：
1. **被 iframe 嵌入的文档必须自带 COEP，光有 CORP 不够**。主壳是 `COEP: require-corp`，子域名壳文档必须自己也发 `Cross-Origin-Embedder-Policy: require-corp`，否则 Chrome 直接拒加载（`coep-frame-resource-needs-coep-header`，而不仅是空白）。
2. **导航请求不能被预览路由劫持**。按 `clientId→port` 兜底的路由会把主壳的**导航**抢成预览（出现 `base href=/preview/3000/` 的错页）。修复：`request.mode === 'navigate'` 直接放行。
3. **`demo-project.ts` 的反引号陷阱又中一次**（这次在 `plugins/dev-subdomains.ts` 的 bootstrap 字符串里）：注释里写 `window.top` 用了反引号，直接让模板字面量提前闭合 → dev server 编译报 `Expected ";" but found "window"`。约定重申：内嵌源码字符串里禁用反引号 / `${` / 反斜杠。
4. 调试时注意：`Runtime.evaluate` 的 **isolated world 与主世界不共享 `window`**（共享 DOM）；用 `createIsolatedWorld` 插桩，通过 script 元素跑在主世界的计数器要写到 DOM 上才能从 isolated world 读回。

**演示**：dev server 下预览 URL 变为 `http://<port>.localhost:5199/__webnode__/`。已验：3000（demo 服务器，含 `/api/info`）与 5173（Vite dev + **HMR 原地热更、marker 存活不刷新**）。构建 / Pages 仍走路径前缀（已 Regression 验证）。

**测试**：95 → **100**。新增 `test/preview-url.test.ts`（5：dev 子域名、非 loopback 回退、子路径构建回退、带 devport 原样拼接、`prefixPreviewUrl`）。

**涉及文件**：`plugins/dev-subdomains.ts`（新）、`src/ui/preview-url.ts`（新）、`test/preview-url.test.ts`（新）、`public/sw.js`、`src/client/index.ts`、`src/ui/main.ts`、`vite.config.ts`、`tsconfig.json`、`tools/e2e-subdomain-hmr.mjs`、`tools/probe-hmr-relay.mjs`

### 2026-09-17 · M5e HMR 走非 WebSocket 通道（+ 一个把 HMR 静默搞坏的 loader bug）

**目标**：在标签页里跑**真正的 Vite HMR**。障碍：HMR 跑在 WebSocket 上，而 **ServiceWorker 代理不了 WebSocket**（`fetch` 拦截不到 upgrade），浏览器经预览桥永远到不了 dev server 的 HMR 端口。

**方案：BroadcastChannel**（预览 iframe 与 runtime worker 同源）：
- **预览侧垫片**（`public/sw.js`）：SW 在注入 `<base>` 时顺带注入一段 `WebSocket` 垫片。识别信号以 **`vite-hmr` 子协议**为准（Vite 的 HMR 客户端总带它；https 页面上它还可能把首个目标设成**页面源**而非 loopback），loopback 主机名作兵兵补充；命中的改道到 `BroadcastChannel('web-node-hmr')`，其余原样交给浏览器。
- **runtime 侧桥**（`/project/vite-dev.mjs`）：造一个与 `createWebSocketServer` 返回形状一致的对象（`send/on/off/clients/close`），赋给 `server.hot` / `server.ws`。**Vite 照常计算更新，我们只负责搬运**（协议仍是 Vite 的 `connected` / `ping`-`pong` / `update` / `full-reload`）。
- **文件监听**：Vite 原生用 chokidar（要 `fs.watch` + inotify，标签页里没有）。新增 **VFS 变更订阅** + `fs.watch`，demo 里一个小插件把 VFS 事件转发进 Vite 的（noop）watcher，接入 HMR 管线。

**顺带修掉一个真 bug（不止影响 HMR）**：loader 的 ESM 转换用**全局正则**改写 `import.meta`，结果连**字符串数据**一起改了。Vite 的 dist 里有 `rawUrl === "import.meta"`，被改成了 `rawUrl === "({ url: __mod_url })"`（恒 false），于是 HMR 的 hot-context 注入被静默跳过。**修复**：新增长度保持的 `codeMask`（把字符串/模板原文/注释/正则的**字符内容**抹成空格），改写只落在**代码**上——任何把字面量 `"import.meta"` 当数据用的打包产物都不再被破坏。文件：`src/node-runtime/loader/esm-transform.ts`

**新增能力**：VFS `subscribe()`（`create/change/delete`）+ `fs.watch(path, opts, cb)`（目录监听给 basename，create/delete 映射为 Node 的 `rename`、编辑映射为 `change`）。文件：`src/node-runtime/vfs/{types,memory}.ts`、`src/node-runtime/builtins/fs.ts`

**演示**：「🛠 Vite dev」现以 HMR 开启启动；新增「✏️ HMR edit」按钮写入 `site/src/message.js`，预览**原地热更新**（不整页刷新）。验证：在预览窗口挂一个变量，热更后它仍在 → 确属模块热替换而非 reload；HMR 载荷为 `js-update`（`acceptedPath:/src/message.js`）；终端可见 `vfs-change : change src/message.js`（即 VFS 事件→HMR 的全链路）。本地（dev 与 build 产物）与线上 GitHub Pages 均已验证。

**测试**：95/95（10 个文件）。新增：VFS 订阅事件序列；`fs.watch` 递归/停用；esm-transform「改写只碰代码」5 例（字符串/注释/正则/模板插值/动态 import）。

**已知限制**：HMR 客户端仍按 Vite 默认目标连接（本地为 loopback，https 下可能是页面源）；垫片按 `vite-hmr` 子协议识别并改道，对所有目标都适用。

### 2026-09-17 · M5d Vite **dev server** 在页内跑通（+ 预览路由修正绝对路径）

**目标**：不只是 `vite build`，而是 Vite 的 **dev server 编排层**——在标签页里 `createServer()` + `listen()`，按需转换模块。

**结果**：dev server 真的在运行时里起来了：`createServer({ root })` → `server.listen(5173)`，`/` 返回 200 并注入 `/@vite/client`，`/src/main.js`、`/src/message.js` 按需转换，`/@vite/client` 返回 137KB。预览 iframe 真实渲染出 `Hello from vite, bundled in the browser`。

**为什么能跑**：Vite dev server 只是「一个用到 `http`/`net`/`fs`/`dns` 的 Node 程序」。之前只有 build 路径通，dev 路径多了三处：
- **`dns` builtin（新）**：Vite 的 `buildStart` 会 `dns.promises.lookup('localhost')` 判断能否广播 `127.0.0.1`。虚拟网络里一切都在本机，所以诚实语义就是**所有主机名解析到 loopback**（`dns` / `dns/promises` 两个 spec；`lookup` 支持 callback / `all` / `family` / `verbatim`，无 callback 同步抛 `ERR_INVALID_ARG_TYPE`，查询类 API 抛 `NotImplementedError`）。文件：`src/node-runtime/builtins/dns.ts`
- **`process.stdin` 改成真 EventEmitter**：Vite `close()` 会 `stdin.off('SIGTERM'…)` 卸载监听，以前的裸对象没有 `.off` → 直接崩。文件：`src/node-runtime/builtins/process.ts`
- **移除 stub `dns`**（被真实现取代）。文件：`src/node-runtime/builtins/unsupported.ts`

**顺带修好预览路由的「绝对路径」根病**（也是 M3 遗留的已知限制）：
- Vite dev server 输出**绝对路径**资源（`/@vite/client`），还有**链式 import**（`main.js` 再 import `/src/message.js`），它们都不在 `/preview/<port>/` 前缀下，旧 SW 直接放行 → 404。
- SW 新增：**按客户端记住预览端口**（`clientId → port`）。预览文档与其所有子资源共享同一个 client id，所以导航预览时记账，之后该客户端的绝对路径请求（含链式 import）就能回路由到正确端口；referrer 作为兜底。这同时修复了 M3 长期记录的「绝对路径资源落在前缀外」。
- 修正 `resolveClient`：原直接的 `clientId` 分支会把**预览 iframe 自己**当成 runtime host（它是 Vite 页面，没有 runtime 监听器）→ 消息石沉大海 → `502 virtual server timed out`。现在两条分支都拒绝预览客户端。文件：`public/sw.js`

**演示**：「🛠 Vite dev」按钮 → `/project/vite-dev.mjs`（动态 `import('vite')` → 初始化 esbuild-wasm → `createServer` → `listen(5173)` → 常驻）。UI 新增按钮：`index.html`、`src/ui/main.ts`、`src/demo-project.ts`

**测试**：85 → **87**。新增：`process.stdin` 具备 EventEmitter 表面；`dns`/`dns/promises` 主机名解析到 loopback。把旧的「stub 模块被调用即抛」用例从 `dns` 改为 `child_process`（`dns` 已真实现）。

**已知限制 / 暂缓：HMR**。HMR 靠 WebSocket，而 **ServiceWorker 无法代理 WebSocket**（`fetch` 拦截不到 upgrade 连接），所以浏览器永远到不了 dev server 的 HMR 通道。故 demo 以 `hmr: false` 启动。要真做 HMR，需绕开 SW：让 Vite 的 HMR 走自定义通道（如 `MessageChannel`），属架构改动，暂缓。

### 2026-09-17 · GitHub Pages 部署：子路径站点 + `gh-pages` 发布

**目标**：把已实现的功能部署成在线 demo，链接写进仓库描述。

**子路径适配**（Pages 的 project site 跑在 `/web-node/`）：之前 SW 与预览路由写死 origin 根路径，搬到子路径会全挂。
- `vite.config.ts`：新增 `base`，由 `BASE_PATH` 环境变量控制（默认 `/`，部署时 `/web-node/`）。HTML 里的 script/link 与 worker 引用自动带上前缀。
- `public/sw.js`：`PREVIEW_PREFIX` 从写死 `/preview/` 改为由 `new URL('./', self.location).pathname` 推导（dev=`/`，Pages=`/web-node/`），`<base>` 注入与 client 归属判断同步。
- `src/client/index.ts`：SW 注册路径/作用域改为 `import.meta.env.BASE_URL`（`/web-node/sw.js`，scope `/web-node/`）。
- `src/ui/main.ts`：预览 URL 用 `BASE_URL` 拼。

**发布**：新增 `tools/deploy-pages.sh`（+ `npm run deploy`）——`BASE_PATH=/web-node/` 构建 → `dist/` 推到 `gh-pages` 分支（带 `.nojekyll`，临时 repo，不动主仓库）。不用 Actions。

**Pages**：仓库已设 Source = gh-pages / (root)，push 后自动重建，站点 `https://mcuking.github.io/web-node/`（强制 HTTPS）。仓库描述与 Website 字段已指向该链接。

**线上实测**：`/web-node/` 200；runtime ready（16 bindings / 8 vendored / OPFS on）；SW scope = `https://mcuking.github.io/web-node/`；Run → `/web-node/preview/3000/` 200（`<base href="/web-node/preview/3000/">`）；Install deps 11 包 8.3s；⚡ Vite build → `vite v5.4.21 (running in the tab)` · `built in 197ms`。

**注**：`vite preview` 不发送 dev 的 COOP/COEP 头，与 Pages 一致——实测证明运行时并不依赖 SharedArrayBuffer。

### 2026-09-17 · M5c 真实构建工具链：Vite 本体在页内完成 production build

**目标**：把 **Vite 本体**（不是 esbuild、不是 rollup，而是 Vite 自己）在标签页里跑起来，完整做一次 `vite build`。

**为什么难**：Vite 是纯 ESM，且 `import esbuild from 'esbuild'`（原生 addon）。两边都要处理：① 我们的 ESM→CJS 转换器必须能啃下 Vite 那种 6.7 万行的 bundle；② `esbuild`/`rollup` 需要别名到 WASM 构建（运行时已设）。

**核心改动：重写 ESM→CJS 转换器**（`src/node-runtime/loader/esm-transform.ts`）
- 从**逐行**改成**基于扫描器的顶层语句切分**（`splitStatements`）：跟踪字符串/模板字面量（含嵌套 `${…}`）/注释/正则/括号深度，只在真正的顶层 `;` 或块结束处切分。多行 `import` 和多行模板字面量是 Vite bundle 的常态，逐行处理必崩。
- **token 级关键字判断**决定 `/` 是正则还是除号（`return /re/` vs `a / b`）。判断错会让括号深度从那一刻起漂移（实测漂了 +3，末尾的 `export` 因深度不为 0 被漏掉）。
- **顶层 `export`/`import` 关键字**作为语句边界（前一条函数声明可能没有分号，会吞掉后面的 `export`）。
- ESM 包装形参改用 **`__wn_*` 前缀绑定**（`__wn_exports`/`__wn_require`），且 **不注入 `require`/`exports`/`__filename`/`__dirname`**——Vite chunk 会自己写 `const require = createRequire(import.meta.url)`、`const __filename = …`，注入同名形参会直接 `Identifier already declared`。
- 修好的真实 bug：① `export { a as b } from 'm'` 之前错误地读局部变量（应从被 require 的模块取值）；② `import.meta.url` 未转换（`new Function` 里是硬语法错误）；③ 前导 license 块注释导致 `startsWith('import')` 失效（新增 `leadTrim`）；④ **动态 `import()`** 在 `new Function` 里 V8 直接报 “A dynamic import callback was not specified” → 重写为 `__wn_import`（loader 提供的异步加载，按 `import` 条件解析）。

**其余修复（都是 Vite 真实踩到的）**
- **PathLike**：`fs.readFileSync(new URL(...))` / Buffer 路径 → 在 VFS 唯一漏斗 `resolve()` 统一归一化（`posix.toPathValue`）。文件：`vfs/posix.ts`、`vfs/memory.ts`、`vfs/types.ts`
- **`createRequire(...).resolve`**：Vite 用它把 id 映射成路径而不加载 → `userRequire` 挂上 `.resolve`。文件：`runtime.ts`、`realm.ts`、`builtins/module.ts`、`builtins/types.ts`
- **`events` 语义**：Node 里 `module.exports === EventEmitter`（构造器本身带命名导出），之前返回的是普通对象，导致 `import EventEmitter from 'events'; class X extends EventEmitter` 报 “Class extends value #<Object> is not a constructor”。文件：`builtins/events.ts`
- **`unsupported` stub 的 interop**：`has()` 恒真 + `__esModule` 返回“抛错的函数”（真值），使 `__wnDefault` 误判成 ES 命名空间并取 `.default`，`import tty from 'tty'` 拿到的是 stub 函数 → interop 键改为返回 `undefined`。文件：`builtins/unsupported.ts`
- **`fs.realpathSync.native`**：Vite 做特性探测（`fs.realpathSync.native ?? fs.realpathSync`）→ 补上 `.native`。文件：`builtins/fs.ts`
- **新增 `crypto` builtin**（纯 JS SHA-1/SHA-256/MD5 + WebCrypto 随机数）+ **`unsupported` stub 模块**（`tty`/`child_process`/`dns`/`v8`/`worker_threads`/`readline`/`tls`/`zlib`：**加载不抛**，仅“使用”才抛 `NotImplementedError`，因为 `import 'node:tty'` 这类副作用导入不能炸）。文件：`builtins/crypto.ts`、`builtins/unsupported.ts`

**演示**：新增「⚡ Vite build」按钮 → 跑 `/project/vite-build.mjs`（动态 `import('vite')` → 初始化 esbuild-wasm → `vite.build()` → 写回 `/project/site/dist/`）。新增站点源码 `/project/site/{index.html,src/main.js,src/message.js}`；`package.json` 新增 `vite`/`postcss`/`picocolors`/`source-map-js`/`nanoid`。文件：`index.html`、`src/ui/main.ts`、`src/demo-project.ts`

**测试**：82 → **85**。新增 Vite 未安装时的提示用例；把旧的「`crypto` 未实现即抛」改为「白名单外模块抛」并新增 stub 行为用例（`tty.isatty()` 返回 false、`dns.lookup()` 抛）。另：`tsconfig.json` 排除 `test/_*.test.ts`（一次性可行性验证脚本读真实磁盘，不参与 `tsc` 门禁；vitest 仍会跑）。

**浏览器实测**：Reset → Install deps（11 个包，含 `vite@5.4.21`）→ ⚡ Vite build：`vite v5.4.21 (running in the tab)` · `esbuild wasm started in 33ms` · `built in 148ms` · 产物 `site/dist/assets/index-*.js` + `site/dist/index.html`（真实 Vite production 输出，含 modulepreload polyfill）。重载后产物仍在 OPFS 里。

### 2026-09-17 · M5b 真实打包器：rollup（官方 WASM 构建）在页内做 tree-shaking

**目标**：把真正的打包器跑起来。选了 **rollup**——它是 Vite 的底层打包器，官方提供 `@rollup/wasm-node`（用 WASM 代替 napi 原生二进制，浏览器可用）。

- **新增 builtins**：
  - `fs/promises`（= `fs.promises`，rollup 直接 `require('node:fs/promises')`）
  - `perf_hooks`（直接用浏览器的 `performance`）
  - `url`（原生 `URL`/`URLSearchParams` + `pathToFileURL`/`fileURLToPath`/`urlToHttpOptions` + 简单 legacy `parse`/`format`）。文件：`src/node-runtime/builtins/{fs-promises,perf-hooks,url}.ts`、`builtins/index.ts`
  - `child_process` **不提供**：不需要，且保持“require 即抛明确错误”的诚实行为。
- **Loader 修复 1：`main` 先于 `module`**。之前 `#packageEntry` 把 `module`（ESM）排在 `main`（CJS）前，rollup 因此被解析到 ESM 构建后编译失败。Node 的 `require` 语义应先看 `main`（`module` 只是打包器字段）。修正后 rollup 正确走到 CJS 入口。
- **Loader 修复 2：不再注入“宿主同名”全局**。CJS 包装把沙箱里的每个全局都做成形参，而沙箱镜像的宿主全局（`btoa`/`performance`/`TextEncoder`…）与模块自己的顶层 `const btoa = …` 冲突（`Identifier 'btoa' has already been declared`，rollup 真实踩到）。现在**只在沙箱值与宿主不同时才注入**（同名的一致值本就能通过真实全局作用域拿到）。沙箱特有的 `process`/`Buffer`/`console`/timers/`globalThis` 仍照旧注入。
- **演示**：新增「⧉ Bundle」按钮 → 跑 `/project/bundle.js`：`require('@rollup/wasm-node')` → `rollup.rollup({input})` 直接读 VFS 源码（我们的 `fs` 就是 VFS，无需插件）→ `generate({format:'es'})` → 写回 `/project/dist/app.esm.js`。演示新增 `/project/app/main.js`、`app/text.js`（含死代码 `explode` 用于展示 tree-shaking）；`package.json` 新增 `@rollup/wasm-node` 依赖。文件：`index.html`、`src/ui/main.ts`、`src/demo-project.ts`
- **测试**：78 → **82**。新增：`fs/promises` 与 `fs.promises` 同源、`perf_hooks`/`url` 基本接口、`const btoa` 不再冲突、rollup 未安装时 build.js/bundle.js 给提示。
- **浏览器实测**：Reset → Install deps（`ms` + `esbuild-wasm` + `@rollup/wasm-node` + `@types/estree`，scoped 包正常）→ Bundle：`rollup v4.63.3 (official WASM build)` · `bundle: 339 bytes in 13ms` · `tree-shaken: yes (dead export dropped)` · `written: /project/dist/app.esm.js`。**重载后不重装**直接再 Bundle/Build 均成功（OPFS base64 持久化对 577KB 与 13.3MB wasm 都完好）。

### 2026-09-17 · M5 真实构建工具：esbuild WASM 在页内打包 + OPFS 二进制持久化修复

**目标**：把一个真实构建工具跑起来。选了 **esbuild**，因为它是 Vite 内部的转换/预打包器，且官方提供 **WASM 构建**（浏览器原生，零依赖）。

- **`browser` 字段支持**（loader）—— 关键前置。`esbuild-wasm` 的 `main` 是 Node 构建（需 `child_process`/`worker_threads`/`tty`），必须按 npm 约定解析到 `browser` 指向的自包含浏览器构建。实现了字符串形式（重定向入口）和对象形式（`{"fs": false, "...": "..."}`），`false` 映射为空模块；作用于入口解析与包内相对/裸说明符重映射。文件：`src/node-runtime/loader/index.ts`
- **`require.resolve`**：新增模块级 `require.resolve(request[, {paths}])`，与 Node 签名一致；esbuild 插件用它做 `node_modules` 解析。文件：同上
- **沙箱浏览器全局**：用户模块里的 `globalThis` 是沙箱对象，因此把标签页真正拥有的全局（`WebAssembly`/`crypto`/`performance`/`TextEncoder`/`TextDecoder`/`Blob`/`Worker`/`fetch`/`self`…）镜像到沙箱上；宿主没有的（Node 下）跳过，`self` 回退到真实全局。没有这步 esbuild 会在 `globalThis.crypto` 上报错。文件：`src/node-runtime/runtime.ts`
- **演示**：新增「▦ Build」按钮 → 跑 `/project/build.js`：从 VFS 读 `esbuild.wasm` → `WebAssembly.compile` → `esbuild.initialize({worker:false})` → 用 VFS 插件 `build()` 打包 `src/app.ts`（TS + 真实 `node_modules` 依赖 `ms`）→ 写回 `/project/dist/app.js`。演示还新增 `src/app.ts`/`src/greet.ts`。文件：`index.html`、`src/ui/main.ts`（`runEntry` 重构）、`src/demo-project.ts`
- **OPFS 二进制持久化 bug（M5 暴露）**：`MemoryVfs.snapshot()` 用 `TextDecoder()`（UTF-8）解码文件字节，非文本内容被破坏并膨胀（13.3MB 的 wasm 变 17.2MB，重载后 `WebAssembly.compile` 报 `length overflow`）。改为 **base64**（新增 `src/node-runtime/vfs/base64.ts`，零依赖），`fromSnapshot` 支持 `base64`/`text` 两种编码；OPFS 快照加 `{v:2}` 标记，旧格式（v1 纯文本）仍可读。文件：`src/node-runtime/vfs/{memory,opfs,base64}.ts`、`src/worker/runtime.worker.ts`（恢复逻辑改用 `fromSnapshot`）
- **测试**：69 → **78**。新增 `test/browser-field.test.ts`（4：字符串入口、对象重映射、`false`→空模块、无 browser 字段回退 main）、`test/build.test.ts`（3：`require.resolve` 相对/裸/子路径、browser 字段参与解析、未安装 esbuild-wasm 时 build.js 给提示）、`test/vfs.test.ts`（+2：二进制快照往返、旧文本快照兼容）
- **浏览器实测**：Reset → Install deps（`ms@2.1.3` + `esbuild-wasm@0.28.2`）→ Build：`tool: esbuild-wasm v0.28.2 (13.3 MB wasm)` · `wasm: compiled + service started in 37ms` · `bundle: 5138 bytes in 116ms` · `written: /project/dist/app.js`；再运行产物得到 `hello, world! | hello, web-node! | hello, browser!  (ms: 7200000ms)`。

### 2026-09-17 · http 健壮性：handler 抛异常不再卡死 keep-alive 连接

验收 M4/M3.5 时发现：请求 handler **同步抛异常**（如 `fs.readdirSync('/nope')` 抛 ENOENT）时，异常穿透 `emit('request')`，连接被卡死 —— 客户端等 15s 才超时，且该池化连接后续请求全部失效。

- **handler 抛异常**：`Server.#serveConnection` 用 try/catch 包住 `emit('request')`。若响应还没刷出（`#flushed=false`）→ 用 `ServerResponse._fail()` 把状态行/头换成 **500** 并发回，连接保持可用；若已经写了字节（响应中途抛）→ 销毁 socket。
- **客户端感知断链**：`Connection` 的 `socket.onClose` 之前只 `destroy()` 不通知等待中的响应，而 `_stream`/`_request` 只认 `onError`。现在 close 时若仍有 pending 响应，向上报 `socket hang up`，SW 立即返回 502 而不是挂到 15s。
- **测试**：68 → **69**（net-http 18 → 19）。新增：handler 同步抛 → 500 且同连接后续请求仍可用；响应中途抛（已 flush）→ 客户端收到 error（hang up）而非挂起，新连接仍正常。
- **文件**：`src/node-runtime/builtins/http.ts`、`test/net-http.test.ts`
- **浏览器实测**：`/preview/3000/api/ls?dir=<不存在>` 从 502/15s 超时 → **500 Internal Server Error / 1ms**，之后 `/api/info` 仍 200。

### 2026-09-17 · M3.5 网络收敛：keep-alive + 浏览器侧真流式 + https（子域名路由暂缓）

四项做了三项：

- **keep-alive（HTTP/1.1 持久连接）**
  - `HttpMessageReader` 可复用：读完一条消息后置 `done` 但继续缓冲，`rest()` 把下一条（pipelined）消息的字节交回，便于连接重新武装。顺便补上了 **chunked trailer 段的消费**（之前 `0\r\n` 后的结尾 CRLF 会泄漏到下一条消息，导致 keep-alive 下第二条请求解析失败）。
  - `Server.#serveConnection` 改为连接循环：每个 reader 局部持有自己的 `req`/`res`，响应结束时（延迟一个 tick，因为 handler 可能在 `onHead` 里同步 `res.end()`）重新武装，并回放抢先到达的字节。
  - **客户端连接池**：新增内部 `Connection`（socket 数据回调只注册一次，永远喂给「当前」reader，避免监听器堆积）+ 按端口的 idle 池；`http._request` 默认发 `Connection: keep-alive` 并复用连接。`IncomingMessage._destroy` 不再在正常完成时销毁 socket（之前会把待复用的连接杀掉）。
  - `ServerResponse` 根据请求/响应头决定 `Connection`，不再无条件写 `close`。
  - 文件：`src/node-runtime/builtins/http.ts`
- **浏览器侧真流式**
  - `http._stream(port, init, handlers)`：先回调 head，再逐块回调 body；`_request` 改为基于它实现。
  - worker 新增 `httpStream` 消息，把 head/chunk/end 分别 `postMessage`。
  - `RuntimeClient` 新增 `#serveViaStream`：把每个 chunk 经 MessagePort 转发给 SW。
  - `public/sw.js`：用 `ReadableStream` 组装 Response，`res.write()` / SSE / 大文件**边产生边到达**浏览器。HTML 是唯一例外（为注入 `<base>` 先缓冲）。
  - 文件：`src/node-runtime/builtins/http.ts`、`src/worker/runtime.worker.ts`、`src/client/index.ts`、`public/sw.js`
- **https**：`http` 的同名壳（虚拟网络里没有 TLS，浏览器也开不了裸 TCP 口）；真 TLS 选项接受但忽略，不假装安全。文件：`src/node-runtime/builtins/https.ts`、`builtins/index.ts`
- **子域名路由暂缓**：`<port>.localhost:5199` 是**另一个源**，而 runtime/VFS/OPFS（按源隔离）都在 `localhost:5199`。强做会导致「每个子域名一份 runtime（看不到主源 OPFS）」或需要新增跨源中继层。见「已知限制」与「下一步」。
- **测试**：61 → **67**。新增：keep-alive 单连接复用 3 次请求、`Connection: close` 后重连、单 socket 写入两条 pipelined 请求、`_stream` 的 head/chunk 顺序与增量交付、`_stream` 连接失败 `ECONNREFUSED`、https 往返。
- **浏览器实测**：`/preview/3000/api/stream` 从「最后一次性返回」变为 **6 个 chunk，间隔 ~30ms**（与 `setInterval(30)` 一致）；HTML `<base>` 注入、JSON、下载（197B）、目录列举均无回归；console 无报错。

### 2026-09-17 · M4 npm client：registry 解析 + tarball 解包 + node_modules 写入 VFS

- **交付**：点 **Install deps** 会读项目 `package.json`，向 npm registry 解析版本、下载 tarball、gunzip+untar 后写入虚拟 `node_modules`；之后 `require('ms')` 直接可用。
  - `src/node-runtime/npm/semver.ts`（新）—— 极简 semver：`^ ~ = > >= < <= *`、部分版本、通配符、hyphen range、`||` 并集、prerelease 门控；导出 `parseVersion`/`compare`/`satisfies`/`maxSatisfying`/`minSatisfying`。
  - `src/node-runtime/npm/tarball.ts`（新）—— `gunzip`（平台 `DecompressionStream('gzip')`，零 zlib 依赖）+ `untar`（ustar + pax `path`/`size` 扩展 + GNU longname；剥掉 npm 的 `package/` 前缀；忽略 symlink/device）。
  - `src/node-runtime/npm/registry.ts`（新）—— `createRegistry(fetch, baseUrl)`：packument（用 `application/vnd.npm.install-v1+json` 精简文档）+ tarball 下载，均按实例 memoize。`fetch` 以 **FetchLike** 注入，测试无需网络。
  - `src/node-runtime/npm/install.ts`（新）—— `installProject(vfs, opts)`：解析依赖→**npm 式 hoisting**（能复用祖先已装的兼容版本就复用，否则放最浅的空位，冲突则嵌到依赖者自己的 `node_modules`）→ 每个 `name@version` 只下载解包一次 → 写 VFS。
  - `src/node-runtime/runtime.ts` —— 新增 `installDependencies({ cwd, includeDev, onLog, fetch })`，默认取宿主 `fetch`。
  - `src/worker/runtime.worker.ts` —— 新增 `npmInstall` 消息；安装日志逐行走 `stdout`；完成后调度 OPFS 持久化。
  - `src/client/index.ts` —— `installDeps({ cwd, includeDev })`。
  - `index.html` + `src/ui/main.ts` —— 顶栏新增 **⬇ Install deps** 按钮；文件树过滤 `node_modules`（保持可读）。
  - `src/demo-project.ts` —— demo `package.json` 声明 `dependencies: { ms: '^2.1.3' }`；`index.js` 加 `-- npm --` 段（`require('ms')`，未装时给提示）；`notes.md` 勾掉 M4。
  - `test/npm.test.ts`（新，11 条）—— semver 语义；gunzip+untar（含 pax 长路径）；离线假 registry 端到端：安装+hoisting+`require`、版本冲突嵌套、范围无解告警。
- **为什么**：npm client 是 WebContainer 形态的核心能力，也是 M5（跑真实构建工具）的硬前置；resolver 的 `node_modules` 逐级向上解析早已就绪，正好接上。
- **踩过的坑（重要，别重犯）**：
  1. **TS 5.6 + DOM lib 下 `new Blob([uint8])` 编译报错**：`Uint8Array<ArrayBufferLike>` 不满足 `BlobPart`（要求 `ArrayBufferView<ArrayBuffer>`）。**修复**：用 `bytes.buffer.slice(byteOffset, byteOffset+byteLength) as ArrayBuffer` 传 `Blob`。
  2. **不要为了 gzip 去实现 inflate**：浏览器与 Node 18+ 都有 `DecompressionStream('gzip')`，直接 `new Blob([...]).stream().pipeThrough(ds)` 即可。
  3. **npm tarball 的长路径走 pax 扩展头**（`typeflag='x'`，记录 `path=`），不是 ustar 的 prefix 字段；只按 100 字节 name 截断会写错文件。解析 pax 时记录长度要**含长度前缀自身**（迭代到不动点）。
- **验证**：`tsc --noEmit` 干净 · `vitest run` **61/61** · `vite build` 绿。浏览器实测：Reset 项目 → Install deps → `+ ms@2.1.3` / `↓ ms@2.1.3` / `[installed 1 package(s) in 521ms]` → Run 输出 `require(ms) : 1m | 7200000ms`；`/preview/3000/api/info` 仍 200（无回归）；文件树不含 `node_modules`。
- **限制**（记入 demo notes）：不跑生命周期脚本、不建 `.bin`、不自动装 peer、不读写 lockfile、不校验 integrity、不支持 `file:`/`git+`/`link:` 说明符；根级同名版本冲突按声明顺序保留第一个。

### 2026-09-17 · README 英文化 + 仓库转公开

- **改了什么**：
  - 中文 README 改为 `README_zh.md`（`git mv` 保留历史），新建英文 `README.md` 作为默认首页。
  - 英文 README 新增「How it works」架构图、「Networking」/「Streams」/「Roadmap」/「Contributing」等章节，顶部加语言切换（English · 简体中文）。
  - 顶部两份 README 互相链接；中文版同样补充语言切换行。
- **为什么**：对外公开仓库需要英文门面；中文内容保留给团队。
- **涉及文件**：`README.md`（新，英文）、`README_zh.md`（由 `README.md` 改名）。
- **另**：GitHub 仓库由 private 转为 public（仓库设置，不改代码）。

### 2026-09-17 · stream 前置：`stream` 模块 + `fs`/`http` 流 + chunked

- **交付**：`req.pipe(res)`、`fs.createReadStream(...).pipe(...)`、`res.write()` 流式响应都能用了；响应无 `Content-Length` 时按 `Transfer-Encoding: chunked` 分帧，客户端会再解码回来。
  - `src/node-runtime/builtins/stream.ts`（新）—— `Readable`/`Writable`/`Duplex`/`Transform`/`PassThrough` + `pipe`/`unpipe`/`read`/`push`/`unshift`/`cork`/`uncork` + `pipeline`/`finished`/`Readable.from` + `stream/promises`。**真背压**（hwm → `false` → `'drain'` → `resume()`）。`origin: 'web-node'`。
  - `src/node-runtime/builtins/fs.ts` —— `createReadStream`/`createWriteStream` + `ReadStream`/`WriteStream`（`open`/`ready`/`data`/`end`/`close`/`finish`/`bytesRead`/`bytesWritten`，支持 `start`/`end`/`highWaterMark`/`flags`/`autoClose`）。删掉了原来两个「streams milestone pending」的抛错桩。
  - `src/node-runtime/builtins/http.ts` —— `IncomingMessage` → `Readable`、`ServerResponse` → `Writable`（chunked 分帧 + `flushHeaders`）、`ClientRequest` → `Writable`；`HttpMessageReader` 新增 chunked 解码状态机。
  - `public/sw.js` —— 响应头过滤扩成完整的 hop-by-hop 列表（新增 `transfer-encoding`/`keep-alive`/`te`/`trailer`/`upgrade`）。**这条是必须的**：body 在 worker 里已经被解码成平铺字节，再把 `transfer-encoding: chunked` 转给浏览器会让它二次解帧、直接损坏响应。
  - `src/demo-project.ts` —— 新增 `-- stream --` 段落（`createReadStream` 16 字节分块读 + `pipeline` 大写写出 `facts-upper.txt`）和 4 个端点：`/download/facts.txt`（`createReadStream().pipe(res)`）、`/api/stream`（5 次 `res.write()`）、`/api/upload`（`req.pipe(createWriteStream)`）、`/api/ls?dir=`（回读 VFS）。
  - `test/stream.test.ts`（新，17 条）—— 基类语义（顺序/背压/pipe/drain/Transform/pipeline/promises/finished）+ 集成（fs 流、文件拷贝、chunked 响应、多段 `res.write()`、上传落盘、用 Transform 流式改请求体）。
  - `test/net-http.test.ts` —— GET 往返改成断言 chunked 分帧；另加一条「显式 `Content-Length` 时不 chunked」。
- **接线**：`streamSpec` + `streamPromisesSpec` 进 `ALL_BUILTINS`（排在 `fs`/`http` 之前）；`fsSpec.deps` 加 `stream`，`httpSpec.deps` 加 `stream`。
- **踩过的坑（重要，别重犯）**：
  1. **`pipe()` 里监听器的挂载顺序有坑**。挂 `'data'` 监听器会立刻把流切成 flowing 并**同步**排空已缓冲的数据；如果此时 `'end'` 回调还没挂上，就直接错过收尾（表现为 dest 永远不 `end()`、socket 不关、客户端挂死）。**修复**：`pipe()` 先挂 `'end'`/`'error'`，再挂 `'data'`。
  2. **`'end'`/`'finish'` 不能同步发射**。Node 是异步发射的；同步发射会导致「先 `end()` 再挂 `'finish'` 监听器」这种极常见写法收不到事件。**修复**：`Readable.#drain()` 的 `'end'`/`'close'` 和 `Writable.afterFlush()` 的 `'finish'`/`'close'` 一律 `defer()`（`ctx.binding.nextTick`）。
  3. **Writable 的状态不能放 `#private` 字段**。`Duplex`/`Transform`/`PassThrough` 是靠把 Writable 的 API 混入 Readable 子类实现的（Node 结构上也如此），私有字段是 per-constructor、混入后取不到。**修复**：Writable 状态放 `WeakMap`，配模块级 `doWrite()/afterFlush()` 函数。
  4. **`demo-project.ts` 的反引号陷阱又踩了一次**。往 `notes.md` 里写 markdown 反引号（如 `` `Content-Length` ``）会直接让模板字面量提前闭合 → 编译报 `Module declaration names may only use ' or " quoted strings`。**约定重申**：内嵌源码（含 `notes.md`）里禁用反引号 / `${` / 反斜杠。
  5. **`Buffer` 是沙箱全局**（`runtime.ts` 的 `sandboxGlobal` 里注入了 `Buffer`），用户代码里再写 `const { Buffer } = require('buffer')` 会撞上 prologue 的声明 → `Identifier 'Buffer' has already been declared`。写测试时别重复声明。
- **验证**：`tsc --noEmit` 干净 · `vitest run` **50/50** · `vite build` 绿。浏览器实测：Run 输出 `read stream : 197 bytes in 13 chunks of <=16` + `pipeline : facts-upper.txt written`；`/download/facts.txt` → 197 字节；`/api/stream` → `tick 1;…;done`；POST `/api/upload` → `{"bytes":21}`；`/api/ls?dir=/project/output` → `facts-upper.txt, facts.txt, report.txt, upload.txt`；`crossOriginIsolated: true`。

### 2026-09-17 · M3 网络：虚拟 TCP + ServiceWorker 桥 + 预览面板

- **交付**：`http.createServer().listen(3000)` 现在可以从浏览器 URL 访问。
  - `src/node-runtime/net/network.ts`（新）—— `VirtualNetwork` + `VirtualSocket`：端口表 + 双工字节管道。`write()` 始终异步交付；`dial()` 在未绑定端口上抛 ECONNREFUSED，重复 `listen` 抛 EADDRINUSE。这是将来替换为 SharedArrayBuffer/wasm transport 的接缝。
  - `src/node-runtime/builtins/net.ts`（新）—— `net` builtin（`Server`/`Socket`/`createServer`/`connect`），基于 VirtualSocket 的 EventEmitter 风格封装。
  - `src/node-runtime/builtins/http.ts`（新）—— `http` builtin：增量 HTTP/1.1 解析器（`HttpMessageReader`）、`IncomingMessage`、`ServerResponse`、`Server`、`ClientRequest`/`request`/`get`、`STATUS_CODES`，外加 `_request()` Promise 助手（供 SW 桥复用）。
  - `public/sw.js`（新）—— ServiceWorker：拦截同源 `/preview/<port>/…`，postMessage 给页面，再转发进 runtime worker。HTML 响应注入 `<base href="/preview/<port>/">` 让相对路径资源仍落在前缀内。
  - `src/client/index.ts` —— `installServiceWorkerBridge()` + `#serveViaBridge()`；`describe()` 现在返回 `ports`。
  - `src/worker/runtime.worker.ts` —— 新增 `http` 消息类型 + `serveVirtualRequest()`。
  - `src/ui/` —— 右面板 Output / Preview 双 tab、端口下拉、iframe 预览；`index.html` + `style.css` 相应调整。
  - `src/demo-project.ts` —— demo 现在起一个真 HTTP server（HTML 页面 + `/api/info` + `/api/fib`），新增 `lib/facts.js`。
- **接线**：`BindingContext.network`（新字段）；`NodeRuntime.network`；`resetRunState()` 会清空所有端口绑定（每次 Run = 全新进程，端口不残留）。`net`/`http` 进 `ALL_BUILTINS`，`PUBLIC_BUILTIN_IDS` 自动包含。
- **测试**：`test/net-http.test.ts`（新，10 条）—— echo 回声、ECONNREFUSED、EADDRINUSE、reset 清端口、GET/POST 往返、404、headers、沙箱内 `http.get`。共 **32/32 通过**。
- **踩过的坑（重要，别重犯）**：
  1. **SW 里 `event.clientId` 对导航请求是空的**。iframe 预览加载是 navigation，`clients.get('')` → undefined → 一律 503、iframe 空白。**修复**：`resolveClient()` 先试 `event.clientId`，失败则 `clients.matchAll({type:'window'})` 里挑第一个非 `/preview/` 的页面。
  2. **COOP/COEP + iframe**。dev server 带 `Cross-Origin-Embedder-Policy: require-corp`（为了 SharedArrayBuffer），被嵌入的文档必须显式声明才能渲染，否则 Chrome 静默给个空白框（无报错）。**修复**：SW 响应加 `Cross-Origin-Resource-Policy: cross-origin` + `Cross-Origin-Embedder-Policy: require-corp` + `Cross-Origin-Opener-Policy: same-origin`。
  3. **`demo-project.ts` 的转义陷阱**。嵌入代码是 TS 模板字面量，反引号 / `${` / 反斜杠都要转义，用 `edit` 工具改很容易对不上。**约定**：demo 代码里禁用这三者（换行用独立的 `console.log('')`）。
  4. 不要用 `timeout npx vite` 之类的组合——会把后台 dev server 一起带走（SIGTERM）。
- **验证**：浏览器实测 `/preview/3000/` → 200 HTML、`/api/info` → 运行时 JSON、`/api/fib?n=20` → `6765`、`/preview/9999/` → 502 ECONNREFUSED；iframe 实际渲染出绿色标题页面。

### 2026-09-17 · 修复「重复点击 Run 空跑」

- **现象**：第一次 Run 正常输出，之后每次点 Run 只打印 `[process exited 1ms]`，无任何程序输出。
- **根因**：`ModuleLoader.#cache` 按绝对路径永久缓存。`runMain()` 第二次调用直接返回缓存的入口模块 exports，**没有重新执行**，于是运行层无事可做、立刻以 exit 0 收尾，UI 就只打了一行退出信息。
- **修复**：确立「每次 Run = 一个全新进程」语义。
  - `src/node-runtime/loader/index.ts`：新增 `ModuleLoader.reset()`，清空用户模块缓存（**不动** realm 里的 builtin，那是"进程自身已加载的核心模块"，不是用户模块图）。
  - `src/node-runtime/runtime.ts`：新增 `NodeRuntime.resetRunState()`（清模块缓存 + 清所有 pending timer + `#exitCode = null`），`runMain()` 每次先调用它。
  - `src/ui/main.ts`：每次运行前打一行 `$ node /project/index.js` 表头，结束打 `[exit 0 · Nms]`，让连续运行在视觉上可区分。
- **测试**：`test/runtime.test.ts` 新增 2 条 —— 「连续 3 次 runMain 输出 3 次」「exitCode 在两次运行间重置」。共 22/22 通过。
- **验证**：浏览器连点 3 次 Run → 3 段完整输出（`demoHeaders: 3` / `exitLines: 3`）。

### 2026-09-17 · MVP 落地（M1 + M2）

- **交付**：
  - `Realm` 作为唯一「引擎替换点」，`internalBinding()` 分发表 + 16 个 binding 白名单
  - 用户代码跑在 Dedicated Worker，主线程只通过 `RuntimeClient` 通信（`src/client/index.ts`）
  - 内存 inode VFS（权威）+ OPFS 持久化（write-behind，debounce 400ms）
  - CJS 完整支持 + ESM 静态 import/export 子集（`loader/esm-transform.ts`）
  - Demo UI：文件树 / 编辑器 / 终端三栏（`src/ui/`）
- **Vendored 真 Node 源码 8 个**（`tools/vendor.mjs`，记录上游 commit + 双向 sha256 + 补丁说明）：
  `primordials.js`、`domexception.js`、`messageport.js`、`internal/constants.js`、`internal/encoding/util.js`、`internal/querystring.js`、`path.js`、`querystring.js`
- **关键决策**：
  - `internal/errors.js` **不 vendored** —— 它是 errors↔util↔inspect↔validators 环形依赖枢纽，全量 vendor 会牵出 231 个文件；改为自建最小等价 shim（`internal-shims.ts`）
  - 引擎缺 `Float16Array`/`Iterator` → 只对 `primordials.js` 打 3 处 guard 补丁（语义等价，记录在 MANIFEST）
  - 沙箱全局用**参数注入**而非污染宿主 `globalThis`（`installGlobals` 可关，Vitest 下必需）
  - Buffer 重写为真 `Uint8Array` 子类（原 `#wrap` 设计有无限递归 bug）
- **踩过的坑（防止重犯）**：
  1. `installGlobals` 覆盖全局 `setTimeout` → binding 层自我递归爆栈。**修复**：模块顶层捕获原生引用 `nativeSetTimeout = globalThis.setTimeout.bind(globalThis)`，在 installGlobals 之前。
  2. binding 契约漏了 `timers` → `binding.setTimeout is not a function`。
  3. `RuntimeClient` 最初收到 `ready`/`exit` 时只通知监听器、不 settle 对应 Promise → `init()` 永久挂起，页面停在 "booting runtime…"。
  4. 用 ClawHive 内置 Electron Node 装依赖 → `@rollup/rollup-darwin-arm64` dlopen 代码签名不匹配。**必须用 fnm 的 Node v22.19.0**。
- **测试**：`test/vfs.test.ts`(9) + `test/runtime.test.ts`(11) 起步 → 现 22 条。
- **设计文档**：`docs/superpowers/specs/2026-09-17-web-node-design.md`

### 2026-09-17 · 前期调研

- 结论：WebContainer **不是**「把 Node 编译成 WASM」。真实做法是 JS 层跑浏览器自带 JS 引擎（不搬 V8），只把原生/syscall 层换成 wasm，`internalBinding()` 是唯一替换点；再加虚拟 FS + ServiceWorker 虚拟 TCP + 自研 npm client。
- 据此确定本项目路线（见设计文档第 1 节）。
