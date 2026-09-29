# ROADMAP — web-node 路线图

> **用途**：一份**固定、可追溯**的任务清单，回答两个问题——「现在坐到哪了？」「还剩多少任务？」
> 与 `docs/DEVLOG.md` 的分工：DEVLOG 记**已发生**的变更（倒序流水）；ROADMAP 记**还没做**的事（正序规划）。每完成一项，在这里打勾并把成果写进 DEVLOG。
>
> - **状态图例**：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 已完成 · `[⤳]` **已并入其他里程碑**（保留条目作决策痕迹，**不单独计数**） · `[-]` 不做（有意不做 / 死路，附理由）
> - **编号**：沿用里程碑号 `M88` 起。已完成的 `M1–M87` 见文末「已完成总览」。
> - **验收标准（每项都适用）**：① 差分语料对真 Node v26.9.0 **0 diff**；② `npm run typecheck` 干净；③ `npx vitest run` 全绿；④ `npm run build` 记录 worker 体积；⑤ 部署 gh-pages 且线上资产 200；⑥ 更新 DEVLOG + memory；⑦ 不能对真的东西响亮抛 `NotImplementedError`，绝不静默伪造。
> - **执行顺序**：**阶段 H（native → WASM，主线）** → 阶段 E（M107 ✅ 2026-09-28）→ 阶段 F → 阶段 I → 阶段 J。阶段 A/B/C/D 均已结清。**M113 · M122 ✅ 2026-09-29 后，阶段 G 与阶段 I 全部结清**（新增的 **M126 启动载荷再降 ✅** 见阶段 E、**M127 行为门禁扩面 ✅** 见阶段 I、**M128 真实工具链端到端（真 tsc）✅** 见阶段 F）；**阶段 J：M129 ✅ · M130 ✅ · M131（依赖安装改流式解包，修内存爆表）✅ 2026-09-29**。
> - **最后更新**：2026-09-29（**M113 ✅ 预览子域名路由（静态托管跟进）**——dev 侧 `<port>.localhost` 保留 + 新增**通配域** `VITE_WEB_NODE_PREVIEW_DOMAIN`：静态托管（GitHub Pages / 任意静态服务器 / 自定义域）把每个预览挂到 `<port>.<domain>` 真 origin；预览壳改为**静态资产**、SW `?domain=` 归一；三策略纯函数化 + 单测；真浏览器双路（dev 子域 / 静态服务器）均从虚拟 FS 供给真应用。**M122 ✅ 沙箱出站网络（egress）**——新增 `net/egress.ts` 传输层 + `Bindings.egress` 接入缝；`http`/`https` 公网目标经**宿主源 worker 的 `fetch`** 出网（可选自备 proxy 兜底，无第三方托管依赖），`net.connect` 无 TCP 桥则响亮 `ECONNREFUSED`；实测 `https.get('https://registry.npmjs.org/ms')` 200（改前 ECONNREFUSED）。**M128 ✅ 真实工具链端到端**——页内跑真 TypeScript 编译器：解析 tsconfig → 类型检查 → 产出 `.js`/`.d.ts` → 执行编译产物（拿到 `{count:2,total:15.1416}`）。此前：阶段 E 结清 M107 ✅；阶段 I：M124 ✅ · M123 ✅ · M127 ✅ · M122 ✅；阶段 F 结清：M109 ✅ · M110 ✅ · M112 ✅ · M128 ✅；阶段 H：M119 ✅ · M120 ✅ · M121 ✅ · M125 ✅ · M126 ✅；阶段 G：M113 ✅。**阶段 J：M129 ✅ · M130（Demo 顶部导航改版：四独立项目步进器——Vite/Webpack/rspack/Node.js 各自目录+依赖，第一行选项目、第二行操作、HMR 默认化）✅ 2026-09-29**。

---

## 阶段重规划说明（2026-09-23）

**背景**：架构从「JS 重写 native」转为「**真上游 C/C++ 编 wasm**（阶段 H，对齐 WebContainer）」后，原先按「JS 重写」排的阶段 C/E/F/G 出现三类错位：

| 错位类型 | 条目 | 处置 |
|---|---|---|
| **已由阶段 H 完成** | M99（zlib）→ **M116**；M100（histogram）→ **M117** | 就地打勾 `[x]`，注明「经阶段 H 完成」 |
| **已被阶段 H 吸收** | M106（热点 binding）→ **M119 + M120**；M114（同步 fs）→ **M120**；M108 / M111（webpack/rspack）→ **M121** | 原条目改标 `[⤳]`，注明并入对象，**不再单独计数** |
| **仍然独立、仅被 wasm 解锁** | M101（`stream/iter` 的 `transform`）、M107（启动/加载性能）、M109/M110/M112（构建工具链）、M113（子域名静态托管） | 保留，归入对应阶段 |

**本次重规划做三件事**：
1. **保留**所有里程碑编号与历史勾选——已完成的（含 M1–M87）原样不动；
2. **结清 / 吸收**上面第 1、2 类，使同一件工作不在两处重复计数；
3. **立阶段 H 为主线**，其余阶段只保留各自真正剩余的任务，并按重算结果刷新「进度总览」。

**重算结果（M88 起）**：共 **50** 项任务（另 1 项判定不做）→ 已完成 **41**、剩余 **9**。其中 **阶段 C 就此解散**（M99/M100 经 H 完成、M101 移入 H），**阶段 E 收敛为「启动与加载性能」**（M106 已拆入 H），**阶段 G 收敛为「预览与路由」**（M114 并入 H）。

---

## 进度总览

| 阶段 | 主题 | 任务数 | 已完成 | 剩余 |
|---|---|---|---|---|
| **H** | **native → WASM（主线，P0–P6）** | 9 | 9 | 0 |
| E | 启动与加载性能 | 1 | 1 | 0 |
| F | 构建工具链（**用户愿景，最后做**） | 3 | 3 | 0 |
| G | 预览与路由 | 1 | 1 | 0 |
| **I** | **借鉴 WebContainer（活体调研 2026-09-24）** | 3 | 3 | 0 |
| A | crypto 收尾（**已归档**） | 26 | 26 | 0 |
| B | 语义深度（**已归档**） | 5 | 5 | 0 |
| C | 平台无对应物（**已解散**，条目已分流） | 2 | 2 | 0 |
| D | 运行时常量小项（**已归档**） | 4 | 4 | 0 |
| — | 已判定不做 | 1 | — | — |
| **合计** | | **55** | **54** | **0**（+1 不做） |

> **阶段 H 明细**：M115 ✅ · M116 ✅ · M117 ✅ · M118 ✅ · M101 ✅ · M119 ✅ · M120 ✅ · M121 ✅ · **M125 ✅**。
> 加上已完成的 **M1–M87**（87 个），项目整体：**已完成 141 个里程碑，剩余 0 个规划任务**（全部结清）。
> 注：本表按**叶子任务**计数——M90（拆 M90.1–M90.9）、M92（拆 M92.1/M92.2）、M93（拆 M93.1–M93.4）、M93.4（拆 a–h）、M97（拆 M97.1）的**父项为拆分占位、不计入**。（旧表 A=22 系拆分前的陈旧值，本次一并修正为 26。）

---

## 阶段 H — native → WASM（**主线**，对齐 WebContainer 架构）

> **架构目标（B2）**：`internalBinding()` 背后的 native 层，从「TS 手写 shim / 平台 API 适配」迁移为**真上游 C/C++ 源码编出的 WASM 模块**；JS 层改用 Node 自己的 `lib/` 真源码（即 WebContainer 的 `lib/` + `internal_bindings` 形态）。
> **验收闸门（B1）**：① 现有差分装置 **0 diff**；② **北极星**：页内跑通 **webpack / rspack 生产构建**。
> **活体调研旁证（2026-09-24）**：WebContainer 的 `node:wasi` **端到端可用**（用真 wasi-sdk 34.0 编的 `wasm32-wasip1` 模块，`fd_write`/`getenv`/导出函数全通）→ 印证本阶段「**真上游 C/C++ → wasm + 最小 WASI 宿主**」的路线成立（也是 rspack `binding-wasm32-wasi` 的前置）。
> **阶段 C 结清（2026-09-23）**：M99（zlib）→ **M116** ✅、M100（histogram）→ **M117** ✅（均已在此完成）；M101 移入本阶段（见下）。
> **技术路线（甲）**：能编真上游 C/C++ 的（zlib/histogram/brotli/zstd/ada/OpenSSL 子集）用 **wasi-sdk** 编；syscall 层**不编 libuv**，改用 **SAB + `Atomics.wait` + FS-worker**。
> **设计文档**：[`docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`](superpowers/specs/2026-09-23-native-to-wasm-design.md)。接入缝 = `REGISTRY`（把 `zlib`/`crypto` 从 `UNSUPPORTED_BINDINGS` 移回并指向 wasm）；产物 = 带内容哈希的独立资产 + 惰性实例化。

### native 层实现方式总表（2026-09-24 盘点）

> 回答「哪些 native 是用真 C/C++ 编 wasm、哪些是 TS 自研、哪些只保形状」这一个问题，一张表说完。
> 「native」= Node 的 `internalBinding()` 背后那层（不是 JS 模块本身）。三种落地手法加两类例外：
>
> **① 真上游 C/C++ → wasm**（阶段 H 主线，`src/node-runtime/wasm/artifacts/`）：
>
> | wasm 模块 | 上游源码 | 接入点（binding / 模块） | 体积 | 里程碑 |
> |---|---|---|---|---|
> | `wn_stub` | 手写桩 | `wn_stub`（冒烟） | 46.5 KB | M115 |
> | `wn_zlib` | `deps/zlib` **1.3.2.1-motley**（11 `.c` 原封） | binding `zlib` | 108.8 KB | M116 |
> | `wn_histogram` | `deps/histogram`（hdr_histogram）+ 逐行移植 `src/histogram.cc` | binding `performance`（`Histogram`/ELD） | 257.7 KB | M117 |
> | `wn_brotli` | `deps/brotli` **1.2.0**（36 `.c` 原封） | binding `zlib`（brotli 半边） | 847.4 KB | M118 |
> | `wn_zstd` | `deps/zstd` **1.5.7**（27 `.c` 原封，不开多线程） | binding `zlib`（zstd 半边） | 484.0 KB | M118 |
> | `wn_openssl` | `deps/openssl` **3.5.8** 子集（自包含 WASI target） | `crypto` **模块**（TS 层直驱，**不是** binding） | 2483.2 KB | M119 |

> **② TS 自研（等价实现，`origin: 'web-node'`）**——模块还在，地基换成能在标签页里跑的东西：
>
> | 模块 | 文件 | 替换掉的 native binding | 手法 |
> |---|---|---|---|
> | `net` | `builtins/net.ts` | `tcp_wrap` `udp_wrap` `pipe_wrap` `stream_pipe` `js_stream` | 进程内虚拟 TCP：端口表 + 双工字节管道（`net/network.ts`） |
> | `http` | `builtins/http.ts` | `http_parser` | TS HTTP/1.1（`Content-Length`/chunked、keep-alive、连接池） |
> | `https` | `builtins/https.ts` | `tls_wrap`（表面） | `http` 实现套 TLS 名；TLS 材料只记录不使用 |
> | `dns` | `builtins/dns.ts` | `cares_wrap` | loopback-only 解析器（每个名字都解析到回环） |
> | `child_process` | `builtins/child_process.ts` + `shell/sh.ts` | `process_wrap` `spawn_sync` `signal_wrap` | 第二模块注册表 + 真 mini-shell 解析器 + IPC 通道 |
> | `worker_threads` | `builtins/worker-threads.ts` + `proc/worker.ts` | （无线程 binding） | 同事件循环第二注册表 + 真 `MessageChannel`（无真并行） |
> | `crypto` | `builtins/crypto.ts` + `crypto/*.ts` | `crypto` | TS 编排，**底层就是 `wn_openssl`**（未就绪回退纯 JS，对调用者不可见） |
> | `zlib` | `builtins/zlib.ts`（移植 `lib/zlib.js`） | `zlib` | JS 层移植，**底层是 `wn_zlib`/`wn_brotli`/`wn_zstd`** |
> | `vfs` | `builtins/vfs.ts` | `fs`（部分） | 自研虚拟文件系统 |
> | `process` / `module` | `builtins/{process,module}.ts` | `module_wrap` 等 | 自研（图/加载器是本运行时自己的） |
>
> **③ 只保形状、握手响亮抛错**：`tls`（`builtins/tls.ts`）——类层次（`SecureContext`/`TLSSocket`）、配置面、48 字节 ticket-key 存储是真的；**任何需要真握手的东西抛 `NotImplementedError`**，不编造值。
>
> **④ 无浏览器对应物 → `unsupported()` 代理**（`builtins/unsupported.ts`）：`sqlite` `ffi` `wasi` `wasm_web_api` `webstorage` `block_list`。规则：**import 不炸**（Vite 那种副作用导入必须能过），**属性被调用即抛**类型化错误；`isatty` 等无害属性给真值。
>
> **⑤ 不需要（编译/模块机制）**：`builtins` `cjs_lexer` `module_wrap` `ipc_serdes` `options` `internal_only_v8` `locks` `watchdog` —— 本运行时的 loader/图是自研的，没有 V8 编译缓存或原生源码文本要发。
>
> **⑥ 阻塞式系统调用（M120，已结清）**：浏览器没有阻塞式系统调用，而 OPFS 句柄只能 `await` 拿——**这与「运行时 worker 必须能阻塞」直接矛盾**。于是开一个 **FS-worker**：它在自己的线程里跑 `await`、干同步句柄的活；运行时 worker 把请求写进 `SharedArrayBuffer` 后 `Atomics.wait` 停车，答案也从同一块内存回传（**`postMessage` 送不到一个停着的线程**）。**上行**（`FS_OP_PUT`）让 `fs.fsyncSync`/`fdatasyncSync` 真同步；**下行**（`FS_OP_GET`/`FS_OP_STAT`/`FS_OP_LIST`）让内存树成为 OPFS 的缓存——不命中就在同步通道上回源，不必改 `readFileSync` 的签名。删除经异步 `{kind:'delete'}` 传到存储，否则被删文件会从 OPFS「复活」。非跨源隔离时如实降级（无 SAB → `sync fs: async`、无回源能力）。详见 DEVLOG 的 M120 条目。
>
> **附：registered binding 的三个来源**（共 41 个，含 `wn_stub`）——**wasm 支撑** 3（`wn_stub`/`zlib`/`performance`）、**TS 手写 shim** 38（`fs`/`buffer`/`timers`/`errors`/`serdes`/`contextify`/`v8`/`url`/…，多为小表面或宿主能力桥接）、**刻意不提供** 32（见 `UNSUPPORTED_BINDINGS`，由 `test/bindings-surface.test.ts` + `test/fixtures/node-bindings.json` 锁死）。JS 模块层的真源码 vendored（119+ 文件：stream/events/util/assert/perf_hooks/…）不算 native，但正是「JS 层用 Node 自己的 `lib/`」这一半目标。
>
> **附：全部 72 个 `internalBinding` 名单**（夹具 `test/fixtures/node-bindings.json`，`node tools/binding-names-oracle.mjs` 从 `$NODE_SRC/lib` 重新生成）：
>
> - **已实现 40**（Node 会要、本运行时回答）：`async_context_frame` `async_wrap` `blob` `buffer` `config` `constants` `contextify` `credentials` `diagnostics_channel` `encoding_binding` `errors` `fs` `fs_dir` `fs_event_wrap` `heap_utils` `icu` `inspector` `messaging` `mksnapshot` `modules` `os` `performance` `process_methods` `profiler` `serdes` `stream_wrap` `string_decoder` `symbols` `task_queue` `timers` `trace_events` `tty_wrap` `types` `url` `url_pattern` `util` `uv` `v8` `worker` `zlib`。其中 **wasm 支撑 2**（`zlib` → `wn_zlib`/`wn_brotli`/`wn_zstd`，`performance` → `wn_histogram`），其余 38 为 TS 手写 shim（各文件见 `src/node-runtime/bindings/*.ts`）。
> - **刻意不提供 32**（Node 会要、本运行时无对应物）：`block_list` `builtins` `cares_wrap` `cjs_lexer` `crypto` `dtls` `ffi` `http2` `http_parser` `internal_only_v8` `ipc_serdes` `js_stream` `locks` `module_wrap` `options` `permission` `pipe_wrap` `process_wrap` `quic` `report` `sea` `signal_wrap` `spawn_sync` `sqlite` `stream_pipe` `tcp_wrap` `tls_wrap` `udp_wrap` `wasi` `wasm_web_api` `webstorage` `watchdog`。
> - **接口冒烟项 1**（不是 Node 的名字）：`wn_stub`。
> - **40 + 32 = 72**：夹具里的每个名字都恰好落在「已实现」或「刻意不提供」之一（门禁锁死）。

---

- [x] **M115 · wasm 工具链 + binding 接入缝（P0）** ✅ 2026-09-23
  - **工具链**：装 **wasi-sdk 34.0**（`~/wasi-sdk-34.0`，clang 23.1.0-wasi-sdk + wasi-libc + wasm-ld；可用 `WASI_SDK_PATH` 覆盖）。构建入口 `native/build.mjs`（`npm run build:native [-- --inspect]`），产物写到 `src/node-runtime/wasm/artifacts/`（**提交进仓库**，部署/CI 不需工具链）并附 `manifest.json`（工具链版本 + sha256）。
  - **桩模块** `native/src/wn_stub.c`：导出函数 + 线性内存 + `malloc`/`free` 三件事，用 `__attribute__((export_name(...)))` 精确导出（不给链接器传 `--export-all`，libc 符号不泄出）。
  - **加载器** `src/node-runtime/wasm/`：`loader.ts`（`WebAssembly.Module` 同步编译 + reactor `_initialize`）、`registry.ts`（已实例化模块表）、`index.ts`（`WASM_MODULES` + `loadWasmModules()`）。资产走 `?url` → Vite 按内容哈希发到 `assets/`（**不内联进 worker bundle**，M107 的教训）。
  - **接入缝**：`REGISTRY` 新增 `wn_stub`（`bindings/wn_stub.ts`）；worker 启动期 `wasmReady` 与 `vendoredSourcesReady` 并列 await（绑定表是**同步**构建的，wasm 必须在那之前预编译好）；`ready` 信息加 `wasmModules`，UI 显示。
  - **验收**：门禁全绿——`tsc --noEmit` 净 · `vitest run` **997 passed / 2 skipped（119 文件）** · `npm run build`（`dist/assets/wn_stub-Kli7lsuY.wasm` 46.48 kB、`runtime.worker-CqufMlXm.js` **666.38 kB**）；部署 gh-pages 后线上资产全 **200**（含 wasm 46479 字节）；**页面端到端验证**：真实浏览器打开线上站点报告 `native→wasm modules: wn_stub`、`40 bindings · 1 wasm modules`。
  - **两个关键坑**：① 目标名必须是 `--target=wasm32-wasip1`（`wasm32-wasi` 已弃用，且会让 clang 去查不存在的 multilib 目录 → `stdlib.h` 找不到）；② `--export-dynamic` 对非 PIE 可执行模块**不导出**任何符号，用源码里的 `export_name` 属性才可靠。
  - **测试环境**：`npx vitest` 必须用 **fnm Node v26.9.0**——vendored 源里有 `using stack = new DisposableStack()`（Node 24+ 语法），v22.19.0 会在编译期报 `Unexpected identifier 'stack'`。

- [x] **M116 · `zlib` → 真 `deps/zlib` 编 wasm（P1）** ✅ 2026-09-23  ← 取代 M99 的纯 JS 方案
  - **真上游 C → wasm**：把 Node 自己那份 `deps/zlib`（zlib **1.3.2.1-motley**）的 11 个 `.c` 原封不动编成 wasm（`-DDYNAMIC_CRC_TABLE` 免掉 591KB 的 `crc32.h`，`-DZLIB_CONST`，`-DOS_CODE=3`），外加一个薄包装 `native/src/wn_zlib.c`（流式 ABI：`wn_zlib_new`/`write`/`reset`/`set_params`/`set_reject_garbage`/`ensure` + 缓冲区指针），产物 **106.2 KB、零 imports**。
  - **JS 层**：`bindings/zlib.ts` 的 `ZlibCodec`（mode→windowBits 映射、预设字典装载时机、`Z_NEED_DICT` 重试、gzip 多成员、错误形状逐条对齐 `src/node_zlib.cc` 的 `ZlibContext`）+ `builtins/zlib.ts`（Node `lib/zlib.js` 的 **zlib 半边逐条移植**：`ZlibBase`/`Zlib`/`processChunk(Sync)`/便利方法/`flush`/`params`/`crc32`），brotli/zstd/zip 仍响亮抛错。
  - **解锁**：`gzipSync`/`deflateSync`/`inflateRawSync`/`unzipSync`/… 全部可用；`level`/`windowBits`/`memLevel`/`strategy`/`dictionary`/`chunkSize`/`flush`/`finishFlush`/`params()`/`rejectGarbageAfterEnd` 全部生效（此前传非默认值即抛）。`zlib.constants` 补齐到 Node 全量 **170** 项（含 `BROTLI_*`/`ZSTD_*`）。
  - **顺带修的真 gap**：`internal/errors` 补上 `ERR_TRAILING_JUNK_AFTER_STREAM_END`（`TypeError` 基底，Code/文案逐字对齐）。
  - **验收**：新差分装置 `tools/zlib-probe.cjs`（+ `tools/zlib-oracle.mjs` → `test/fixtures/zlib.json`）在真 Node v26.9.0 与 web-node 各跑一遍，**逐字段 0 diff**（同步/异步一次性、编解码参数、字典、流式+字节流、`flush`/`params`、UNZIP 自动识别、多成员 gzip、错误形状、常量/码表）；`tsc --noEmit` 净 · `vitest run` **998 passed / 2 skipped（119 文件）** · `npm run build`（`wn_zlib-ElRqH9jS.wasm` **108.78 kB**、`runtime.worker-xzjeutnS.js` **674.09 kB**）；部署后线上资产全 **200**。
  - **三个真 bug（都已修）**：① `wn_init_stream()` 在“已初始化”时返回的是 `h->err`（上一次操作的返回码），于是 `Z_STREAM_END` 之后的调用被误判为初始化失败而**跳过写入**，调用方看到陈旧的 `avail_out` → 把上一次的输出**又推了一遍**（异步 `gunzip` 出 2× 数据）；② `ZlibBase.prototype._final` 忘了调 `callback()`，writable 端永不 finish（流不结束）；③ `DeflateRaw` 的 `windowBits: 8` 需要按 Node 抬到 9。
  - **两个有意偏离（写进文档）**：① gzip 头第 9 字节（OS）在真 Node（macOS）是 `0x13`、wasm 无 OS 身份所以固定用 zlib 默认 `0x03`——探针把它归一（它是平台元数据，不是数据），并有定点测试锁 `0x03`；② **未**字面 vendor `lib/zlib.js`：它顶层 `require('internal/zip')`（14 文件 / 4271 行），代价不成比例；本步以 `builtins/zlib.ts`（同一份逻辑的移植）达到可观测等价，字面 vendor 待 `internal/zip` 一并搬时再做。

- [x] **M117 · `perf_hooks` 直方图 → 真 `deps/histogram` 编 wasm（P2）** ✅ 2026-09-23  ← 取代 M100 的纯 JS 方案
  - **真上游 C → wasm**：`native/build.mjs` 新增 `wn_histogram` 模块（支持 C++：`-std=c++20 -fno-exceptions -fno-rtti`）——把 `deps/histogram/src/hdr_histogram.c`（HdrHistogram 官方 C 实现）原封不动编进来，外加 `native/src/wn_histogram.cc`：**逐行移植 `src/histogram.cc` / `histogram-inl.h` 的全部算法**（均值/标准差/偏度/峰度、KS/Welch/Mann-Whitney/Cohen's d/Cliff's δ、均值 CI/分位 CI、EWMA 与 SLO 错误率、CBOR 导出/导入、linear/log/percentile 迭代），只是把 V8/Node 胶水换成给 JS 的 C ABI。产物 **257.7 KB**（libc++ 静态构造，非零 imports → 补了一个最小 WASI 宿主 `wasm/wasi.ts`）。
  - **JS 层**：`bindings/histogram.ts`（薄封装：把 wasm C ABI 包成与 `internalBinding('performance').Histogram` **可观测等价**的 JS 类，接进 `performanceBinding` 的 `Histogram`/`createELDHistogram`）；**vendor 真 `lib/internal/histogram.js`**（161 个 vendored 文件，无 patch）；ELD 直方图用 **unref 过的**定时器/ `setImmediate` 驱动（与 Node 一样不吊住事件循环）。**删掉** M35 时代的 `internal/histogram` shim。
  - **解锁**：`createHistogram()`（含 `lowest`/`highest`/`figures`/`halfLife`/`threshold`）、`importHistogram()`、`monitorEventLoopDelay()`（含 `samplePerIteration`）、`timerify(..., {histogram})`、`histogram.export()` 的 CBOR 与 `Histogram`/`RecordableHistogram` 全量方法（含 `countBigInt`/`percentilesBigInt`/`ccdf` 等）。
  - **验收**：新差分装置 `tools/histogram-probe.cjs`（oracle `tools/histogram-oracle.mjs` → `test/fixtures/histogram.json`）在真 Node v26.9.0 与 web-node 各跑一遍，**逐字段 0 diff**（标量统计、分位、桶表、两样本检验、均值/分位 CI、EWMA、CBOR 导出重导入、错误形状、常量）；`tsc --noEmit` 净 · `vitest run` **1007 passed / 2 skipped（120 文件）** · `npm run build`（`wn_histogram-BIhNpcFt.wasm` **257.74 kB**、`runtime.worker-Cna1pydo.js` **679.75 kB**）；部署后线上资产全 **200**。
  - **两个有意偏离（写进文档）**：① **EWMA 方差的 1 ULP**：`ewma_variance` 递推 `v + α·d·d` 在 arm64 宿主被编译成 **FMA**，而 wasm 无 FMA 指令——最后一次加法不进位，导致 EWMA 导出 CBOR 的 `float64` 最后 1 字节差 1；探针对**统计量**取 10 位有效数字（libm 的 `erfc`/`lgamma`/`exp`/`log` 同理可能差 1 ULP），并对 EWMA 导出只比**非 EWMA 段的字节**（framing/计数逐字节相等）。② `monitorEventLoopDelay` 的**绝对延迟值**天然依赖环境（Node 用 libuv 定时器，这里用 unref 的 JS 定时器），故只锁契约与量级，不进字节差分。

- [x] **M101 · `zlib/iter`（可迭代压缩）——vendor 真 `internal/streams/iter/transform.js`** ✅ 2026-09-23  ← 由阶段 C 移入
  - **vendor 真源**：`lib/internal/streams/iter/transform.js` + `lib/zlib/iter.js`（MANIFEST 161 → 163，零 patch）。前者**裸调 `internalBinding('zlib')`** 造 handle（`new binding.Zlib(mode)`），再逐次 `write`/`writeSync` 驱动，从调用方拥有的 `Uint32Array(2)` 读回 `[availOut, availIn]` 并据此循环——这是 `src/node_zlib.cc` 的 `CompressionStream` 原生表面。
  - **绑定补上 raw handle ABI**：`bindings/zlib.ts` 新增 `RawHandle` 基类 + `ZlibStreamHandle`/`BrotliEncoder`/`BrotliDecoder`/`ZstdCompress`/`ZstdDecompress`（暴露在原生键名下），把已验证的 codec 包成「一次 write ↔ 一次 deflate/inflate」的语义：`init(writeState, processCallback, …)` / 异步 `write` / `writeSync` / `reset` / `params` / `close`，失败经 `onerror(message, errno, code)` 报出（**不**调回调，与 C++ `EmitError` 一致）。原高层 codec 改挂 `*Codec` 键（`builtins/zlib.ts` 改用之）。
  - **常量表归一**：把 `builtins/zlib.ts` 里那张 170 项的 zlib/brotli/zstd 常量表抽成 `zlib-constants.ts`，`internalBinding('constants').zlib` 从空 `{}` 改为它（之前是空表，vendored `transform.js` 读它取 `DEFLATE`/`GZIP`/`Z_BUF_ERROR`… 会全得 `undefined`）。
  - **解锁**：`require('zlib/iter')` 的 16 个变换（`compressGzip`/`compressDeflate`/`compressBrotli`/`compressZstd` 及 `decompress*` 与全部 `*Sync`），可经 `stream/iter` 的 `pull`/`pullSync` 组合；`chunkSize`/`level`/`windowBits`/`params` 等参数全部生效。
  - **验收**：新差分装置 `tools/zlib-iter-probe.cjs`（oracle `tools/zlib-iter-oracle.mjs`，真 Node 需 `--experimental-stream-iter` → `test/fixtures/zlib-iter.json`）真 Node v26.9.0 vs web-node **逐字段 0 diff**（同步/异步往返、压缩字节、`chunkSize` 不变性、参数矩阵、错误形状、链式变换、大输入）；`tsc --noEmit` 净 · `vitest run` **1021 passed / 2 skipped（122 文件）** · `npm run build`（worker **695.82 kB**）。

- [x] **M118 · `brotli` / `zstd` → wasm（P3）** ✅ 2026-09-23
  - **真上游 C → wasm**：`deps/brotli`（上游 **1.2.0**，36 个 `.c`：common + dec + enc）与 `deps/zstd`（上游 **1.5.7**，27 个 `.c`）原封不动编成 wasm；薄封装 `native/src/wn_brotli.c`（`BrotliEncoderContext`/`BrotliDecoderContext` 的调用序列）与 `native/src/wn_zstd.c`（`ZstdCompressContext`/`ZstdDecompressContext`，含 pledged src size 核对）。产物 `wn_brotli.wasm` **847.4 KB**、`wn_zstd.wasm` **484.0 KB**（zstd 不开 `ZSTD_MULTITHREAD`——wasm32-wasip1 无线程）。
  - **JS 层**：`bindings/zlib.ts` 新增 `BrotliCodec` / `ZstdCodec`（与 `ZlibCodec` 同形的 `push(chunk, flush)`；输入/输出缓冲放进 wasm 线性内存，用 `*_avail_in/out` 取剩余量），`builtins/zlib.ts` 新增 `BrotliCompress(Decompress)` / `ZstdCompress(Decompress)` / `createBrotli*` / `createZstd*` 与一次性便利方法；`collectParams`/字典装载/错误码对齐 `lib/zlib.js`。
  - **解锁**：`brotliCompress(Sync)` / `brotliDecompress(Sync)` / `zstdCompress(Sync)` / `zstdDecompress(Sync)`、四个流类、全部 `BROTLI_PARAM_*`/`ZSTD_c_*`/`ZSTD_d_*` 参数、字典、`pledgedSrcSize`、`stream/web` 的 `CompressionStream('brotli')`；仅 zip 存档助手仍响亮抛错。
  - **验收**：差分装置扩到 `tools/zlib-probe.cjs`（+ oracle → `test/fixtures/zlib.json`，**56 个观测键**），真 Node v26.9.0 vs web-node **逐字段 0 diff**（含参数、字典、流式、异步、错误形状、`stream/web` brotli）；`tsc --noEmit` 净 · `vitest run` **1011 passed / 2 skipped（120 文件）** · build（worker **689.29 kB**）。

- [x] **M119 · `crypto` → OpenSSL 子集编 wasm（P4）**  ← 承接 M106 的 crypto 部分 ✅ 2026-09-24（**摘要/HMAC + 对称密码与 KDF + Argon2 + 非对称 + ECDH/DH + ML-KEM + X509/SPKAC + 全曲线 EC/RSA 指数 + 自定义 DH 参数与 ml-kem keygen——全部结清**）
  - **可行性（已退险）**：真 OpenSSL **3.5.8**（`deps/openssl/openssl`）用 wasi-sdk 编出 `libcrypto.a` 5.75 MB / `libssl.a` 0.85 MB，**0 error**；薄模块 `wn_openssl.wasm` **2.29 MB**，SHA-256/MD5/HMAC-SHA256 与真 Node **逐字节一致**。OpenSSL 没有 WASI target，新增自包含 target `native/openssl/99-wasi.conf`（`no-asm/no-shared/no-threads/no-sock/no-engine/no-legacy/no-secure-memory`）；构建走 OpenSSL 自己的 `Configure`+`make build_libs`，缓存到 `native/.openssl-build`。
  - **已交付增量（摘要路径）**：`native/src/wn_openssl.c` 的通用名 ABI（`EVP_MD_fetch` / 一次性+流式 digest / HMAC / XOF），`bindings/openssl.ts` 薄封装，`wasm/lazy.ts` 惰性加载（**不进启动期 `WASM_MODULES`**，避免 M107 的启动回退——解密后立刻后台拉取），`crypto/hash.ts` 在模块就绪后把全部摘要（md5/sha1/sha2/sha3/keccak/blake2/sm3/ripemd160/md5-sha1/shake）切到 OpenSSL，**未就绪或其他名则回退纯 JS**（两者逐字节相同，切换对调用者不可见）。
  - **剩余**：cipher（AES/ChaCha/DES/Camellia/ARIA/SM4/OCB/SIV/XTS/CCM/CBC-CTS）、KDF（pbkdf2/hkdf/scrypt/argon2）、非对称（RSA/EC/DH/ML-KEM）、X509/SPKAC 仍在纯 JS；后续增量逐个迁。
  - **已交付增量②（对称密码 + KDF）**：`wn_openssl` 扩出密码族 ABI（`wn_cipher_info|new|free` + `set_ivlen|set_data_len|set_key_iv|set_padding|aad|set_tag|set_tag_len|get_tag|update|final`）与 `wn_pbkdf2|wn_hkdf|wn_scrypt`；新增驱动 `crypto/openssl-cipher.ts`（`OpenSslCipher implements SyncCipher`，照搬 `CipherBase::Update`/`Final` 的一次性模式集合、CCM/SIV 认证失败延后、错误分支），`createCipher()` 优先走它、否则原地回退。**难点在错误语义而非算法**：`update()` 因 `MarkPopErrorOnReturn` 会弹掉 OSSL 错误 → 一律落回 Node 文案（无 `code`），只有 `final()` 会报 OSSL 错误；`ERR_OSSL_*` 码要按 Node 的库名清单拼（**无 `PROV`** → `PROV_R_BAD_DECRYPT` 即 `ERR_OSSL_BAD_DECRYPT`）；`setAuthTag` 非幂等。KDF 在 `crypto/hash.ts` 接入（参数校验仍留 JS）。
  - 验收②：差分门禁 `test/crypto-openssl-engine.test.ts`（7 例）用测试开关 `setOpensslEnabled()` 对同一操作跑 **wasm / 纯 JS / `node:crypto`** 三方逐字节比对（14 个模式 + KDF 参数组 + 错误文案）**全绿**；`vitest run` **1028 passed / 2 skipped**，`wn_openssl.wasm` 2298.46 kB 独立资产。
  - **剩余**：非对称（RSA/EC/DH/ML-KEM）、X509/SPKAC、argon2 仍在纯 JS；后续增量逐个迁。
  - **已交付增量③（Argon2）**：`wn_argon2(algo,…)` 接 default provider 的 ARGON2D/I/ID；`crypto/argon2.ts` 优先走它、否则回退纯 JS。**刻意不传 `OSSL_KDF_PARAM_THREADS`**（ncrypto 只拿它把 lane 分到 OS 线程，而 wasi 构建 `thread_scheme=(none)`；lane 数是独立算法参数，不传不改输出）。差分测试扩了 argon2d/i/id + `secret`/`associatedData`/4-lane 组。
  - **已交付增量④（非对称）**：**先修了一个被掩着的真 bug**——`99-wasi.conf` 的 `bn_ops` 写了 `SIXTY_FOUR_BIT_LONG`，而 wasm32 是 ILP32（`long` 32 位），于是 `BN_ULONG` 是 32 位、`BN_BITS2` 却当 64 → **整个 BIGNUM 都是错的**；摘要/密码/KDF 不碰 BN 所以三个增量全绿都没暴露。改 `SIXTY_FOUR_BIT` 后修复；顺带让 `native/build.mjs` 的 OpenSSL 缓存标记写入配置的 sha256（改配置会重建，不再静默复用旧库）。C 侧新增通用 `wn_pkey_*`（keygen / DER+raw 导入导出 / size / sign+verify（空 md 名=直接签消息）/ encrypt+decrypt（PKCS#1/OAEP+md+label）/ derive；encapsulate/decapsulate 已写好但未接线）。JS 侧 `asym.ts` 在就绪时把 **RSA PKCS#1/PSS、ECDSA（DER/ieee-p1363）、Ed25519 的签/验、RSA 加解密、rsa/ec/ed25519 的 keygen** 走 wasm（密钥经现有 DER 编码器 `d2i` 进 OpenSSL，材料仍是 `KeyMaterial`，下游无感），其余原地回退。**又抓出一个互操作真偏差**：PSS 默认盐长——Node 签名默认**最大盐**、验签默认 **AUTO**，我们之前两边都按摘要长，导致「验不了其他实现用默认参数签的 PSS」。验收：新差分门禁 `test/crypto-openssl-pkey.test.ts`（8 例）对 Ed25519 / RSA PKCS#1 / RSA-PSS（含默认与显式盐长）/ ECDSA（3 曲线 × DER/P1363）/ RSA 加解密做**双向互验**，且**每个方向都把 wasm 关掉再跑一遍**。`vitest run` **1037 passed / 2 skipped（124 文件）**，`wn_openssl-ClALQSg4.wasm` **2355.62 kB** 独立资产。
  - **剩余**：DH/ECDH 的 `diffieHellman()`、ML-KEM 的 `encapsulate`/`decapsulate`（C 侧就位，只差接线）、X509/SPKAC 仍纯 JS。
  - **已交付增量⑤（DH/ECDH + ML-KEM）**：`diffieHellman()`（ec/dh）走 `wn_pkey_derive`（域参数不匹配→回退纯 JS 抛 `ERR_OSSL_MISMATCHING_DOMAIN_PARAMETERS`）；ML-KEM 的 `encapsulate`/`decapsulate` 走 `wn_pkey_encapsulate`/`decapsulate`，密钥经 **SPKI/PKCS#8** 导入（`[0]` seed 与 `[1]` expanded 两种私钥形式 OpenSSL 都认）。**注意**：ML-KEM 的裸私钥接口 `EVP_PKEY_new_raw_private_key_ex` 要的是**扩展后的 `dk`**，不是 64 字节 seed。验收：ECDH 三曲线与 Node 逐字节相等、Node 的 `modp14` DH 对密钥相等、ML-KEM 三参数集与 Node 双向互验 + 与纯 JS FIPS 203 一致，另有“DER 能被 OpenSSL 导入”的路由探针（防静默回退）。`vitest run` **1041 passed / 2 skipped**。
  - **剩余**：非对称 **keygen** 的部分场景（rsa 非默认 publicExponent、ec 非 NIST 曲线、自定义 DH 参数、ml-kem）、**X509/SPKAC** 仍纯 JS。
  - **已交付增量⑥（X509/SPKAC）**：`wn_openssl` 新增 `wn_x509_*`（解析 / DER 重编码 / subject / issuer / SAN / infoAccess / 生效期字符串与秒数 / 序号 / 签名算法名与 OID / EKU / `X509_check_ca`）与 `wn_spkac_*`（`NETSCAPE_SPKI` 的验签 / 公钥 PEM / challenge）。**关键认识**：getter 的字符串由 Node 自己的打印辅助函数决定（ncrypto 的 `PrintGeneralName`/`SafeX509*Print` + `X509_NAME_print_ex(kX509NameFlagsMultiline)`/`ASN1_TIME_print`/`BN_bn2hex`），所以**把那些辅助函数逐行搬到 C**（含 `IsSafeAltName`/`PrintAltName`/`GEN_*` 各类型与 `othername:` 前缀表），而不是在 JS 里继续“根据 DER 推”。`check*`/`verify`/`checkIssued`/`toLegacyObject` 仍用 DER 派生状态（指纹就是 DER 摘要，签验已走 wasm），避开在 JS 里重实现 `X509_check_host` 的 flag 语义。**两个实现细节**：① 字符串读取用“先问长度、再填缓冲”两步（C 侧传 NULL 只返长度）；② 缺失的可选扩展 C 侧返 0 长度，绑定层归一为 `null`（Node 是 `undefined`）。wasm 堆不回收，用 `FinalizationRegistry` 释放 handle。验收：`test/x509.test.ts` 与 `test/crypto-certificate.test.ts` 各新增“**开关引擎得到完全相同的输出**”门禁（X509 比 20 个字段含 raw/PEM/legacy/SPKI，SPKAC 比验签/challenge/公钥/空白宽松度），原有差分语料 0 diff。`vitest run` **1043 passed / 2 skipped**，`wn_openssl-Dl_5d2Si.wasm` **2479.56 kB**。
  - **已交付增量⑦（全曲线 EC + RSA 指数）**：`crypto.getCurves()` 改为 OpenSSL 注册表（`wn_ec_curves` = `EC_get_builtin_curves` + `OBJ_nid2sn`，JS 再套 Node 的 `filterDuplicateStrings`）→ **82 条曲线、顺序与 Node 逐项一致**（设计文档开放问题 §7.3 的答复：表面常量由 wasm 导出）。`EcMaterial.curve` 从「必须带全套域参」放宽为 `NamedCurve`（名/宽/OID）+ `hasArithmetic()`，无本地算术的曲线走 `wn_ec_curve_info`（`EC_curve_nist2nid`→`OBJ_sn2nid`→`OBJ_txt2obj`，与 Node 的 `Ec::GetCurveIdFromName` 同序）交给 OpenSSL —— **secp256k1 / brainpool\* / prime192v1 / sect\* / SM2 等 80 条曲线从报错变为完整可用**。`wn_pkey_keygen` 新增指数参数（`BN_dec2bn` + `EVP_PKEY_CTX_set1_rsa_keygen_pubexp`），RSA 任意 `publicExponent` 走 wasm。**两个实测出来的字节级差异已修**：EC 私钥标量按**阶宽**补齐（`ossl_ec_key_simple_priv2oct`），IEEE P1363 半宽也用**阶宽**（Node 的 `GroupOrderSize`）——两者都只在「阶≠域」的曲线（WTLS 系）显形。**SM2 有意偏离（已写文档）**：OpenSSL 的 EC key manager **按设计**拒绝导入 SM2 曲线材料（`ec_kmgmt.c` 的 `common_check_sm2`），SM2 key manager 只收 SM3 且无 derive → SM2 的 keygen/导入/导出/details 全可用、**SM3 签验与 Node 双向互验通过**，非 SM3 摘要与 ECDH 如实报 OpenSSL 错误（`ERR_OSSL_INVALID_DIGEST` / `operation not supported for this keytype`）。`Oakley-EC2N-3/4` 在 Node 里也无法导出（`ERR_OSSL_MISSING_OID`），只列出。验收：新门禁 `test/crypto-openssl-curves.test.ts`（7 例，12 条曲线 × 字节一致/双导入/双向签验/P1363/ECDH + RSA 指数）。
  - **顺带清理**：`UNSUPPORTED_BINDINGS` 之前自相矛盾（`crypto`/`zlib`/`inspector`/`trace_events` 同时“已注册”与“刻意不提供”，还混入非 binding 名的 `vfs`）；现改为**恰好 32 个「Node 的 lib/ 会要而我们不提供」的真实名字**，并加夹具 `test/fixtures/node-bindings.json`（72 名，`tools/binding-names-oracle.mjs` 生成）+ 永久门禁（无虚构名 / 不与已注册重叠 / 已注册名须为 Node 真实拼写 / vendored 读写到的 binding 必须全落在两者之一）。删掉真死代码 `builtins/fs-promises.ts`。
  - **已交付增量⑧（自定义 DH 参数 + ml-kem keygen，M119 结清）**：`wn_dh_keygen(p, g)` 覆盖 `group` 与 `prime`/`generator`（与 Node 一样把名字解成 p/g；p/g 命中已知组时 OpenSSL 自己缓存 `q`/`keylength`），`wn_dh_keygen_params(bits, generator)` 覆盖 `primeLength`（`paramgen_init` → `paramgen` → 再从参数 keygen，**两步不可少**：`keygen_init` 的 selection 不含 `DOMAIN_PARAMETERS`）。ML-KEM keygen 直接 `wn_pkey_keygen('ML-KEM-*')`；**坑在导出格式**：Node 用 `seed-only`（`[0]` 隐式标签，86 字节），**OpenSSL 默认是 `seed-priv`**（`SEQUENCE { OCTET STRING(seed), OCTET STRING(dk) }`，用全域 tag）——旧解析器把整个 dk 当种子展开，造出的私钥 Node 导入报 `DECODER routines::unsupported`；现三种拼写都识别。**顺手修一个真 hang**：JS `generatePrime` 把首字节无条件置 0x80，导致 `bits % 8 !== 0` 时死循环（`generateSafePrime(512)` → `generatePrime(511)` 永远不满足位宽守门）。新增共享模块 `crypto/openssl-error.ts`（把 `ERR_LIB_*` → Node 名表从 `openssl-cipher.ts` 抽出），**OSSL 错误码补齐库名前缀**（`ERR_OSSL_DH_MODULUS_TOO_SMALL`、`ERR_OSSL_EVP_PROVIDER_KEYMGMT_FAILURE`；`PROV` 不在表里 → 维持 `ERR_OSSL_MISMATCHING_DOMAIN_PARAMETERS`）。DH 选项校验按 Node 对齐（三写法互斥、`validateInt32`、`ERR_MISSING_OPTION`），且 **OpenSSL 拒绝时如实抛错、不静默回退**。验收：`test/crypto-openssl-pkey.test.ts` **18 例**（含 `primeLength ∈ {0,256,511,512.5,-1}` 与 Node 逐字同错）。
  - **剩余**：无（M119 结清）。下一步 **M120 同步 syscall**。

- [x] **M120 · 同步 syscall：SAB + `Atomics.wait` + FS-worker（P5）**  ← 吸收 M114、承接 M106 的 fs 部分 ✅ 2026-09-24 结清
  - 真·同步 `fs` 在独立 worker 完成、主线程可阻塞等待；前置跨源隔离（COOP/COEP）；与现有 fs 语义差分 0 diff。
  - **已交付**：`src/sync/sab-rpc.ts`（SAB 请求/应答通道，超时抛错不挂死、响应装不下回 `STATUS_RETRY` 并重发且不重跑）、`src/worker/fs.worker.ts`（OPFS 唯一写入者）+ `vfs/fs-service.ts`（可脱离 worker 单测的决策层）+ `vfs/opfs-store.ts`（同步句柄、写+flush 即持久）。同步与异步通道**共用一个 FIFO 队列**。
  - **`fs.fsyncSync`/`fdatasyncSync` 已真同步**（fd 强制转换在原生层，已逐字复刻）；**非隔离时如实降级**（gh-pages 无 COOP/COEP → `sync fs: async`，`sync()` 为 no-op）。
  - **读也走同步通道**（第三增量）：`FS_OP_GET`/`FS_OP_STAT`/`FS_OP_LIST`，内存树成为 OPFS 的缓存——不命中时**阻塞回源**，于是「`fsync` 已落盘、而快照未跑（标签页关掉/崩掉）」的文件、以及**别的上下文**写进共享 OPFS 的文件，都能被 `readFileSync`/`statSync`/`existsSync`/`readdirSync` 看见；删除通过异步 `{kind:'delete'}` 传到存储（否则会从 OPFS「复活」）。
  - **已交付验收**：`tsc --noEmit` 净 · `vitest run` **1106 passed / 2 skipped（127 文件）** · build（`fs.worker.js` 7.16 kB；worker 723.10 kB）· 差分夹具 51→65 键与真 Node 逐字相等。
  - **端到端证据**：本地 dev（跨源隔离）页面：① 写文件 → `fsyncSync` → 自旋 4 s，页面在自旋窗口内**从 OPFS 直接读回相同字节**（debounce 快照不可能已跑）；② 绕过运行时直接把文件/目录写进 OPFS、**重载页面**后（文件树看不见它们）仍能 `readFileSync`/`readdirSync` 读到；③ `rmSync` 后页面直接查 OPFS → 已删。
  - **已知边界（已写明）**：不回源重建列表（内存树已知的目录只列内存子项）；非跨源隔离时无 SAB → 无回源能力（`readSource()` 为 `null`），验收只能在**本地 dev/preview** 做。

- [x] **M121 · 页内跑通 webpack / rspack 生产构建（P6）**  ← **B1 北极星**，汇合 M108/M111 ✅ 2026-09-28（**spike ✅ + 第一增量 ✅ + 第二增量 ✅**：`require(esm)` 补齐后 **webpack 5 生产构建（含 terser 压缩）已在页内完整跑通，产物与宿主 Node 逐字节一致**；**rspack 一侧也已跑通**——`@rspack/core@2.2.7` 在页内完成带 minify 的 production build（见 M125 第二增量）；顺带修掉「冷条目快照清零磁盘文件」的数据丢失真 bug）
  - 目标：这个浏览器 Node 环境能跑 **webpack / rspack** 生产构建；本 runtime 构建与宿主构建**产物一致**。
  - 验收：页内产出 bundle；与现有差分装置兼容。
  - **spike（2026-09-24）**：① 页内 `npm install` 装下 webpack + webpack-cli（134 包 / 58.2s）；② webpack 5.111.1 能加载并启动编译；③ 卡在 `make` 之后；④ 两个壁障：`md4` 缺失 + 退出报得太早。
  - **第一增量（2026-09-24）**：**运行结束改成等事件循环排空**（`NodeRuntime.drain()`/`pendingWork`，`runMain` 后 `await drain()` 再报 exit——回调全部落在 exit 之前）；挖出并修了**两个真 bug**：
    - **持久化 debounce 跑在沙箱定时器队列上**（`installGlobals` 把 `globalThis.setTimeout` 换成运行时的，而 `runMain` 会清空那个队列）→ debounce 从不 fire。改为模块加载期捕获宿主定时器。
    - **`fs` 异步 API 实为同步**：`ReadFileJob`/`WriteFileJob` 内联调 `ondone`（`fs.readFile` 回调先于下一句语句）；`readlink`/`symlink`/`link` 忽略 token、异步形式直接 throw。前者改宏任务（待办读会拉住循环），后者改走 `wrap`。
  - **页内实测**：webpack 5.111.1 **完成编译**（不再卡 `make`）；**minifier 在 worker 线程里跑起来了**（`minimizer-webpack-plugin` → `jest-worker/threadChild` → `terserMinify`）；为此把 `Worker({ resourceLimits })` 改为接受并忽略（只是限制，不改变输出）。
  - **下一增量（已定位）**：补 **`require(esm)`** —— terser 的 `exports['.'].require` 指向 ESM 的 `dist/bundle.min.js`，而 loader 对 ESM 的 `require` 只给出空导出面（`terser.minify` 为 `undefined`）。
  - **已交付验收**：`tsc --noEmit` 净 · `vitest run` **1117 passed / 2 skipped（129 文件）** · build ✓。
  - **rspack 一侧（2026-09-24 退险 · 之二）**：wasm binding 含**完整编译器**；页内 npm 装下 `@rspack/core` + `@rspack/binding-wasm32-wasi`（143 包 / 82.3s，无 EBADPLATFORM）。**唯一门槛 = `node:wasi` 未实现**——浏览器 ESM 版自身**含顶层 await**（`await fetch(__wasmUrl)` + `await instantiateNapiModule`）且 `fetch(file://…)`，同步 `require` 必抛 `ERR_REQUIRE_ASYNC_MODULE`；Node CJS 版（`rspack.wasi.cjs`）同步、从 `fs` 读 VFS 里的 wasm、用 `worker_threads`。→ 立 **M125**。

- [x] **M125 · `node:wasi` —— VFS 支撑的 `wasi_snapshot_preview1` 宿主** ← rspack 接入（M121 的 rspack 一侧）的前置 ✅ 2026-09-28（**第一增量 ✅**：真实现了 `node:wasi`（类表面 + 46 个 syscall，backend = 运行时 `fs`/VFS）；表面与真 Node v26.9.0 **逐字段一致**；行为测试证明字节真落进 VFS；页内已推进到 **rspack 的 30MB wasm 实例化 + Rust 初始化开始**。**第二增量 ✅（2026-09-28）**：解开线程 wedge——改用真·浏览器 `Worker` 承载 emnapi 线程池（自建 binding 入口 + 预打包 thread-child，子线程 fs 经 message port 回环父侧 VFS），并修掉 esm-transform 的“字符串字面量导出名”缺支持与 fs proxy 的 stats 原型恢复。**页内跑通 rspack 2.2.7 生产构建（含 terser）**：`compiled successfully in 46.35s / 47.76s`，产物写进 VFS）
  - **第二增量出路**（详见 DEVLOG）：**绕开 `node:worker_threads`**——`examples/rspack/webnode-binding.cjs`（drop-in `rspack.wasi.cjs`）用 `@napi-rs/wasm-runtime` 的 `instantiateNapiModuleSync` + **自定义 `onCreateWorker` 返回真·浏览器 Worker**，加载预打包的 self-contained thread-child（`public/wasi-thread-child.js`，minified 519KB/gzip 141KB）。**子线程不需要 VFS**：emnapi `createFsProxy` 把 fs 操作经 message port 回环父侧，父侧 `createOnMessageForFsProxy(web-node fs)` 服务。
  - **为什么**：实测 `@rspack/binding-wasm32-wasi` 的 **Node CJS 版**（`rspack.wasi.cjs`）是唯一可行路径，它**只阻塞在 `require('node:wasi')` 未实现**（`NotImplementedError`）。浏览器 ESM 版是死路（顶层 await + `fetch(file://)`，见上）。
  - **目标**：实现真正的预览1 宿主，**以 web-node 的 VFS（`node:fs`）作后端**，包成 Node 的 `WASI` 类表面（`wasiImport`/`start`/`initialize`/`getImportObject`/`finalizeBindings`；见上游 `lib/wasi.js`，176 行）。现有 `src/node-runtime/wasm/wasi.ts` 是**最小 stub**（`path_open`→ENOENT、`fd_read`→EBADF、无真文件系统），不能支撑。
  - **收益**：① rspack 的 Rust 侧经 `preopens: { '/': '/' }` + 宿主 `fs` **直接读写 web-node 的 VFS**——FS 桥接问题自然消解，无需镜像；② 任何基于 WASI 的 npm 包（wasm 工具链）通用解锁。
  - **验收**：① `require('node:wasi')` 表面与真 Node 0 diff；② WASI syscall 差分（对真 Node `node:wasi` 行为）；③ 页内 rspack 生产构建产出 bundle。
  - **前置事实（已实测）**：`RSPACK_BINDING=@rspack/binding-wasm32-wasi/rspack.wasi.cjs` 子路径解析可用，已一路走到 `node:wasi` 报未实现。

---

## 阶段 E — 启动与加载性能（**已结清 2026-09-28**）

> **2026-09-23 收敛**：原「性能路线」两条中，**M106（热点 binding → wasm）已拆入阶段 H**（crypto → M119、fs / 同步 syscall → M120），本阶段只保留 **M107**。

- [⤳] **M106 · 热点 binding → wasm**（总纲）→ **已并入阶段 H 的 M119 + M120**
  - 原内容：把热点（buffer/fs/crypto）替换为 wasm 实现；引入 **SharedArrayBuffer + Atomics** 做同步 syscall；前置 COOP/COEP 响应头（子域名隔离路由已就绪 M3.5d）。
  - 承接：crypto → **M119**；fs / 同步 syscall → **M120**。

- [x] **M107 · 启动性能** ✅ 2026-09-28（**基准 + 载荷拆分 + 大 wasm 移出关键路径**）
  - 启动只读计时（`globalThis.__wnBoot`）+ 基准工具 `tools/e2e-startup-bench.mjs`（CDP，可打本地或 Pages）。计时先只有 `moduleEvalMs`/`workerSpawnMs`/`runtimeReadyMs`/`firstRunMs`；本次加了 worker 侧的**分段分解** `vendoredMs`/`wasmMs`/`realmMs`/`deferredMs`（worker 时钟，`ready` 消息里回报，页面并入 `__wnBoot` 并展示）。
  - **第一轮（2026-09-23，已上线）**：vendored 源不再内联进 worker，改为 emit 为 `assets/vendored-sources.txt`（预加载、body 带内容哈希），worker `fetch`+`JSON.parse` 注入。worker **2510.84→653.76 KB**；`runtimeReady` 95–154ms。门禁 `test/vendored-bundle.test.ts`。
  - **第二轮（本次）**：启动期**只在等**小 wasm（`wn_stub`+`wn_zlib`，gzip ~61 KB）；把 **brotli（331）+ zstd（132）+ histogram（100）= gzip ~563 KB** 三个大模块移到**后台预取**（`priority:'low'`，与关键载荷并行）。启动关键载荷 **gzip ~980→~416 KB**。
    - **为何安全**：Realm 与绑定表**完全不碰**这三个（`ex()` 只在 codec / 直方图的**构造器与方法**里调用）。已加不变式测试：清空 wasm 注册表后 Realm 照常构建、`console.log` 照常跑，而 `zlib.brotliCompressSync` 则**响亮报 `wn_brotli` 未加载**。
    - **同步竞态不存在**：所有**会跑用户代码**的请求（`run` / `npmInstall` / `http` / `httpStream`）在分发前 `await ensureDeferredWasm()`——模块未就位就等，绝不半执行。
    - 新增 `wasm-tiers.test.ts`（4 例）：层级不重叠 · 大模块必须在 deferred 层 · 加载器低优先级且幂等 · 坏模块响亮报错 · **无这三个模块也能建 Realm 跑 JS**。
  - **验收**：`tsc --noEmit` 净 · `vitest run` **1148 passed / 3 skipped（137 文件）** · build（`runtime.worker-*.js` **760 KB**）· 页内 + **线上**探针：`brotli rt=true` / `zstd rt=true` / `histogram count=3 max=5 p50=3`。
  - **下一步**：再降要看 1.97 MB 源文本本身（按需子集/懒加载，`require` 同步 => 需「ready 后再补」策略）或 V8 code cache/快照。 → **源文本那条已由 M126 接续并完成**；余下只剩 V8 code cache/快照未做。

- [x] **M126 · 启动载荷再降（vendored 源分层）** ✅ 2026-09-29
  - **背景**：M107 之后，启动关键路径上最大的一块变成 **1.8 MB（gzip 344.6 KB）的 vendored 源文本**：`assets/vendored-sources.txt` 整包预加载，worker 在 `ready` 前 `await` 它并整包 `JSON.parse`。而它其实是「一个巨大 JSON 对象」——163 个文件全在一次同步 parse 里。
  - **做法**：不引入新格式，只**按“谁在启动时被读到”分层**，沿用 M107 对 wasm 的双层策略：
    - **core 层**（54 文件，615 KB / **gzip 121.9 KB**）：`new NodeRuntime(...)` 构建 Realm 与安装全局对象时**真正读到**的那些（primordials、loader 管线、console/process/stream 牵出的内建）。emit 为 `assets/vendored-core.txt`，`index.html` **预加载**，worker `ready` 前 await。
    - **lazy 层**（109 文件，1.36 MB / **gzip 233.9 KB**）：只有用户代码才会碰的（`fs`/`crypto`/`http`、web streams、`node_modules` 辅助）。emit 为 `assets/vendored-rest.txt`，worker 在模块求值期以 `priority:'low'` **后台预取、不 await**。
  - **同步竞态不存在**：所有**会跑用户代码**的请求（`run` / `npmInstall` / `http` / `httpStream`）在分发前 `await ensureDeferredVendored()`——源码未就位就等，绝不半执行（与 `ensureDeferredWasm()` 并列）。新回报事件 `vendoredReady` → `__wnBoot.vendoredDeferredMs`。
  - **分层是“策展清单”而非“静态闭包”**：core 用一张显式清单，新增门禁 `test/vendored-tiers.test.ts` **仪器化 `VENDORED` 重算启动读取集、断言它是 core 的子集**——新加的启动依赖会让门禁失败并点名文件，而不是把拆分发上线就跑坏。`init` 另加**一次性兜底**：若 Realm 构建因缺源报错，就加载 lazy 层再重试一次（宿主差异优雅降级，不硬崩）。
  - **顺带修真差异（不是本次引入的 bug，是拆层/重试路径把它暴露了）**：`Realm#materialize` 在建模块**求值抛错**时把记录留在 `loading` 状态——于是**第二次 `require` 同一 id 会静默返回半成品导出（或 `{}`）而不重跑模块**。Node 的语义是：抛错的模块**不进缓存**，下次 require 重新求值（已在 v26.9.0 实测：`caught1 boom` → `second {"ok":true,"n":2}`）。已改为失败时回滚 `unloaded` 并原样抛错；新增 `test/module-load-failure.test.ts`（2 例，含连续失败每次都重抛）。
  - **验收**：`tsc --noEmit` 净 · `vitest run` **1156 passed / 3 skipped（139 文件）** · build：`vendored-core.txt` **614.66 KB / gzip 121.92 KB**、`vendored-rest.txt` **1,357.81 KB / gzip 233.89 KB**、`runtime.worker-*.js` **765 KB**。
    - **启动期 awaited 的源载荷：gzip 344.6 → 121.9 KB（−222.7 KB）**。启动关键载荷合计（worker JS 230 + vendored-core 121.9 + wn_stub/wn_zlib 59 + index 4 + fs.worker 3）≈ **gzip 418 KB**。
    - **页内 E2E**（`vite preview` + raw CDP）：请求顺序 `vendored-core` 预加载（+4ms，早于 worker 脚本 +16ms）→ worker → `vendored-core` + `vendored-rest` + 小 wasm 并行（+59–62ms）；`ready` @115ms；`vendoredDeferredMs`=25、`deferredMs`=26；**demo 全跑通**（`fs.readFileSync` / worker / child_process / streams，`exit 0 · 395ms`）。
    - **线上 E2E**（`https://mcuking.github.io/web-node/`，gh-pages `857f1d6`）：core 预加载 +497ms、worker +945ms、lazy 源 +1394ms；`runtimeReady` 1753ms（冷）/ 341–349ms（暖）；三跑基准 `vendored(core)=19–21ms · wasm=26–27ms · realm=42–48ms · lazy sources @25ms · deferred codecs @28–29ms`；demo 全跑通。所有线上资产 200。

---

## 阶段 F — 构建工具链（**用户愿景，拍到最后做**）

> 目标：这个浏览器 Node 环境能跑 **rspack / vite / webpack** 等前端构建工具。现状：**vite 已通**（M5c–M5f，build + dev + HMR）。
> **2026-09-23**：M108 / M111 的验收目标与阶段 H 的 **M121**（北极星）重合，故标 `[⤳]` 并入 M121；本阶段只保留 **M109 / M110 / M112**。

- [⤳] **M108 · 对齐异步 / tick 语义，跑通 webpack build** → **已并入阶段 H 的 M121**（北极星）
  - 已定位阻塞点：webpack 5 能加载、能进 `compiler.run`，卡在 `enhanced-resolve` 的模块解析（回调不推进）。
  - 根因候选：① `fs` 回调的投递时机与真 Node 不一致；② 程序结束前 pending 的 **nextTick / microtask 未排空**；③ `CachedInputFileSystem` 的「缓存命中 → `process.nextTick`」路径在此语义下停摆。
  - 顺手已修：`browser` 字段替换目标的解析基准（`78f8a59`）。
  - 验收（移交 M121）：页内 `webpack` 生产构建产出 bundle。

- [x] **M109 · webpack loader / plugin 生态**（2026-09-28 完成）
  - `babel-loader` / `ts-loader` / `css-loader` / `style-loader` / `html-webpack-plugin` / `mini-css-extract-plugin` 全部在页内跑通。
  - 验收证据：`webpack@5.111.1` 生产构建 `hasErrors=false`、`14.3s`，产物 `bundle.js(1278B) + index.html(163B) + styles.css(32B)`；babel `preset-env`（`targets: ie11`）已降级可选链/class（`JS_HAS_OPTCHAIN=false`、`JS_HAS_CLASS=false`），`HtmlWebpackPlugin` 注入 script/link，`MiniCssExtractPlugin` 抽出样式表。
  - 途中修掉 3 个真 bug：**VFS 结构索引化**（`.wvm.json` 曾 130.8MB 内联全部文件内容 → boot 期 OOM；v3 改为只存结构，体量回到 KB 级）、**同步读绕开写队列**（大快照 drain 期间读被 10s `Atomics.wait` 超时）、**npm 解包剥首段**（`@types/*` 的 tarball 根目录是包名而非 `package/`，此前多套一层使 TypeScript 找不到自身类型）。另：忽略 `package.json` 的 **object 形式** `browser` 字段（真 Node 行为；它会把内建/文件替换成浏览器变体）。

- [x] **M110 · webpack watch / dev-server** ✅ 2026-09-28
  - **watch 模式**：`webpack(config).watch(...)` 在页内工作——webpack 的 `watchpack` 走 `fs.watch`，而本运行时的 `fs.watch` 直接挂在虚拟文件系统上，所以任何 `fs.writeFileSync` / 编辑器保存都触发重编译（保留 `aggregateTimeout`）。
  - **手写 dev-server**（`/project/webpack-dev.mjs`）：真 webpack-dev-server 要 express + ws + chokidar，标签页里都没有；于是用虚拟 `http.createServer().listen(5174)` 托管 `/` 与 `/bundle.js`，并把重编译通过 **Vite HMR 同一条 BroadcastChannel 桥**（`web-node-hmr:5174`）以 `full-reload` 推给预览——预览页里的 `WebSocket` 被 sw.js 的 shim 换成该通道，所以没有真 socket。
  - **演示**：新增 `/project/wp/`（纯 ES 模块小应用）+ UI 按钮 **📦 Webpack dev**；该应用**故意 import Vite demo 的同一个 `site/src/message.js`**，于是「改一次源码，两个 dev-server 同时重编译」。
  - **一个真 bug（已修）**：项目根 `package.json` 是 `type: commonjs`，webpack 据此把每个 `.js` 当 CommonJS（`javascript/dynamic`）→ demo 的 `import`/`export` 报 `Module parse failed`。修法是在 config 里加一条 `module.rules` 把 `.m?(j)s` 强制为 `javascript/auto`（同时接受 ESM/CJS，与 Node 对预览 shim 的处理一致）。
  - **验收（页内真实 E2E，CDP）**：① `built bundle.js (3632 bytes)` → 改 `site/src/message.js` → `rebuilt bundle.js (3624 bytes)` → `reload : full-reload -> N client/s`；② `fetch('preview/5174/')` 与 `preview/5174/bundle.js` 均 **200**，bundle 内容随编辑更新（`hasHotUpdated=true`）；③ 预览（`5174.localhost`）连上 reload 通道，每次重编译自动 `location.reload()`（client 计数 1→2→3→4→5）。
  - 门禁：`tsc --noEmit` 净 · `vitest run` **1137 passed / 3 skipped（134 文件）** · build（`runtime.worker-BU2S-_dG.js` **745.71 kB**）。
  - **附**：`webpack` 加入 demo 的 `devDependencies`（`^5.111.1`），「Install deps」即可装齐。

- [⤳] **M111 · rspack（wasm32-wasi + emnapi）** → **已并入阶段 H 的 M121**（wasm 工具链与阶段 H 共用）
  - 现状：核心是 Rust napi 原生插件（`.node`）页面跑不了；但官方有 `@rspack/binding-wasm32-wasi`（2.2.6，基于 `@emnapi/core` + `@napi-rs/wasm-runtime`）。
  - 需要 **WASI 宿主 + 线程（SharedArrayBuffer / COOP-COEP）**。**先做一次性 spike 验证 wasm 能否在页内初始化**，再决定投入。
  - 验收（移交 M121）：页内 rspack 生产构建产出 bundle。

- [x] **M112 · 其他框架 / 工具链（React + PostCSS/Tailwind）** ✅ 2026-09-28
  - **React**：新增 `/project/react-site/`（JSX + hooks 小应用）与 UI 按钮 **⚛ Vite React**；用 `vite.build({ plugins: [react()] })` 在页内构建，`@vitejs/plugin-react@4.3.4`（配 Vite 5 的线）经 Babel 处理 JSX。
  - **PostCSS 管线**：同一构建跑真 **Tailwind v3.4 + autoprefixer 10.4**。插件通过 `css.postcss.plugins` 显式传入（`tailwind.config.js` 仍是 Tailwind 读的配置，content 用**绝对 glob** 以脱离 cwd）——见下「为何不靠 postcss.config.js 自动发现」。产物里 `.text-sky-400` 等工具类**真被生成**、`user-select` **真被 autoprefixer 展开**成 `-webkit-/-moz-` 前缀。
  - **一个真 bug（已修）**：ESM loader 的 `resolve()` 不认 `file://` 说明符；而 `postcss-load-config` 等工具会用 `import(fileUrl)` 加载配置。已在 `resolve()` 开头把 `file://` 归一成路径（Node 的 ESM loader 正是这么做的）。
  - **一个真互操作点**：`await import('tailwindcss')` 的返回值经 CJS→ESM 互操作可能再嵌一层 `default`，取插件函数要 unwrap（否则 `tailwindcss is not a function`）。
  - **验收**：构建日志三项全 true（tailwind / autoprefix / react bundled）；`vite v5.4.21`、`built in 4.0s`。**页内真实渲染**（连预览 OOPIF 读同源子 iframe）：`#root` 文本正确；`h1` 颜色 `rgb(56,189,248)`（= `text-sky-400`）、按钮底色 `rgb(14,165,233)`（= `bg-sky-500`）且圆角 8px（= `rounded-lg`）、`.card` `backdrop-filter: blur(6px)`；点击按钮 React state 递增（count 0→1→2）。
  - 门禁：`tsc --noEmit` 净 · `vitest run` **1137 passed / 3 skipped（134 文件）** · build（`runtime.worker-Czi1jJ7Z.js` **752.31 kB**）。
  - **附**：`react`/`react-dom`/`@vitejs/plugin-react`/`tailwindcss`/`autoprefixer` 加入 demo 的 `devDependencies`。
  - **为何不靠 `postcss.config.js` 自动发现**：Vite 用 `postcssrc({}, config.root)` 找配置，本运行时下未生效（`@tailwind` 原样留在产物里）；显式传插件是等价且确定的做法，`postcss.config.js` 仍随 demo 提供作参考。

- [x] **M128 · 真实工具链端到端：页内跑真 TypeScript 编译器** ✅ 2026-09-29
  - **动机**：M109/M110/M112/M121 已跑通打包器（webpack/rspack/vite）与 CSS 管线，但还没有一个**真『编译器』**端到端闭环。`tsc` 是纯 JS、无原生扩展、且是**最广泛存在的真工具链**，适合作为「类型层工具链在标签页内真能跑」的证据。
  - **做法**：demo 新增 `/project/ts-app/`（`tsconfig.json` + `src/geometry.ts`/`src/index.ts`，带一个穷尽 switch 的联合类型与 `interface`）与入口 `/project/tsc-build.js`；UI 新按钮 **⌨ tsc build**；`typescript@^5.6.3` 加入 demo `devDependencies`。入口：`ts.readConfigFile` → `ts.parseJsonConfigFileContent` → `ts.createProgram` → `program.emit()` → `ts.getPreEmitDiagnostics`，然后 **`require()` 编译产物**、打印其导出。
  - **关键点**：不是只调 API 看有没有报错——而是**把 emit 出来的 `dist/index.js` 真的 `require` 进去**（`dist/geometry.js` 也由它 `require('./geometry')` 解析），拿到 `{count:2,total:15.1416}`；即「**解析 tsconfig → 类型检查 → 产出 `.js`+`.d.ts` → 执行产物**」全在标签页内闭环。
  - **`ts.sys` 直接工作在 VFS 上**：`ts.sys.readFile/readDirectory` 在本运行时指向虚拟 FS，无需自定义 CompilerHost；`outDir`/`rootDir` 与声明文件（`declaration:true`）均正常落盘。
  - **验收**：单元 `test/build.test.ts` 新增 2 例（缺依赖时提示安装、demo 携带 ts-app 源）。**页内 E2E**（`vite preview` + raw CDP）：`reset → install（195 包 / 914ms，含 typescript@5.9.3）→ ⌨ tsc build`，终端：`tool: typescript v5.9.3` / `inputs: 2 file(s), outDir /project/ts-app/dist` / `emit: geometry.d.ts, geometry.js, index.d.ts, index.js` / `program: 2 shapes, total area 15.1416` / `run result: {"count":2,"total":15.1416}` / `result: compiled, emitted and ran in the tab`。门禁：`tsc --noEmit` 净 · `vitest run` **1160 passed / 3 skipped（139 文件）** · build（`runtime.worker-*.js` **768.50 kB**）。
  - **顺带修真 bug（DH 私钥长度）**：M127 全套跑时 `test/crypto-dh.test.ts` 偶发失败的“抖动”实为**真偏离**：OpenSSL 对 `createDiffieHellman(bits, gen)`（及非标准显式素数）用 `BN_priv_rand(BN_num_bits(p) - 1, TOP_ONE, TOP_ANY)`，TOP_ONE 钉死高比特 → **私钥字节长固定** `ceil((bits(p)-1)/8)`；web-node 却画 `[2, p-2]` 均匀分布（~255/256 为 64、余下 63）。实证真 Node：512→恒 64、1024→恒 128、非标准 512 素数→恒 64；命名组（modp14→29・modp5→25）与匹配标准组的显式素数（modp14 素数→27/28/29）语义各自保持。已修 `dh.ts` 默认分支并加 2 例确定性单测。

---

## 阶段 G — 预览与路由（借鉴 WebContainer，2026-09-23 调研落地）

> **来源**：`docs/webcontainer-research.md`（StackBlitz WebContainer 实测）。两条同领域已验证的工程手法，作为后续实现任务。
> **2026-09-24 活体复证**：真开容器后再次确认其预览形态——每端口独立子域 + DevServer SW，另有 `PreviewRelay` 共享 worker 与 `File System Worker`（详见调研第九–十一节）。
> **与现有条目的关系**：M113 承接已完成的 M3.5d「子域名路由」（dev 侧已有，本条做静态托管补齐 + 每端口 DevServer SW）；**M114（真·同步 `fs`）已并入阶段 H 的 M120**（`[⤳]`），本阶段只保留 M113。

- [x] **M113 · 预览端口 → 子域名路由（静态托管跟进）** ✅ 2026-09-29
  - **对标**：WebContainer 把 `listen(8080)` **编进一个唯一子域名**（`<proj>--8080--<hash>.local-credentialless.webcontainer.io`），再在该域名注册一个 **DevServer Service Worker** 拦截所有请求、从内存 FS 供给。
  - **为何优于路径式**：路径式 `/preview/<port>/` 在**站点根相对路径**（`/assets/x.js`）、**cookie 作用域**、**SW scope**、刷新/离线 上都会踩坑；子域名天然避开。
  - **现状**：dev 侧已有 `<port>.localhost` 子域名路由（M3.5d）；静态托管（gh-pages）仍走路径式 `/preview/<port>/`（`src/ui/preview-url.ts` 已有子域名壳 `SUBDOMAIN_SHELL_PATH = '/__webnode__/'` 与 pop-out 分支）。
  - **难点**：静态托管需要**通配 DNS**（当前只有 dev 中间件 `plugins/dev-subdomains.ts` 能供壳），需自定义域 + 每端口 DevServer SW。
  - **验收**：静态托管下预览走子域名；站点根相对路径 / cookie / SW scope 均正确；pop-out 与嵌入两条路都通。
  - **已实现（2026-09-29）**：dev 侧 `<port>.localhost` 保留；新增**通配域子域名**（`VITE_WEB_NODE_PREVIEW_DOMAIN`）——静态托管把每个预览挂到 `<port>.<domain>` 的**真 origin**；预览壳改为**静态资产** `public/__webnode__/index.html`（不再依赖 dev 中间件），寄存器 `sw.js?domain=<domain>` 后经顶层页转发 `web-node:http`、并把 HMR 帧下发到子帧；`src/ui/preview-url.ts` 三策略（dev 子域 / 通配域 / 路径式兜底）纯函数化 + 单测。实测（真浏览器）：dev 下 `http://3000.localhost:5199/__webnode__/` 与静态服务器（`python3 -m http.server`）下 `http://3000.localhost:4180/__webnode__/` **均从虚拟 FS 供给真应用**（标题 `web-node preview`、正文 `Hello from your in-browser Node.js server`、`appUrl=…/`），SW scope 正确。

- [⤳] **M114 · 真·同步 `fs` 且不阻塞 UI（SAB + Atomics + FS-worker）** → **已并入阶段 H 的 M120**
  - **对标**：WebContainer 用 **`SharedArrayBuffer` + `Atomics.wait`** 把主线程"接"到另一个 worker 里的内存 FS（实测：14 个 worker 的 `Runtime.evaluate` 全超时，正是主线程卡在 `Atomics.wait`）——于是浏览器里能提供**真·同步 `readFileSync`**。
  - **现状**：web-node 在**同 realm 内**实现（单线程、简单、不阻塞 UI）；一旦要真并发/真同步就绕不开。
  - **前置**：**跨源隔离（COOP/COEP）**→ 才能用 SAB（隔离路由已就绪 M3.5d）。
  - **验收**：fs 同步调用在独立 worker 完成、主线程可阻塞等待；无 `Atomics.wait` 死锁；与现有 fs 语义差分 0 diff。

---

---

## 阶段 I — 借鉴 WebContainer（**活体调研落地**，2026-09-24）

> **来源**：`docs/webcontainer-research.md` **第九–十一节**——唐工要求「不能只看文章」，故**真开一个 WebContainer（官方 `@webcontainer/api@1.6.0`，Node v22.22.3）逐条实测**：DNS 哨兵 IP、`Fetcher Worker`、TLS 证书为空、`.node → ERR_DLOPEN_DISABLED`、`node:wasi` 端到端可用 / `http2` 连接崩 / `node:sqlite` 原型无方法 / `node:sea` 是桩。
> **筛选原则**：只登记**我们确实缺、且它已实证可行**的功能；纯差异项（如 crypto 非对称——它反而跑不了，我们已实现）与共性项（TLS 边缘终止）**不入表**。
> **与现有条目的关系**：M113（子域名 + 每端口 DevServer SW）已存在，本次实测**复证并强化**；M121（rspack）不受影响（其 `.node` 同样加载不了 → 走 wasm 方案不变）。

- [x] **M122 · 沙箱出站网络（egress）** ✅ 2026-09-29 —— 借 WebContainer 的「宿主源 Fetcher Worker / 托管 proxy」
  - **对标（实测）**：WebContainer 容器内 `fetch` 由 **`stackblitz.com` 源的专用 `Fetcher Worker`** 发出，**不受沙箱页 CORS 约束**（实测 `httpbin.org`（无 ACAO）→ 200）；DNS 给每个域名分假 IP（`example.com→1.0.0.2`、`registry.npmjs.org→1.0.0.3`…），裸 TCP 落到 `127.0.0.1:1`；npm registry 走托管 proxy + server-side 加速。
  - **现状（实现前）**：web-node 只有**入站虚拟 TCP + 回环 DNS**，**无真出网** → 页内 `https`/`net.connect` 到公网 `ECONNREFUSED`；`fetch` 仅因被包了一层宿主 `fetch` 而可用（受宿主 CORS）。
  - **方案**：出站调用（`fetch` / `https` / `net` 出站 socket）经消息通道**转发到「宿主源的专用 worker」**，用**宿主 `fetch`/网络**执行（受宿主 CORS，必要时由**自建受控 proxy** 兜底）；`dns` 保持回环或转由 proxy 侧解析；npm registry 走**可配置代理**——**不依赖 StackBlitz 托管服务**（官方 README 明确其 API 依赖 StackBlitz proxy，我们须自备）。
  - **验收**：页内 `fetch('https://registry.npmjs.org/ms')` 成功；`npm install` 可选走真 registry/proxy；入站虚拟网络与现有差分 **0 回归**；无第三方托管依赖。
  - **风险**：跨源/CORS；企业出口合规；需自备 proxy。工作量：中–大。
  - **已实现（2026-09-29）**：新增 `src/node-runtime/net/egress.ts`（`Egress` 传输层：`request()` 走宿主 `fetch`；可选 `proxy` 模板/前缀兜底；可选 `dialTcp` WebSocket 裸 TCP 桥）。接入缝 `Bindings.egress`（`runtime.ts` 装配、worker 里用 `createWorkerEgress()` 以**宿主源 worker 的 `fetch`** 作传输，proxy 由 `VITE_WEB_NODE_EGRESS_PROXY`/`__WEB_NODE_EGRESS_PROXY__` 配置，**不硬编码任何第三方**）。`http`/`https` 的 `acquire()`：非回环主机 → `EgressConnection`（把请求序列化交给 egress，回包经同一 `HttpMessageReader` 复帧）；`net.connect` 非回环 → 无桥则**响亮 `ECONNREFUSED`**。实测（真浏览器、构建产物）：`https.get('https://registry.npmjs.org/ms')` **200**（改前 `ECONNREFUSED`）、`fetch` 200、`net.connect` 诚实失败；`test/egress.test.ts` 13 例（含 proxy 回退、`{url}`/`%s` 展开、错误打标、回环判定）。

- [x] **M123 · 多进程模型：1 进程 = 1 worker（`fork` / `cluster`）** ✅ 2026-09-28 —— 借 WebContainer 的「worker-per-process」
  - **对标（实测）**：WebContainer 每个「进程」是**独立 Web Worker**（CDP 实测 `Node.js Worker PID 2…22`），故 `fork`/`cluster`/多进程**天然支持**。
  - **落地**：`fork` 子进程本就是**独立 runtime worker**（自己的模块注册表、`process` 视图、`process.pid`、IPC 通道——M7/M40），故这步真正要补的是 **`cluster`** 与**共享端口**。
  - **`cluster`（新 builtin）**：primary 视图与真 Node 对齐（`isPrimary`/`isWorker`、`fork()`、`workers`、`settings`、`setupPrimary`、`disconnect`、`Worker` 类、`fork`/`online`/`listening`/`exit`/`message` 事件）；worker 视图由 `buildClusterWorkerOverrides` 注入（子进程注册表里 `cluster.isWorker=true`、`cluster.worker` 就位）。内部帧走 `{cmd:'NODE_CLUSTER'}` 封包，**绝不冒泡成用户 `'message'`**（与 Node 同）。
  - **共享端口（复用 M102 虚拟 TCP）**：`VirtualNetwork` 新增 `listenShared`/`unlistenShared` + 轮询（`#rr`）；`net.Server` 支持 `exclusive`（Node 的 cluster 共享监听标志）。worker 视图把 `net`/`http`/`https` 的 `Server`/`createServer` 包成默认 `exclusive:false` 并在 `listening` 时向 primary 回传一帧。
  - **两个真坑（已修）**：① `net.createServer()` 内部 `new Server(...)` 用的是**原始类**，只包 `Server` 导出不够——必须让 `createServer` 直接 `new SharedServer(...)`；② **`process.argv[1]` 长期写死 `/project/index.js`**——`runMain()` 不更新 `process.argv`，于是 `cluster.fork()`（重跑 argv[1]）会**跑错文件**（真 Node 重跑当前脚本）。已在 `runMain` 里把 `argv[1]` 设为实际入口。
  - **验收**：`test/cluster.test.ts`（3 例）——① 2 worker 共享 :3000，primary 收到两个 `listening`，连接**轮询**分发（`answers=["w1","w1","w2","w2"]`）；② fork 子进程有独立 pid/env/注册表/IPC；③ **fork 重跑当前入口**（非默认）。程序**原样在真 Node v26.9.0 跑，输出逐行一致**。行为门禁加 6 条 `cluster:*` 观测（both runtimes as primary）。
  - **页内 E2E**（新按钮 **🖧 Cluster** → `/project/cluster-demo.mjs`）：`worker : id 1 up on :3000` / `online : worker 1 pid 100` / id 2 pid 101 / `dispatch : w1 w2 w1 w2 w1 w2` / `primary disconnected`。
  - 门禁：`tsc --noEmit` 净 · `vitest run` **1144 passed / 3 skipped（136 文件）** · build（`runtime.worker-B08TO-iy.js` **759.6 kB**）。

- [x] **M124 · 「加载 OK ≠ 可用」行为门禁（跨模块巡查）** ✅ 2026-09-28 —— 借 WebContainer 的**反面教训**
  - **对标（实测）**：WebContainer 里 `http2` **require 成功但连接崩**（缺 `consume`）、`node:sqlite` **类在但原型无方法**、`node:sea` **是桩**（`isSea()` 返回 `undefined`）——**表面可用、行为不可用**。
  - **落地**：新增 `tools/behavior-smoke-probe.cjs`（**104 个观测**）——对每个「已实现」内建做**一次真实首次调用**（不是只 `typeof`），产 `__OBS__`；`tools/behavior-smoke-oracle.mjs` 在真 Node v26.9.0 上生成 `test/fixtures/behavior-smoke.json`；`test/behavior-smoke.test.ts` 在 web-node 跑同一程序并比对。四项断言：① oracle 能调用而 web-node 不能（含**值不等**，API “能用但撒谎”也算失败）→ 挂；② web-node 不得多出观测键；③ DEVIATIONS 里的每条都必须**真的存在差异**（否则报 stale）；④ 偏离必须**响亮抛类型化** `ERR_WEB_NODE_NOT_IMPLEMENTED`，不许退化成 `MODULE_NOT_FOUND`。
  - **门禁当场扑出 3 处真缺口 + 1 个真 bug**：① **裸 `require('http2')` → `MODULE_NOT_FOUND`**（靠包解析），而 `require('node:http2')` 才是类型化报错——名字不对称、且 side-effect import 会把 module graph 弄崩；② `node:sqlite` 未登记；③ 更深的一层：`unsupported()` 的抛错函数是**箭头函数**，**不可 `new`** → `new DatabaseSync()` 得到的是令人困惑的 `TypeError: not a constructor`，而不是诚实的 `NotImplementedError`。
  - **修复**：① 把 `http2` / `node:sqlite` 登记进 `builtins/unsupported.ts` 的 `unsupportedSpecs`（**导入不炸、使用才响亮抛错**——正是 `unsupported()` 这个 helper 的设计意图）；② 把 `throwingFn` 由箭头函数改为**普通函数表达式**（可构造，`new` 也走报错分支）。
  - **负向验证**：临时摘掉 `http2` 登记 → 门禁立即失败并指名 `expected throw:ERR_WEB_NODE_NOT_IMPLEMENTED, got "throw:MODULE_NOT_FOUND"`；恢复后复绿。证明它真能揪「require-OK 但运行期崩/消失」。
  - **验收**：现有模块**零未记录告警**（仅 `http2` / `sqlite` 两条已在 DEVIATIONS 写明原因）。门禁：`tsc --noEmit` 净 · `vitest run` **1141 passed / 3 skipped（135 文件）** · build 通过。

- [x] **M127 · 差分语料 / 行为门禁扩面（从「能调用」到「算得对」）** ✅ 2026-09-29 —— 把 M124 的门禁从「有没有」加深到「对不对」
  - **动机**：M124 的观测大多是 `shape(fn)`（只 `typeof`）——**这正是 WebContainer 的陷阱本身**：一个 present-but-broken 的函数（抛错的桩、算错的实现）照样 `typeof === 'function'`，能骗过 `shape()`。M127 把观测改成**必须产出一致值**的真实往返。
  - **落地**：`tools/behavior-smoke-probe.cjs` 观测数 **104 → 187**（+83），新增的都是**值/错误形状**类，非 shape：
    - **常量表**：`constants.fs/os.signals/dns/zlib` 真值。
    - **深调用**：`path.normalize/resolve/parse↔format` 往返/`win32.join`、`buffer.compare/swap16/latin1/utf16le/readInt32BE`、`url.resolve/parse↔format`/`URL.pathname`/`domainToASCII`、`querystring.escape`、`string_decoder` 多字节拆分与 `end()` flush、`util.format('%j')`/`inspect(depth)`/`stripVT`/`types.*`。
    - **错误形状**（不只是抛，而是 `name`/`code`/**`message`**）：`assert.AssertionError` 三字段、`fs` 缺文件/`ENOTDIR`/`EEXIST` 的 `code`、`zlib` 非法输入 `code`。
    - **events/perf_hooks/v8 深语义**：`once` 只触发一次、`prependListener` 顺序、`removeListener`；`perf_hooks` mark/measure/clearMarks；`v8` 序列化 Map/Set/Date/RegExp/Error/undefined 往返；`worker_threads.receiveMessageOnPort` **同步端口往返**。
    - **async 往返**（新 `arep`，等真结果）：`timers/promises.setTimeout`、`stream/consumers` 的 `text`/`json`/`buffer`、`fs/promises` 写→读→删。
  - **门禁当场扑出 1 处真缺口**：① `trace_events` —— real Node 能 `createTracing({categories}).categories`，web-node **`MODULE_NOT_FOUND`**（**未登记**，又是「裸 require → MODULE_NOT_FOUND」那类，正是 M124 断言④要拦的）。
    - **修复**：把 `trace_events`（别名 `node:trace_events`）登记进 `builtins/unsupported.ts` 的 `unsupportedSpecs`——**导入不炸、使用才响亮抛 `ERR_WEB_NODE_NOT_IMPLEMENTED`**。为什么是「不支持」而非「实现」：它的能力（V8 tracing 子系统）在标签页里**确实不存在**；而且 **Node 自己在未编 tracing 的构建上也抛 `ERR_TRACE_EVENTS_UNAVAILABLE`**，所以「标签页无 tracing」是**上游正当**的能力缺口，不是 web-node 独有的限制——申报为偏离比伪造 `hasTracing=true` 而实际不发 trace 事件诚实。
  - **负向验证**：临时把 `trace_events` 的登记摘掉 → 门禁立即失败并指名 `trace_events:createTracing: oracle="node" web-node="throw:MODULE_NOT_FOUND"`；恢复后复绿。（前一轮 `:shape` 写法也扑出过 `oracle="function" web-node="throw:MODULE_NOT_FOUND"`——证明 `shape()` 骗不过真实调用这一改是对的。）
  - **验收**：`tsc --noEmit` 净 · `vitest run` **1156 passed / 3 skipped（139 文件）** · 门禁 4 断言全绿、187 观测逐值一致（仅 `http2`/`sqlite`/`trace_events` 三条已在 DEVIATIONS 写明原因）。

---

## 资产盘点：既往工作如何衔接 native→WASM（2026-09-23）

> 架构从「JS 重写 native」转向「真上游 C/C++ 编 wasm」前，先盘点已有 ~120 个里程碑的**去留**。结论：**换发动机、留仪表盘**——不是推翻重来。

| 类别 | 内容 | 处置 |
|---|---|---|
| **地基（继续用）** | Realm / loader / `internalBinding` 调度表（`REGISTRY`）、VFS（内存树 + OPFS）、虚拟 TCP + ServiceWorker 预览、子域名路由（M3.5d）、npm client、UI，以及 **M17–M56 那一大批 vendored 真 Node `lib/` 源码** | **原样保留**（与 native 层正交） |
| **验收装置（最值钱）** | `tools/*-probe.cjs` + `*-oracle.mjs` + `test/fixtures/*.json`（M64–M98 + 阶段 A/B 攒下的差分语料，含 crypto 全套、http/net/fs/module…） | **原样保留，直接作为 wasm 的验收闸门**——wasm 版必须过同一套 probe，才能证明「0 diff」 |
| **将被取代的实现（保留作 fallback/oracle）** | 纯 JS 重写的 native 原语：crypto（hash/cipher/kdf/非对称/PQC/ML-KEM）、zlib shim、string_decoder、buffer、v8 serdes … | **不删**：① 当前是 main 上可跑可部署的版本；② wasm 编不出来时的兜底；③ 语义参照 |
| **语义知识** | `DEVLOG` / `MEMORY` 记的坑（SM4-XTS 的 GB 变体、GCM-SIV one-shot 报错、`internal/errors` 码表、libuv 形状错误消息…） | **保留**——正是 wasm 移植最易踩处 |

---

## 已归档阶段（已完成）

> 阶段 A / B / D 属「JS 重写 native」时代的阶段，均已 100% 完成，原样保留（勾选与描述不复写）；**阶段 C 已解散**（条目已按「阶段重规划说明」分流到阶段 H 与本节）。

---

## 阶段 A — crypto 收尾（接续 M87）

> 现状：非对称半边（RSA/EC/Ed25519/ECDH/DH/X509）已在 M83–M87 完成。剩下的都是「还没做的算法/API」。
>
> **本阶段执行顺序**：M88 → M89 → M90.* → **M92 → M93 → M94 → M91**。其中 **M91（PQC KEM）按原说明后置到末尾**（代码量大、依赖向量多，可后置或砍）；2026-09-22 据其「优先级最低」的原始标注调整了排序。

- [x] **M88 · 素数生成与素性检验** ✅ 2026-09-22
  - `generatePrime` / `generatePrimeSync` / `checkPrime` / `checkPrimeSync`
  - 纯 JS：BigInt 模幂 + Miller-Rabin；对齐 `safe` / `bigint` / `add` / `rem` / `checks` 选项与错误形状（`ERR_OUT_OF_RANGE` / `ERR_INVALID_ARG_TYPE`）。
  - 对应 OpenSSL `BN_generate_prime_ex` / `BN_check_prime`。默认返回 **`ArrayBuffer`**；`size <= 1` 报 `ERR_OSSL_BN_BITS_TOO_SMALL`。
  - 差分：`tools/crypto-primes-probe.cjs` → `test/fixtures/crypto-primes.json`（**0 diff**）；`test/crypto-primes.test.ts`。

- [x] **M89 · Argon2** ✅ 2026-09-22
  - `argon2` / `argon2Sync`（对齐 Node 的选项：`algorithm`/`type`、`message`/`nonce`/`parallelism`/`tagLength`/`memory`/`passes`、`associatedData`/`secret`）。
  - 纯 JS 实现 Argon2d/i/id：`src/node-runtime/crypto/blake2b.ts` + `argon2.ts`（BLAKE2b + BlaMka 压缩 + 三类索引生成）。
  - 差分：`tools/crypto-argon2-probe.cjs` → `test/fixtures/crypto-argon2.json`（**0 diff**，含 RFC 9106 三条官方向量）；`test/crypto-argon2.test.ts`。
  - 风险：中（代码量大，算法是公开规范）。

- [x] **M90 · `createMac` / `getMacs`**（拆为 M90.1–M90.5）✅ 2026-09-22
  > **2026-09-22 拆分原因**：原估计「低–中」偏乐观。实测 `crypto.getMacs()` 返回 11 项（`blake2bmac`/`blake2smac`/`cmac`/`gmac`/`hmac`/`kmac-128`/`kmac-256`/`kmac128`/`kmac256`/`poly1305`/`siphash`），`createMac(algorithm, key, options)` 每个算法各自要一套底层原语。拆成四个可独立验证的里程碑。

- [x] **M90.1 · `getMacs()` + `createMac` 前端与 HMAC / BLAKE2b MAC** ✅ 2026-09-22
  - `Mac` 类（`update`/`final`，继承 `LazyTransform` 的流接口、`_transform`/`_flush`）、`createMac`、`getMacs`。
  - 选项/错误面：`options.digest` 对 HMAC 必填、`options.cipher`/`iv`/`customization`/`salt`/`outputLength`、`ERR_CRYPTO_INVALID_MAC`、`ERR_CRYPTO_MAC_FINALIZED`、`ERR_CRYPTO_MAC_UPDATE_FAILED`、input/output 编码。
  - 复用已有 `hash.ts` 的 hmac 与 `blake2b.ts`。M90.1–M90.4 已全部落地（HMAC / BLAKE2b / BLAKE2s MAC / KMAC / CMAC / GMAC / Poly1305 / SipHash）；唯一已知偏离是非 AES 的 CMAC 块密码与 `aria-*-gcm` 等抛 `NotImplementedError`。
  - 风险：中低。

- [x] **M90.2 · KMAC128 / KMAC256** ✅ 2026-09-22
  - 新增 `src/node-runtime/crypto/keccak.ts`：Keccak-f[1600] 置换 + sponge；SHA3-224/256/384/512、SHAKE128/256，以及 SP 800-185 的 cSHAKE128/256 与 KMAC128/256。
  - `createMac` 接入 `kmac-128`/`kmac-256`：默认输出 32/64 字节、`customization` 映射为 `S`、key 长度 <4 报 `ERR_OSSL_INVALID_KEY_LENGTH`、`options.digest` 不支持。
  - 差分：`test/crypto-mac.test.ts` 已扩展 KMAC 语料（含 SP 800-185 sample #1/#2/#4/#5/#6 与 key 长度扫描）——**0 diff**；`test/keccak.test.ts` 用 FIPS 202 / SP 800-185 官方向量直接钉住置换。
  - **踩坑**：KMAC 尾部是 `right_encode(L)`（L 为**比特**长度），不是 `right_encode(0)`（后者是 KMACXOF）；写成 0 时 sample#1 全错。
  - 风险：中。

- [x] **M90.3 · CMAC / GMAC** ✅ 2026-09-22
  - `cipher.ts` 新增 `aesCmac`（SP 800-38B）与 `aesGmac`（SP 800-38D）；`createMac` 接入 `cmac`/`gmac`。
  - 语义：`options.cipher` 必填；CMAC 要求 CBC 模式（否则 `ERR_OSSL_INVALID_MODE`）、key 长度必须等于 cipher 密钥长（否则 `ERR_OSSL_EVP_INVALID_KEY_LENGTH`）；GMAC 要求 iv 非空（`The property 'options.iv' must be non-empty for GMAC`）、GCM 模式、key 长度对齐（`ERR_OSSL_INVALID_KEY_LENGTH`）；`iv`/`customization`/`salt`/`outputLength` 对 cmac 均不支持，`customization`/`salt`/`outputLength` 对 gmac 不支持（复刻 Node 的校验顺序）。
  - **已知偏离**：非 AES 的 CBC 块密码（des-ede3-cbc / camellia-128-cbc / aria-\*-gcm …）→ 响亮抛 `NotImplementedError`（Node 能算）。
  - 差分：`test/fixtures/crypto-mac.json` 已扩 cmac/gmac（含 keyobj / 大写 cipher / 各种错误面共 51 项）——**0 diff**。
  - 风险：中低。

- [x] **M90.4 · BLAKE2s MAC / Poly1305 / SipHash** ✅ 2026-09-22
  - 新增 `crypto/blake2s.ts`（BLAKE2s，带 key/salt/personal 参数块）、`crypto/poly1305.ts`（RFC 8439）、`crypto/siphash.ts`（匹配 OpenSSL：**默认 16 字节输出**，即 SipHash-2-4 的 128-bit 变体 v1/v2 ^= 0xee；`outputLength:8` 走经典 64-bit 变体）。
  - `createMac` 接入 `blake2smac`/`poly1305`/`siphash`，并用统一的「允许选项集 + 固定校验顺序（digest→cipher→iv→customization→salt→outputLength）」复刻所有「not supported」错误。
  - **修正 M90.1 的缺口**：blake2b/blake2s 的 `salt`/`customization` 是**支持的**（影响参数块），M90.1 忽略了它们（会在传 salt 时算错），现已修正并纳入差分语料。
  - 关键语义：blake2s 输出/密钥 ≤32、salt/custom ≤8；blake2b ≤64 / salt,custom ≤16；poly1305 密钥必须 32；siphash 密钥必须 16、输出∈{8,16}（其他 → `ERR_CRYPTO_OPERATION_FAILED`）。
  - 差分：`test/fixtures/crypto-mac.json` 扩到 **78 个错误项** + blake2s/poly1305/siphash 正向向量——**0 diff**。
  - 风险：中低。

- [x] **M90.5 · SHA-3 / Keccak / SHAKE / keccak-kmac 注册** ✅ 2026-09-22
  > **拆分原因**：动手做 M90.5 时实测真 Node 的 `getHashes()` 有 **81 个可用名字**（不是原先以为的十来种），包含 SHA-3/Keccak/SHAKE/keccak-kmac/blake2/SM3/RIPEMD-160/SHA-512-t/SHA-256-192/md5-sha1 及大量 RSA-*/…WithRSAEncryption 别名。原估「中低」严重偏低，故拆为 **M90.5–M90.9** 五个子任务（任务数 30 → 34）。
  - `keccak.ts` 导出原始 sponge；`Hash` 支持 XOF 的 `options.outputLength`（缺省 **shake128=16 / shake256=32**）；注册 `sha3-224/256/384/512`、`keccak-224/256/384/512`（pad 0x01）、`shake-128/256`、`keccak-kmac-128/256`（pad 0x04，rate 168/136）及其全部别名。
  - 风险：低。

- [x] **M90.6 · BLAKE2b-512 / BLAKE2s-256 注册** ✅ 2026-09-22
  - 直接用 M90.1/M90.4 的 `blake2b.ts`/`blake2s.ts`（无 key/salt/personal 的普通摘要形式）；注册 `blake2b512`/`blake2b-512`/`blake2s256`/`blake2s-256`。
  - 风险：低。

- [x] **M90.7 · SM3 + RIPEMD-160** ✅ 2026-09-22
  - 新增两个纯 JS 摘要实现（GB/T 32905 与 ISO/IEC 10118-3），并注册 `sm3`/`RSA-SM3`/`sm3WithRSAEncryption`、`ripemd160`/`ripemd`/`ripemd-160`/`rmd160`/`RSA-RIPEMD160`/`ripemd160WithRSA`。
  - 风险：中低（两套轮函数）。

- [x] **M90.8 · 截断变体与复合摘要** ✅ 2026-09-22
  - `sha-512/224`、`sha-512/256`（SHA-512/t，需改 IV）+ `RSA-SHA512/224`/`RSA-SHA512/256`；`sha-256/192`（`sha2-256/192`/`sha256-192`，SHA-256 截断）；`md5-sha1`（复合）；`ssl3-md5`/`ssl3-sha1` 别名。
  - 风险：中低。

- [x] **M90.9 · `getHashes()` 全表对齐（差分门禁）** ✅ 2026-09-22（getHashes 已 **81/81** 与真 Node 一致）
  - 把 `getHashes()` 与真 Node 的 **81 名列表**逐项比对（含排序与所有别名），并加 `createHash(每个名字)` 的差分回归。
  - 风险：低。

- [x] **M91 · 后量子 KEM** ✅ 2026-09-22
  - `encapsulate` / `decapsulate`（ML-KEM / Kyber），以及 `ml-kem-512/768/1024` 密钥类型。
  - 纯 JS 实现 ML-KEM（FIPS 203），建在既有 Keccak（SHA3/SHAKE）之上；NTT 常量由 `ζ = 17` 程序化推导，不手抄。
  - 与真 Node / OpenSSL 逐字节对齐（差分 0 diff）；签名验签/封装/解封类全绿。
  - 风险：高（已控制，实测通过）。

- [x] **M92 · `crypto.diffieHellman` + DH KeyObject** ✅ 2026-09-22
  > **拆分原因**：动手前调查发现 web-node **根本没有 DH 类型的 `KeyObject`**（`AsymType` 只有 `rsa|ec|ed25519`，`generateKeyPairSync('dh')` 会抛错）。而 `crypto.diffieHellman` 既接 DH 也接 EC 的 `KeyObject`，所以要先把 DH KeyObject 补上。原估「低风险」偏低，故拆为 M92.1/M92.2（任务数 34 → 35）。

- [x] **M92.1 · DH `KeyObject`** ✅ 2026-09-22
  - `KeyMaterial` 增 `dh`；`generateKeyPairSync('dh', { group } | { prime, generator })`；`asymmetricKeyType === 'dh'`；导出/解析 PKCS#3（私钥）与 SPKI（公钥，OID `dhKeyAgreement`），PEM 标签 `DH PRIVATE KEY`/`PUBLIC KEY`；`export`/`equals`/`toCryptoKey` 相应支持。
  - 风险：中（DER 编解码 + 参数校验）。

- [x] **M92.2 · `crypto.diffieHellman({ privateKey, publicKey })`** ✅ 2026-09-22
  - DH：`y_b^{x_a} mod p`，按 prime 长度补前导零；EC：`d_a · Q_b` 的 x 坐标，按曲线字节长补齐。
  - 错误面：`options` 非对象 → `ERR_INVALID_ARG_TYPE`；私/公钥缺失 → `The property 'options.privateKey/publicKey' is invalid. Received undefined`；类型不符 → `ERR_CRYPTO_INCOMPATIBLE_KEY`（`Incompatible key types for Diffie-Hellman: dh and rsa`）；跨组 → `ERR_OSSL_MISMATCHING_DOMAIN_PARAMETERS`。
  - 风险：中低。

- [x] **M93 · 更多对称密码**（拆为 M93.1–M93.4）✅ 完成
  > **2026-09-22 拆分原因**：原估「低–中」但覆盖面很大（DES/3DES、ChaCha20、CCM、OCB、SIV、XTS、wrap 系列，以及 Camellia/ARIA/SM4），每个都有各自的模式/参数/向量，混作一个里程碑无法逐项验证。按建议顺序拆为四个子项（任务数 35 → 38）。

- [x] **M93.1 · ChaCha20 / ChaCha20-Poly1305** ✅ 2026-09-22
  - 新增 `src/node-runtime/crypto/chacha20.ts`：ChaCha20 块函数 + 流式 keystream（raw 用 64-bit 计数器、AEAD 用 32-bit），以及 RFC 8439 Poly1305 AEAD（复用 `poly1305.ts`）。
  - `createCipheriv` 接入 `chacha20`（IV 16）与 `chacha20-poly1305`（IV 12）；两套实现共用 `SyncCipher` 接口，`crypto/cipher.ts` 新增 `createCipher` 工厂与 `cipherTagLengthIsValid`。
  - 语义修正（对齐真 Node）：`getCipherInfo` 对 stream 模式不再返回 `blockSize`；`setAuthTag` 改为要求长度**等于** `authTagLength`（GCM 一并修正）；chaCha 解密未 `setAuthTag` 时也按全零 tag 校验并报 `Unsupported state or unable to authenticate data`（无 `code`）。
  - 差分：`tools/crypto-chacha-probe.cjs` → `test/fixtures/crypto-chacha.json`（含 RFC 8439 §2.4.2/§2.8.2 官方向量、截断 tag、AAD、错误面）——**0 diff**；`test/crypto-chacha.test.ts`。
  - 风险：低。

- [x] **M93.2 · DES / 3DES** ✅ 2026-09-22
  - 新增 `src/node-runtime/crypto/des.ts`：纯 JS DES 块密码（FIPS 46-3 全表）+ EDE2/EDE3；`createCipheriv` 接入 `des-ede`/`des-ede-ecb`/`des-ede-cbc`/`des-ede-cfb`/`des-ede-ofb` 与 `des-ede3`/`des-ede3-ecb`/`des-ede3-cbc`/`des-ede3-cfb`/`des-ede3-ofb`/`des3`（ECB/CBC/CFB-128/OFB，8 字节块 + PKCS#7）。
  - 顺带把 CMAC 改成**通用块密码 CMAC**（`cmacCore` + `aesCmac`/`desCmac`），于是 `createMac('cmac', key, { cipher: 'des-ede3-cbc' })` 也能算了（8 字节 tag）——M90.3 记的「非 AES CMAC 报错」偏离因此收窄。
  - **已知偏离**：原先缺的 `des-ede3-cfb1/cfb8`（M93.4e）与 `des3-wrap`/`id-smime-alg-cms3deswrap`（M93.4f）均已落地；DES 族已对齐真 Node（无遗留缺口）。
  - 差分：`tools/crypto-des-probe.cjs` → `test/fixtures/crypto-des.json`（**0 diff**）；`test/crypto-des.test.ts`；CMAC 语料并入 `test/fixtures/crypto-mac.json`。
  - 风险：中低。

- [x] **M93.3 · AES-CCM** ✅ 2026-09-22
  - 新增 `src/node-runtime/crypto/ccm.ts`：SP 800-38C 的 CBC-MAC + 计数器模式 AEAD，含 B0/A0 构造、AAD 长度前缀（<0xff00 用 2 字节，否则 0xfffe/0xffff 变长）、payload 块切分。
  - 把 AES 块密码从 `cipher.ts` 抽到新模块 `src/node-runtime/crypto/aes.ts`（`AesKey` 导出），`cipher.ts` 与 `ccm.ts` 共用，避免循环依赖。
  - `createCipheriv` 接入 `aes-{128,192,256}-ccm` 与其 `id-aes*-ccm` 别名；`authTagLength` **必填**（缺失报 `ERR_CRYPTO_INVALID_AUTH_TAG: authTagLength required for aes-128-ccm`），合法值 `{4,6,8,10,12,14,16}`；nonce 长度限 `[7,13]`，越界报 `ERR_CRYPTO_INVALID_IV: Invalid initialization vector`。
  - 语义对齐真 Node：带 AAD 时 `plaintextLength` 必填（缺失报 `ERR_MISSING_ARGS: options.plaintextLength required for CCM mode with AAD`）；`update` 必须**一次性**给出精确 `plaintextLength` 字节，否则报 `Trying to add data in unsupported state`（无 `code`）；解密 tag 不匹配报 `Unsupported state or unable to authenticate data`。
  - 差分：`tools/crypto-ccm-probe.cjs` → `test/fixtures/crypto-ccm.json`（含 SP 800-38C 附录 C 例 1、16/24/32 密钥、tag 4–16、nonce 7–13、空 payload、全套错误面）——**0 diff**；`test/crypto-ccm.test.ts`。
  - 风险：中低。

- [x] **M93.4 · 其余模式与密码**（拆为 M93.4a–M93.4h）
  > **2026-09-22 拆分原因**：与 M93 同理——覆盖面过大（三种额外块密码 + 四种额外模式/包装），逐项验证无法混在一起。拆为：

  - [x] **M93.4a · Camellia** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/camellia.ts`：纯 JS 实现 RFC 3713（128 位分组、128/192/256 位密钥；BigInt 写密钥编排与 Feistel 数据路径，S 盒 `s2/s3/s4` 由 `s1` 旋转得到）。
    - 把 AES 风格的模式驱动 `Cipheriv` 泛化：新增 `BlockCipher` 接口（`encryptBlock`/`decryptBlock`），构造函数可选传入块密码（默认 `AesKey`），于是 Camellia 直接复用 ECB/CBC/CFB/OFB/CTR 与 PKCS#7。
    - 接入 `camellia-{128,192,256}` 的 ecb/cbc/cfb/ofb/ctr + `camellia128/192/256` 别名；CMAC 现按 cipher 分派（`cmacForCipher` → `aesCmac`/`desCmac`/`camelliaCmac`）。
    - **关键坑**：128 位密钥的 `k1..k18` 并非连续半字对——`k10` 取的是 `KL<<<60` 的**低**半字（RFC 3713 §2.2），初版按 `halves()` 成对生成导致密文错位；改用显式 `hi()/lo()` 后与官方向量一致。
    - 差分：`tools/crypto-camellia-probe.cjs` → `test/fixtures/crypto-camellia.json`（RFC 3713 三条官方向量 + 15 个模式组合 + 流式/padding + CMAC + 错误面）——**0 diff**；`test/crypto-camellia.test.ts`。
    - 风险：中低。
  - [x] **M93.4b · ARIA / SM4** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/aria.ts`（RFC 5794：`FO=A(SL1(D^RK))`/`FE=A(SL2(D^RK))`、三层 Feistel 密钥编排、末轮 SL2 加双密钥；SB3/SB4 由 SB1/SB2 的逆**推导**而非手抄）与 `src/node-runtime/crypto/sm4.ts`（GB/T 32907：32 轮、`tau` + `L`、密钥编排 `L'`）。
    - 两者都是 128 位块，直接复用泛化后的 `Cipheriv`。接入 `aria-{128,192,256}` 与 `sm4` 的 ecb/cbc/cfb/ofb/ctr，加 `aria128/192/256`、`sm4` 别名；CMAC 分派扩展到 aria/sm4。
    - 顺手修掉 M93.4a 遗留的一个隐患：camellia/aria/sm4 用专用的 5 模式表（不再误用含 gcm 的 6 项 `modes` 生成幽灵 `*-gcm` 条目）。
    - 差分：`tools/crypto-aria-sm4-probe.cjs` → `test/fixtures/crypto-aria-sm4.json`（ARIA/SM4 全部 20 个名称的 info + 20 组模式密文/回环 + 流式/无 padding + CMAC + 错误面）——**0 diff**；`test/crypto-aria-sm4.test.ts`。
    - 风险：中低。
  - [x] **M93.4c · AES-OCB 与 key wrap** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/ocb.ts`：按 OpenSSL `ocb128.c` 逐字节实现 RFC 7253（`L_*`/`L_$`/`L_i` 双倍、stretch 取位生成 `Offset_0`、CBC-MAC 式 checksum 与 AAD sum）。**注意 OpenSSL 的 nonce 不标准**：`nonce[0]=((taglen*8)%128)<<1`、IV 靠右、其左一字节置 1——所以密文会随 tag 长度变化，必须按它来。
    - 新增 `src/node-runtime/crypto/wrap.ts`：RFC 3394 `wrap` 与 RFC 5649 `wrap-pad`（含 n=1 的 AIV||P 单块特例）；两者都是**单次 update**（`update` 返回全部输出、`final` 空，二次 update 报 `Trying to add data in unsupported state`）。
    - 接入 `aes-{128,192,256}-ocb`（IV 1..15、`authTagLength` 必填、0..16）与 `aes-{128,192,256}-wrap`/`-wrap-pad`（含 `aes128-wrap`、`id-aes128-wrap` 等拼写，IV 8/4 字节且必填）。
    - 语义细节：OCB 按 OpenSSL provider 那样**缓存尾巴不满块**，末块输出在 `final`；解密 tag 不符在 `final` 报 `Unsupported state or unable to authenticate data`；`getAuthTag` 在 `final` 前报 `ERR_CRYPTO_INVALID_STATE`。
    - **已知偏离**：`aes-*-wrap-inv`/`-wrap-pad-inv`（M93.4f）与 `des3-wrap`/`id-smime-alg-cms3deswrap`（M93.4f）均已落地。
    - 差分：`tools/crypto-ocb-wrap-probe.cjs` → `test/fixtures/crypto-ocb-wrap.json`（RFC 7253 附录 A、tag 8/12/16、IV 8/12/13/15、空/块/长 payload、流式分块、wrap/wrap-pad 的 RFC 3394/5649 向量与回环、全套错误面）——**0 diff**（首次运行）；`test/crypto-ocb-wrap.test.ts`。
    - 风险：中。
  - [x] **M93.4d · AES-SIV / AES-XTS** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/siv.ts`：RFC 5297 的 S2V（`d = dbl(d) ^ CMAC(K, aad)`，载荷块 `len>=16` 用 `S||(S_last^d)`、否则 `dbl(d) ^ pad(S)`）+ AES-CTR；密钥为两半（CMAC 半 + CTR 半），tag 即 IV，tag 固定 16 字节。
    - 新增 `src/node-runtime/crypto/xts.ts`：IEEE 1619 的 tweak = AES(k2, iv)、逐块 doubling、尾部不满块按**密文窃取**（CTS）处理；密钥两半不可相同（否则 `ERR_OSSL_XTS_DUPLICATED_KEYS`）。
    - 接入 `aes-{128,192,256}-siv`（无 IV、`ivLength=0`、无 nid）与 `aes-{128,256}-xts`（IV 16、nid 913/914，无 192 变体）；`getCipherInfo` 现在会像 OpenSSL 那样在 nid/ivLength 为 0 时**省略该字段**。
    - **关键坑**：①XTS 的 tweak doubling 是**小端**方向的 GF 倍乘（进位从末字节流向首字节），与 SIV/GCM 的大端方向相反——最初复用了大端的 `dbl` 导致从第 2 块起全错；②`Buffer.prototype.slice` 在本 runtime 里返回**共享内存的视图**，CTR 计数器自增因此改写了存起来的 auth tag 末字节，必须用 `new Uint8Array(x)` 显式拷贝。
    - 语义细节：SIV/XTS 都是**单次 update**（二次 update 与不足一块报 `Trying to add data in unsupported state`）；SIV 未 `update` 就 `final` 报鉴权错误，XTS 报 `Unsupported state`；XTS 的 `setAAD`/`getAuthTag`/`setAuthTag` 报 `ERR_CRYPTO_INVALID_STATE`。
    - 差分：`tools/crypto-siv-xts-probe.cjs` → `test/fixtures/crypto-siv-xts.json`（SIV：128/192/256 密钥、多 AAD、空/16/32/40 字节载荷；XTS：16/20/32/33/48/1000 字节、全块与 CTS、两套 key/iv；全套错误面）——**0 diff**；`test/crypto-siv-xts.test.ts`。
    - 风险：中高。
  - [x] **M93.4e · CFB 反馈位宽（cfb1/cfb8）与 SM4 128 位别名** ✅ 2026-09-23
    - 新增 `src/node-runtime/crypto/cfb.ts`：位粒度通用 CFB（反馈宽度 1/8/128 位），按 OpenSSL `cfb128.c` 的 `cfbr_encrypt_block` 逐位实现——每步 `E(R)`、取高 `s` 位、`R=(R<<s)|(反馈位)`；**加密反馈输出位、解密反馈输入位**（可逆性所在）。
    - AES/ARIA/Camellia 走 `Cipheriv`（16 字节块），DES 走 `DesCipher`（8 字节块），分别接入 `cfb1`/`cfb8`。
    - 新增名称：`aes-{128,192,256}-cfb1/cfb8`、`aria-*-cfb1/cfb8`、`camellia-*-cfb1/cfb8`、`des-ede3-cfb1/cfb8`（20 个）+ `sm4-cfb128`/`sm4-ofb128`（info 名为 `sm4-cfb`/`sm4-ofb` 的别名）——`getCiphers()` 从 **111 → 133**（真 Node 165）。
    - **关键坑**：①位粒度的 keystream 必须**每步从寄存器重新加密**（初版对一个全零缓冲加密，得到 `E(K,0)`）；②`DesEde.encrypt` **返回新数组、不改原数组**，与 AES 的 `encryptBlock`（原地）不同，直接把返回值丢弃会让 DES 的 keystream 永远等于寄存器本身（且 cfb1 与 cfb8 输出巧合地一样）——需 `b.set(this.#ede.encrypt(b))`。
    - 差分：`tools/crypto-cfb-feedback-probe.cjs` → `test/fixtures/crypto-cfb-feedback.json`（22 名称 × 9 种长度（含 0/非整块）× 加解密回环 + 流式分块 + `getCipherInfo` + `getCiphers` 成员）——**0 diff**；`test/crypto-cfb-feedback.test.ts`。
    - 仍缺（后续 M93.4f+）：`aes-*-cbc-cts`、`aes-*-gcm-siv`、`aria-*-ccm/gcm`、`aria/sm4` 的 XTS/CCM/GCM、`aes-*-wrap-inv`/`-wrap-pad-inv`、`des3-wrap`/`id-smime-alg-cms3deswrap`。
  - [x] **M93.4f · 逆 cipher 密钥包装与 DES3-CBC 包装** ✅ 2026-09-23
    - 新增 `wrap.ts` 的**逆 cipher** 支持：`*-wrap-inv`/`*-wrap-pad-inv` 按 SP 800-38F 指定 **AES 逆 cipher**（`AES_decrypt`）作为块函数——加密实例用 `decryptBlock`、解密实例用 `encryptBlock`（实例内单一 designated block，与 OpenSSL `cipher_aes_wrp.c` 的 `use_forward_transform = !enc` 一致）。
    - 新增 `src/node-runtime/crypto/des3-wrap.ts`：RFC 3217 / CMS `des3-wrap`（`id-smime-alg-cms3deswrap`，nid 246）。固定外层 IV `4adda22c79e82105`；内层随机 IV + SHA-1 ICV；整体 reverse 后再 CBC。**加密非确定**（随机 IV），因此差分只比**解密**与**回环**。
    - 新增名称：`aes-{128,192,256}-wrap[-pad]-inv` 与 `aes{128,192,256}-wrap[-pad]-inv`（12，无 nid）+ `des3-wrap`/`id-smime-alg-cms3deswrap`（2）→ **`getCiphers()` 133 → 147**。
    - **关键坑（又一个 Buffer 别名）**：web-node 的 `Buffer.prototype.slice` **返回共享内存的视图**，`unwrapRaw` 里 `a = a.slice()` 实际改写了调用者的密文缓冲区——症状是「先解密再用同一密文」时密文被 XOR 掉一串计数器值（`1fa68b0a8112b447` → `...b44b`）。修正：本模块所有可能来自调用者的 `.slice()` 改为 `new Uint8Array(...)` 显式拷贝。
    - 语义细节：`des3-wrap` 用 **null/空 IV**（非空 IV → `ERR_CRYPTO_INVALID_IV`），空输入 → 空输出，输入非 8 字节倍数 → unsupported state，解密 <24 字节 → unsupported state。
    - 差分：`tools/crypto-wrap-inv-des3-probe.cjs` → `test/fixtures/crypto-wrap-inv-des3.json`（12 个 inv 名称的 info + 加密/回环/与正向模式差异、des3 的录制密文解密 + 随机回环 + 全套错误面）——**0 diff**；`test/crypto-wrap-inv-des3.test.ts`。
    - 仍缺（M93.4g+，18 个）：`aes-*-cbc-cts`、`aes-*-gcm-siv`、`aria-*-ccm`、`aria-*-gcm`、`camellia-*-cbc-cts`、`sm4-ccm`/`sm4-gcm`/`sm4-xts`。
  - [x] **M93.4g · CBC 密文窃取（NIST CTS）** ✅ 2026-09-23
    - 新增 `src/node-runtime/crypto/cbc-cts.ts`：按 OpenSSL 的 **NIST CTS**（`crypto/modes/cts128.c` 的 `CRYPTO_nistcts128_*`）逐块移植。与 RFC 2040/3962 不同：**允许输入为块大小整数倍**且**不交换最后两块**；末段明文与前一密文块异或后再加密，写回位置**偏移 `residue` 字节**（这个重叠写就是“窃取”）。
    - 新增 `aes-{128,192,256}-cbc-cts`、`camellia-{128,192,256}-cbc-cts`（6）→ **`getCiphers()` 147 → 153**。
    - **关键坑**：解密末段重建 C(n-1) 后必须用 **`decryptBlock`**（即 `D(ct_mid)`）而非 `encryptBlock`——加密方向匹配但解密方向会错。症状：密文完全对、明文乱掉。
    - 语义（与真 Node 一致）：**一次性**模式——`update` 至少一个块且只允许一次（第二次 → “Trying to add data in unsupported state”）；`update` 一次性吐出全部输出；`final()` 仅关闭（返回空）；无 `update` 先 `final()` → “Unsupported state”；二次 `final()` → `ERR_CRYPTO_INVALID_STATE`/“Invalid state”；`getAuthTag()` → “Invalid state for operation getAuthTag”。`CMAC` 接受 `cbc-cts`（与普通 cbc 同值，已对齐）。
    - 差分：`tools/crypto-cbc-cts-probe.cjs` → `test/fixtures/crypto-cbc-cts.json`（6 个名称 info；12 种长度含 16/17/18/20/31/32/33/47/48/49/64/1000 的加密+回环；一次性语义；全套错误面）——**0 diff**；`test/crypto-cbc-cts.test.ts`。
    - 仍缺（M93.4h+，12 个）：`aes-*-gcm-siv`(3)、`aria-*-ccm`(3)、`aria-*-gcm`(3)、`sm4-ccm`/`sm4-gcm`/`sm4-xts`(3)。
  - [x] **M93.4h · AES-GCM-SIV、ARIA CCM/GCM、SM4 CCM/GCM/XTS（cipher 全表 165 对齐）** ✅ 2026-09-23
    - 新增 `src/node-runtime/crypto/gcm-siv.ts`：按 OpenSSL `cipher_aes_gcm_siv{,_polyval,_hw}.c` 实现 **RFC 8452 AES-GCM-SIV**。先从 nonce 用 AES-ECB 派生每消息密钥（`msg_auth_key` = `E(K,LE32(0)‖N)[0..8]‖E(K,LE32(1)‖N)[0..8]`、`msg_enc_key` 从 counter 2 起每 8 字节一半）；POLYVAL 用 GHASH 在**字节反转**操作数上算（key 字节反转后乘 x）；tag 再经 AES-ECB 并置 `counter[15] |= 0x80`，CTR32（前 4 字节**小端**计数器）出密文。**解密先跑 CTR 再重算 tag**。
    - `AesCcm` 改为接受任意块密码（新增 `CcmBlockCipher` 接口 + 构造末参 `block?`），ARIA/SM4 的 CCM 走各自 family 的块函数；`AesXts` 改为接受块密码构造器 + 可选 tweak 加倍函数 + 是否查重键。
    - **关键坑（SM4-XTS 与 AES-XTS 不同）**：SM4-XTS 用 OpenSSL 的 **GB 变体**（`crypto/modes/xts128gb.c`，见 `cipher_sm4_xts.c`）——tweak 加倍是**大端右移**、反馈常量 `0xe1` 进**最高字节**；AES-XTS 才是 IEEE 1619（小端左移、`0x87` 进最低字节）。症状：单块对、多块从第二块起全错。故 `xts.ts` 导出 `gbTweakDbl` 并让 sm4 分支传入。另：SM4-XTS **不做**重键检查（AES-XTS 才查）。
    - **关键坑（GCM-SIV one-shot）**：与 CTS/XTS 同为一次性模式，但它是 **AEAD**，`Final()` 在无先导 `update()` 时返回“Unsupported state or unable to authenticate data”（Node `CipherBase::Final` 的 `isGcmSivMode` 检查），而非 CTS/XTS 的“Unsupported state”。
    - 新增名称：`aes-{128,192,256}-gcm-siv`(3)、`aria-{128,192,256}-ccm`(3)、`aria-{128,192,256}-gcm`(3)、`sm4-ccm`/`sm4-gcm`/`sm4-xts`(3) → **`getCiphers()` 153 → 165**，与真 Node **逐名 0 缺 0 余**。
    - 差分：`tools/crypto-gcm-siv-aead-probe.cjs` → `test/fixtures/crypto-gcm-siv-aead.json`（12 名称 info；GCM-SIV 多长度加解密+回环；ARIA/SM4 CCM/GCM 回环；SM4-XTS 5 种长度；GCM-SIV/CCM/XTS 全套错误面）——**0 diff**；`test/crypto-gcm-siv-aead.test.ts`。
    - 连带修正：`test/cipher.test.ts`（原以 `aes-128-gcm-siv` 当“未实现”示例 → 改为断言 `getCiphers().length === 165`）、`test/crypto.test.ts`（移除该例）、`test/crypto-mac.test.ts`（注释更新，aria-ccm 的 CMAC 仍报 invalid mode）。

- [x] **M94 · `crypto.Certificate`** ✅ 2026-09-22
  - Node 已弃用的 `crypto.Certificate` 类（`verifySpkac`/`exportPublicKey`/`exportChallenge`）。由 `src/node-runtime/crypto/spkac.ts` 实现（NETSCAPE_SPKI 解析 + OpenSSL 风格 base64 解码 + 签名校验），在 builtin 里接成「可 new 也可直接调用」的函数 + 原型/静态三方法。
  - 风险：低。

---

## 阶段 B — 语义深度（差分语料继续扩面）

> 已做：`http`(M79) · `net`(M80) · `fs`(M81) · `crypto` 非对称(M83–87)。方法固定为「同一观测程序在真 Node 与 web-node 各跑一遍，JSON 逐字段相等」。

- [x] **M95 · `net` 连接生命周期与超时** ✅ 2026-09-22
  - 连接状态机、`connect`/`timeout`/`error` 事件序、`socket.setTimeout`、半开连接、`allowHalfOpen` 语义的差异对齐。
  - 差分探针 `tools/net-lifecycle-probe.cjs` 在真 Node 与 web-node 各跑一遍，**0 diff**；修了虚拟 TCP 的半开/关闭语义与 `http.Server#close` 空转问题。

- [x] **M96 · `fs` 错误形状补全** ✅ 2026-09-22
  - 把剩余 ENOENT/EACCES/EISDIR/ENOTDIR 等路径的错误码、`syscall`、`path`、`errno` 逐字对齐真 Node（VFS 层）。
  - 差分探针 `tools/fs-errors-probe.cjs`（51 个观测）在真 Node 与 web-node 各跑一遍，**0 diff**；错误对象本身也对齐（`constructor.name` = `Error`/`SystemError`、自有属性集、`name` 在原型上）。

- [x] **M97 · `module` 同步 loader 语义（hooks / SourceMap / findPackageJSON / 内部 loader 面）** ✅ 2026-09-22
  - `registerHooks`（同步 loader hooks：resolve/load 链、`next` 委托、`shortCircuit` 契约、`deregister`）、`SourceMap` 的注册/查找语义（`findSourceMap` + `setSourceMapsSupport`/`getSourceMapsSupport`）、`findPackageJSON`、`_load`/`_findPath`/`_readPackage`/`_stat`/`_preloadModules` 的 loader 面。
  - 差分探针 `tools/module-hooks-probe.cjs`（35 个观测）在真 Node/web-node 各跑一遍，**0 diff**。
  - `stripTypeScriptTypes` 拆到 **M97.1**（需真 TS 解析器）。

- [x] **M97.1 · `stripTypeScriptTypes`（TS strip-only）** ✅ 2026-09-23
  - 路线 = **选项 B（纯 JS strip-only）**：自研 TS 剥离器（`src/node-runtime/ts/strip-types.ts`，~1250 行），不引 amaro/SWC wasm。
  - 类型跨度按位覆写成空白、**按 UTF-8 字节宽度补位**（1→` `、2→U+00A0、3→U+2002、4→`' '+U+FEFF`；`\n`/`\r`/`\t` 保留），从而字节长度与真 amaro 一致。
  - 覆盖 `interface`/`type`/`declare`/`namespace`/`import type`/类型注解/类型参数与实参（含 `<` 比较回退）/`as`/`satisfies`/`!`/可选/参数属性/类字段/抽象成员/索引签名/类型谓词；不支持语法响亮抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。
  - 差分探针 `tools/strip-ts-probe.cjs`（170 例）在真 Node v26.9.0 与 web-node 各跑一遍，**0 diff**；全仓库 227 个 `.ts` 扫描同样 **0 diff/0 hang**。
  - 选 B 的依据：实测 WebContainer（StackBlitz）同类场景亦为纯 JS 自实现（详见 `docs/webcontainer-research.md` 第 8 节）；不 vendor `amaro`（会把 worker 从 2.47MB → ~6.3MB）。

- [x] **M98 · `http`/`https` 报文级差分** ✅ 2026-09-22
  - 请求/响应全流程（keep-alive、pipeline、chunked、trailer 已在 M69 部分覆盖）的端到端差分；`https` 无 TLS 加密但语义对齐。
  - 差分探针 `tools/http-wire-probe.cjs`（http 12 + https 8 个请求，观测客户端与服务器两侧）在真 Node 与 web-node 各跑一遍，**0 diff**；修了 4 个真 bug（客户端 write() 分块、HEAD 无体、客户端过早半关、`https.globalAgent` 非 keep-alive）。

---

## 阶段 C — 平台无对应物的补齐（**已解散**，2026-09-23）✅ 2/2

> 这些「真 Node 能、浏览器平台没有对应物」。原策略是**响亮抛错**（正确姿态），确有需求才做。
> **2026-09-23 解散**：M99 / M100 的实现方式由「纯 JS 重写」改为「真上游 C/C++ 编 wasm」，已分别由**阶段 H 的 M116 / M117** 完成（就地打勾）；M101 依赖的 `internalBinding('zlib')` 已随 M116 就绪，**移入阶段 H**。

- [x] **M99 · `zlib` 同步形式 + 编码参数** ✅ 2026-09-23（**经阶段 H 的 M116 完成**）
  - `gzipSync`/`deflateSync`/… 与 `level`/`windowBits`/`memLevel`/`strategy`/`dictionary`/`flush()`。
  - 实现：真 `deps/zlib`（1.3.2.1-motley）编 wasm + `builtins/zlib.ts`（`lib/zlib.js` 的 zlib 半边移植）；差分 **0 diff**（详见 M116）。
  - 工作量：大（已落地）。

- [x] **M100 · `perf_hooks` 直方图** ✅ 2026-09-23（**经阶段 H 的 M117 完成**）
  - `createHistogram`/`importHistogram`/`monitorEventLoopDelay`。
  - 实现：真 `deps/histogram`（HdrHistogram）编 wasm + vendor 真 `lib/internal/histogram.js`；差分 **0 diff**（详见 M117）。
  - 工作量：中–大（已落地）。

- [⤳] **M101 · `stream/iter` 的 `transform`** → **移入阶段 H**
  - `internal/streams/iter/transform.js`（顶层 `internalBinding('zlib')`）——zlib 绑定已随 M116 就绪，可直接 vendor。

---

## 阶段 D — 运行时常量小项收尾

- [x] **M102 · `net.BoundSocket`** ✅ 2026-09-23
  - 无 OS 句柄，但可映射到 **web-node 的虚拟 TCP 层**：构造时就占住端口（冲突同步抛 `EADDRINUSE`），`address()` 返回虚拟地址、`close()` 释放、`isPipe`/`[Symbol.dispose]` 均已实现。
  - `fd()` 返回 **-1**（Node 在无 fd 的平台上也是如此），属已知偏离并写进 DEVLOG；unix-domain/pipe 绑定无虚拟对应物，**响亮抛**。
  - 差分探针 `tools/bound-socket-probe.cjs` → fixture `test/fixtures/bound-socket.json`，门禁 `test/bound-socket.test.ts`（逐字节 0 diff）。
  - 顺带修复 `internal/errors` 的 `ExceptionWithHostPort`/`UVExceptionWithHostPort`：原先 `code = String(err)`/写死 `UNKNOWN`，现按 `uvErrmapGet(err)` 解析（与 Node 同）。

- [x] **M103 · `http.Agent` 的连接方法** ✅ 2026-09-23
  - `Agent#createConnection(...)` 转发到 `net.createConnection`（无 proxy 时的 Node 行为）；`Agent#createSocket(req, options, cb)` 按 `lib/_http_agent.js` 移植：合并 options、`calculateServerName` 算 SNI、写 `_agentKey`/`encoding`、入池 `sockets[name]`、`totalSocketCount`、安装 free/close/timeout/agentRemove 监听。
  - 同时把 `removeSocket`/`keepSocketAlive`/`reuseSocket` 从空实现改为真实移植（含 `agentKeepAliveTimeoutBuffer`）。
  - 测试：`test/http-surface.test.ts` 新增 4 例（转发、池记账、SNI/IP、keep-alive hint）。

- [x] **M104 · `url.fileURLToPath({ windows: true })`** ✅ 2026-09-23
  - 按 `getPathFromURLWin32` 纯字符串实现：盘符 `C:\a\b`、UNC `\\server\share`（IDN 经 `domainToUnicode`）、`%2f`/`%5c` 一律报错、非绝对路径报错。
  - 测试：`test/url.test.ts` 新增一例（期望值逐个取自真 Node v26.9.0）。

- [x] **M105 · `console` / `v8` inspector 面收尾** ✅ 2026-09-23
  - 差分探针 `tools/console-v8-surface-probe.cjs` → fixture `test/fixtures/console-v8-surface.json`，门禁 `test/console-v8-surface.test.ts`：`console` 额外面（`Console`/`context`/`createTask`/`profile`/`profileEnd`/`timeStamp`/`timeLog`）与整个 `v8` 成员表、`createTask().run()`、`serialize` 往返、`cachedDataVersionTag`、`isStringOneByteRepresentation`、`startupSnapshot`、`setFlagsFromString` 全部逐字节对齐。
  - 修复发现的一处真 bug：`mksnapshot` binding 的 `isBuildingSnapshotBuffer` 应为 `Uint8Array([0])`（`[0]` 是数字 `0`，非 `false`），与真 Node 一致。

---

## 已判定不做（`[-]`，附理由）

- [-] **`async_hooks` 的 promise hooks（`promiseResolve`）**
  理由：V8 的 `SetPromiseHooks` 只暴露给 embedder（C++），JS 层拦不住 `await`/async 创建的 promise；只在 `Promise.prototype.then` 上做手脚会漏一大半。**浏览器里是死路**，不做半吊子实现（详见设计文档第 9 节）。

---

## 已完成总览（M1–M87）

> 只列主题，细节见 `docs/DEVLOG.md`。**全部 ✅ 完成。**

- **运行层地基**：M1 运行层 · M2 VFS（内存树 + OPFS）
- **网络与 npm**：M3 虚拟 TCP + SW 桥 + 预览 · M3.5a keep-alive · M3.5b 浏览器真流式 · M3.5c https 壳 · M3.5d 子域名路由 · M4/M6 npm client（含 lockfile/完整性/peer/overrides/file:）
- **stream**：M8 收尾 · M10–M16 整套换真源码（state/destroy/eos/events/readable/writable/…）
- **进程与 shell**：M7 child_process + ProcessHost + mini-shell + `.bin` shim
- **vendoring 主线**（把真 Node 源搬进来）：M17 async_hooks · M19–M31（punycode/domain/diagnostics_channel/string_decoder/util.types/inspect/assert/validators/util/EventTarget/AbortController/console/os/timers/worker_threads/readline） · M33 glob · M35 perf_hooks · M36 stream/web · M37 Blob/File · M38 stream/iter · M48 Buffer · M49 vfs 子系统 · M50 fs/promises · M51/M51b/M52 fs 全家 · M53 url · M54 v8 · M55 tty · M56 vm
- **worker**：M57 Worker 协作式 · M59 标准 IO · M30 消息传递
- **错误与 binding 表**：M58 码表补齐 · M60 SystemError 文案 · M61 `internalBinding` 表面 · M62/M63 errors 全表差分
- **公开表面扫描（67 模块差分清零）**：M64 模块表面 · M65 net · M66 crypto · M67 http · M68 process · M69–M78 类原型/静态/arity 收尾
- **构建工具**：M5 esbuild WASM · M5b rollup WASM · M5c Vite build · M5d Vite dev server · M5e HMR · M5f CSS 热更 · **M18 Vue 3 SFC 跑起来**
- **性能/体积**：M32 worker 减重（1259→1028KB） · M41 Buffer slab 池化
- **语义深度（差分语料）**：M79 http · M80 net · M81 fs
- **crypto 主线**：M34 同步面 · M47 对称密码 · M83 非对称 · M84 RSA 加密 + ECDH · M85 DH · M86 对称密钥生成 + FIPS · M87 X509Certificate 真解析 · M88 素数生成/素性检验 · M89 Argon2 · M90.1 MAC（HMAC + BLAKE2b MAC） · M90.2 KMAC（Keccak/SHA-3/cSHAKE） · M90.3 CMAC/GMAC（AES） · M90.4 BLAKE2s MAC / Poly1305 / SipHash · M90.5 SHA-3/Keccak/SHAKE/keccak-kmac · M90.6 BLAKE2b-512/BLAKE2s-256 · M90.7 SM3/RIPEMD-160 · M90.8 截断变体与复合摘要 · M90.9 getHashes 全表对齐（81/81） · M92.1 DH KeyObject · M92.2 crypto.diffieHellman · M93.1 ChaCha20-Poly1305 · M93.2 DES/3DES · M93.3 AES-CCM · M93.4a Camellia · M93.4b ARIA/SM4 · M93.4c OCB/wrap · M93.4d SIV/XTS · M94 crypto.Certificate（SPKAC） · M91 ML-KEM（FIPS 203）

---

## 阶段 J — Demo 体验（项目步进器）

> **动机**：能力已齐，但 demo 入口平铺 13 个按钮、无分组/顺序/前置提示，导致「不知道怎么用、乱点必报错」。本阶段把 demo 顶部导航改造成**项目步进器**（第一行选项目 → 第二行编号操作 → 渐进门禁 → 下一步高亮）。

- [x] **M130 · Demo 顶部导航改版（四独立项目步进器）** ✅ 2026-09-29
  - **做**：把「工具类型 + 场景混一行」拆开——**第一行**只放项目切换 `⚡ Vite · 📦 Webpack · 🔷 rspack · 🟢 Node.js`，**第二行**只放操作 `⬇ Install deps → ▶ Run dev → ⚙ Run build`（Node.js 是 `▶ Run`）；**HMR / full-reload 变默认行为**，UI 不再暴露 HMR 按钮。四个项目**各自独立目录 / 独立依赖 / 独立文件**（`/project/{vite,webpack,rspack,node}`，端口 5173/5174/5175/3000）；文件树只显示当前项目；编辑器改为**可直接编辑的模板代码**（`index.html` 就是模板，JS 只做 `textContent`/`addEventListener`）。删除 esbuild / rollup / React+Tailwind / tsc / Cluster 五个旧场景。
  - **数据分模块**：`src/demo/{node,vite,webpack,rspack}-project.ts` + 聚合 `src/demo-project.ts` + UI 元数据 `src/projects.ts`。
  - **实测**（真浏览器）：Vite install 29 pkgs → `:5173` HMR（`h1` = `HOT-UPDATED vite in the browser`）；Webpack `:5174`（`v5.111.1`）build `done in 2585ms` + full-reload；rspack `:5175` `built bundle.js (2441 bytes)` + full-reload + build；Node.js `:3000` HTTP server。
  - **验收**：`typecheck` 净 · `vitest run` **1181 passed / 3 skipped** · `build` worker **774.04 kB（774109 bytes）** · `index-*.js` **13.94 kB**。
  - **设计稿**：`docs/specs/designs/2026-09-29-demo-scenario-projects-design.md`。

- [x] **M129 · Demo 情景步进器（顺序引导 + vite / webpack / rspack 场景）** ✅ 2026-09-29
  - **做**：`index.html` 三层（顶栏全局按钮 / 情景 chips / 步骤栏），`src/ui/main.ts` 新增情景-步骤引擎（`STEPS`/`SCENARIOS` + `needs` 门禁 + `syncDerived` 按观测量派生完成态 + 「Next: click …」提示）；`src/ui/style.css` 加 chip/step/next/done/blocked 样式。步骤状态：blocked / ready / **next（高亮脉冲）** / done（✓）。
  - **rspack 场景**：依赖单独按需装（`/project/rspack` 子目录，不进默认 `Install deps`）；步骤 `⬇ Install rspack deps` → `🔷 rspack build`。demo 文件随 `DEMO_FILES` 走（`package.json`/`src/index.mjs`/`build.cjs`/`webnode-binding.cjs`）。
  - **顺带修真 bug**：OPFS **restore 分支新增 `writeMissing`**——之前 restore 时不写新 demo 文件，回访用户永远看不到新增条目。
  - **实测**：真浏览器 raw CDP。页内 rspack **`compiled successfully in 182 ms`**（产物 68 字节）；`Vite dev` → `HMR JS` 使预览子帧出现 `hot-updated #N`；`▶ Run app` 起 :3000 供给正常。
  - **验收**：`typecheck` 净 · `vitest run` **1181 passed / 3 skipped** · `build` worker **784.74 kB**。
  - **设计稿**：`docs/specs/designs/2026-09-29-demo-ui-scenarios-design.md`。

- [x] **M131 · 依赖安装改流式解包（修内存爆表）** ✅ 2026-09-29
  - **做**：`npm/tarball.ts` 新增流式路径（`streamOf`/`gunzipStream`(`DecompressionStream`)/`ByteQueue`/`untarStream`/`extractTarballStream`）；`npm/install.ts` 下载阶段只缓存压缩包、解压阶段逐文件流式写入 VFS（不再缓存整包）。
  - **实测**（真浏览器冷装 Webpack，只留一个页面时采样）：install 峰值 worker 堆 **1942MB → 183MB(dev)/31MB(线上)**（~10−60×）。
  - **测试**：`test/npm.test.ts` +4（流式与缓冲版逐条等价 / 7 字节分块 / 流式 pax / 包装目录）。
  - **验收**：`typecheck` 净 · `vitest run` **1185 passed / 3 skipped** · `build` worker **776.2 kB**。
  - **遗留**：build 冷启（编译 webpack 模块图）仍有峰值（dev ~479MB / 线上 ~51MB；原生 Node 仅 36MB → 运行时编译有放大）——下次打磨。

---

## 怎么用这份文件

1. **开工前**：看「进度总览」知道还剩多少；从当前阶段往下挑第一个 `[ ]`。
2. **开工时**：把该项改成 `[~]`。
3. **完成后**：改成 `[x]`，并在 `docs/DEVLOG.md` 顶部加一条变更记录；刷新本文件「最后更新」的基线提交号与进度总览数字。
4. **新任务**：追加到对应阶段；若是新方向，开一个新阶段。
5. **条目被别的里程碑吸收时**：改标 `[⤳]` 并注明并入对象（不删、不再计数）。
6. **不做了**：移到「已判定不做」并写理由，别删（保留决策痕迹）。
