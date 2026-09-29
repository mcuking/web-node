# web-node 整体技术实现原理（对标 WebContainer / StackBlitz）

> 本文说明 **web-node 在浏览器标签页里跑真 Node.js** 的整体实现原理，并在每一节与
> **WebContainer** 做逐条对照。所有「实测」结论来自**真浏览器页内探测**（raw CDP 直连），
> 不是从官方文档推断。WebContainer 侧的一手实测见
> [`webcontainer-research.md`](./webcontainer-research.md)。

---

## 0. 一句话结论

**web-node = 真 Node.js 的用户态（`lib/`）源码 + 把 native 层编译成 Wasm + 用「第二个 worker + `SharedArrayBuffer`/`Atomics`」补出浏览器没有的同步 syscall；WebContainer 走的是同一条大路（Node 用户态 + native→WASM + SAB 同步），但在三处做了不同取舍：同步机制的具体形态、native 覆盖面的策展口径、以及「出网 / 预览」依赖 StackBlitz 的托管服务。**

| 维度 | web-node | WebContainer |
|---|---|---|
| Node 用户态 | **真源码** `core/lib/*.js`（v26.9.1-dev checkout），运行时按 CJS 语义求值 | 真 Node 用户态（同源思路） |
| native 层 | **真上游 C/C++ → wasi-sdk 34.0 → wasm32-wasip1**（zlib/brotli/zstd/histogram/OpenSSL…） | native 编 wasm（同思路），覆盖面更全（含 sqlite/wasi 等） |
| 同步 syscall | 第二 worker + `SharedArrayBuffer` + `Atomics.wait/notify` | SAB + Atomics（同思路，形态细节不同） |
| 文件系统 | 纯内存 VFS + 可选 OPFS 持久化 | 纯内存 FS |
| 出站网络 | 宿主源 worker 的 `fetch` 转发 + **可自备 proxy**，**无第三方托管依赖** | **StackBlitz 托管 proxy / 宿主源 Fetcher Worker** |
| 预览 | dev `<port>.localhost` / 通配域 `<port>.<domain>` + **每端口 DevServer ServiceWorker** | 唯一子域名 + DevServer ServiceWorker |
| 多进程 | 1 进程 = 1 worker（`fork`/`cluster`，共享端口轮询） | 1 进程 = 1 worker |
| 托管耦合 | **零**（静态资产即可自托管） | 与 StackBlitz 域名/服务深度绑定 |

---

## 1. 目标与约束

要在浏览器里「像真 Node 一样」跑程序，必须同时满足：

1. **语义是 Node 的**（`process.version`、`require`/ESM、`fs`、`Buffer`、`crypto`、`stream`…）。
2. **同步 API 真的同步**（`fs.readFileSync`、`crypto.createHash().update()`…不能变成 Promise）。
3. **native 行为是真的**（压缩、加密、hash 的字节输出与真 Node 逐字节一致）。
4. **能装包、能起服务、能出网**（`npm install`、`http.createServer().listen(3000)`、`fetch`）。
5. **安全隔离**（不可信代码不越出沙箱）。

浏览器的硬约束：**没有阻塞式 syscall、没有内核/libuv、没有裸 TCP、不能 `dlopen` native addon**。
web-node 的整套架构，就是在这些约束下逐条补齐。

---

## 2. 运行时拓扑

```
┌────────────────────────────── 主标签页（UI / 编辑器 / 终端） ─────────────────────────────┐
│  src/ui/main.ts  ·  src/client/index.ts                                                    │
│    · 负责 DOM、跑按钮、终端回显、预览 iframe                                                │
│    · 与「运行时 worker」之间用 postMessage 传「跑程序 / 装包 / 取文件」等命令                 │
└───────────────▲───────────────────────────────────────────────▲───────────────────────────┘
                │ postMessage（异步命令 / 流式输出）                │ postMessage（同步 RPC）
                ▼                                               │
┌─────────────────────────────── 运行时 worker（realm host）───────────────────────────────┐
│  src/worker/runtime.worker.ts  ·  src/node-runtime/realm.ts                                │
│    · 建出「realm」：一个 Node 内建模块注册表 + 全局（process/require/Buffer/console/timers）│
│    · 求值 vendored 的 Node 用户态源码（CJS wrapper）                                        │
│    · 装配 wasm 模块（zlib/brotli/zstd/OpenSSL…）                                            │
│    · 入站虚拟 TCP（net/network.ts）· 出站 egress（net/egress.ts）                            │
└───────┬───────────────────────────────────────────┬───────────────────────┬───────────────┘
        │ SAB + Atomics（同步 RPC）                   │ 子 worker（fork/cluster）│ 流 worker（fs/fsync）
        ▼                                           ▼                       ▼
┌───────────────────────────┐        ┌────────────────────────────┐   ┌────────────────────┐
│ fs 服务 worker（OPFS 落盘） │        │  1 进程 = 1 worker          │   │ OPFS / 流式 I/O     │
│ src/node-runtime/vfs/*      │        │  proc/host.ts + IPC         │   │                    │
└───────────────────────────┘        └────────────────────────────┘   └────────────────────┘
```

**与 WebContainer 对照**：两者都是「主页面 + 若干 worker」的拓扑，都是把 Node 的**用户态**跑在
worker 里。WebContainer 实测的 target 列表同样是 `page + worker + service_worker`，
**进程 = worker** 的建模完全一致（我们的 `fork`/`cluster` 即对标这一点）。

---

## 3. 同步 syscall 的秘诀：`SharedArrayBuffer` + `Atomics`

浏览器**没有阻塞式调用**。可 Node 里 `fs.readFileSync`、`crypto.createHash('sha256').digest()`、
`zlib.gzipSync` 这些**必须**同步返回。web-node 的解法（`src/sync/sab-rpc.ts`）：

- 需要真 I/O 的同步调用（典型是 `fsyncSync` 这类要等 OPFS 的）**转到第二个 worker**；
- 双方**共享一块 `SharedArrayBuffer`**：调用方把请求写进去 → `Atomics.notify` → **`Atomics.wait` 停住**；
- 对端取走请求、做完（可以是 `await` 的异步工作）、把结果写回同一块内存 → `Atomics.notify` 唤醒；
- 调用方醒来读到结果，**同步返回**。

> **为什么必须共享内存**：`Atomics.wait` 停住的线程**不跑事件循环**，`postMessage` 的回复事件
> 永远送不到它手里。只有共享内存 + `Atomics` 才能在「阻塞中」通信。

配套的控制块布局（int32）：`H_STATE`（idle/请求已投/响应就绪）、`H_SEQ`、`H_OP`、`H_STATUS`、
`H_REQ_LEN`、`H_RES_LEN`，payload 走随请求移交的独立 SAB；**请求严格串行**，故 payload 缓冲可复用。

> **前置条件**：`SharedArrayBuffer` 只在**跨源隔离**（`crossOriginIsolated`）下可用，因此页面必须带
> `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp`。
> web-node 由**页面自身的 ServiceWorker / dev 中间件注入 COOP/COEP**（见 §11）。

**与 WebContainer 对照**：**核心机制完全一致**——都用 `SharedArrayBuffer` + `Atomics` 把「无阻塞的
浏览器」补成「有阻塞的 syscall 表面」。差异在**落点**：web-node 主要用它承载 OPFS/流式 I/O 的
真同步；WebContainer 用它承载整套虚拟 syscall 层（含它自己的内核/文件系统抽象）。

---

## 4. 文件系统：纯内存 VFS（可选 OPFS 持久化）

`src/node-runtime/vfs/` 提供一套 Node `fs` 的语义外壳：

- `memory.ts`：**纯内存**树（默认）。进程内所有路径操作都打在这里，**与真 Node 的 `fs` 差分对齐**。
- `opfs.ts` / `opfs-worker.ts` / `opfs-store.ts`：把内存树**镜像**到 **OPFS**（Origin Private File
  System），使刷新后仍在；OPFS 只能在 worker 里 `await` 句柄，故同步路径靠 §3 的 SAB RPC 桥接。
- `persistence.ts`：快照格式 `.wvm.json`（`SNAPSHOT_VERSION = 3`），只存**结构 + 小内联文件**，
  大字节交给 OPFS 镜像。
- `posix.ts`：路径规范化（`..`、符号链接解析等）。

> 设计取舍：**索引只存结构、字节交给镜像**——快照文件因此保持小，且能对「大文件」零拷贝。

**与 WebContainer 对照**：WebContainer 是**纯内存 FS**（刷新即失）。web-node 多了一层**可选持久化**，
代价是引入 OPFS 与同步桥，但对「刷新不丢工作区」是实打实的收益。

---

## 5. 模块系统：运行时求值**真 Node 用户态源码**

关键决定：**不**把 Node 的 `lib/` 交给打包器（Rollup/Vite）转换，而是把 `core/lib/*.js`
**原文搬进浏览器**，在运行时用**真 CommonJS 语义**求值（`src/node-runtime/vendored.ts` + `loader/`）：

- `vendored.ts`：`VENDORED: Record<路径, 源码文本>`。测试/Node 下用 `?raw` 立即填充；**浏览器下**
  走**两次分包**（M107/M126）：启动 **core 层**（54 文件 / gzip ~122 KB，预加载 + `ready` 前 await）
  与 **lazy 层**（109 文件 / gzip ~234 KB，后台低优先级预取，**跑用户代码前** await）。目的：
  **不进 worker 的 JS 图、零 JS 解析开销**。
- `loader/`：CJS wrapper、`require` 解析、ESM 互操作（`esm-transform.ts`）、`code-mask.ts`。
- `realm.ts`：每个 realm 一张**内建模块注册表** + 一套**注入 globals**（`process`/`require`/`Buffer`/
  `console`/timers…）。`#materialize` 按 Node CJS wrapper 的固定形参求值源码。

> **真差异修正**：`Realm#materialize` 在**求值抛错**时 Node 会**丢弃缓存重跑**，不能让记录停在
> `loading` 静默交出半成品导出——已照 Node 改正。

**与 WebContainer 对照**：思路一致（都跑真 Node 用户态），差别在**用户态源码怎么进浏览器**：
web-node 显式做了 **core/lazy 两层 + 预加载**的载荷工程，把「启动期 awaited 的源码」压到 gzip ~122 KB。

---

## 6. native → WASM：真上游 C/C++，不是 JS 重写

Node 的很多能力（压缩、加密、hash…）在 native 里。web-node **不写 JS 赝品**，而是把**真上游
C/C++ 源码**编译成 wasm：

- 工具链：**wasi-sdk 34.0**（`~/wasi-sdk-34.0`），目标 **`wasm32-wasip1`**，**reactor 模型**
  （`-mexec-model=reactor -Wl,--no-entry` → 导出 `_initialize`，实例化后调一次）。
- 导出用 **`__attribute__((export_name("..."), used))` 精确声明**——既不用 `--export-all`（会泄
  libc 符号），也不用 `-Wl,--export-dynamic`（对非 PIE 不导任何符号）。
- 构建：`npm run build:native`（`native/build.mjs`）→ 产物落到 `src/node-runtime/wasm/artifacts/`
  （**提交进仓库**，含 `manifest.json`）。
- 登记：`wasm/index.ts` 的 `WASM_MODULES`（启动 await）与 `DEFERRED_WASM_MODULES`（后台预取）。
  接入用 `?url` + 内容哈希发 `assets/`（**不内联进 worker bundle**）。绑定表是**同步构建**的，
  故 wasm **不能懒加载**——但可以「并行预取、用时 await」（M107/M126）。

已落地的 wasm 模块：`wn_stub`、`wn_zlib`（gzip）、`wn_brotli`、`wn_zstd`、`wn_histogram`、`wn_openssl`。

**内存约定**：变长/定长结果写进模块**自己的 scratch 缓冲**，用 `*_ptr()` 把地址交给 JS（JS **从不**
把 TypedArray 指针传进 wasm）；每次读都**从 `memory.buffer` 重新取视图**（wasm 内存增长会 detach 旧视图）。

**与 WebContainer 对照**：**同一条路**（native 编 wasm）。差别在**覆盖面与口径**：WebContainer 的
native 面更全（真 nghttp2、真 wasi 等，见其调研 §11），但它有一批「类在、方法没挂」的半成品
（如 `node:sqlite` 实测不可用）；web-node 的口径是 **能用就真做，不能就响亮抛错**（见 §12）。

---

## 7. 密码学：真 OpenSSL 编成 wasm

`src/node-runtime/crypto/` 有 40+ 模块，底层是 **真 OpenSSL**（`wn_openssl.wasm`，~2.48 MB）。
`crypto.createHash/createCipher/generateKeyPair/diffieHellman/createSign/…` 的**字节输出与真 Node 逐字节一致**，
差分语料做硬证据。这是「**native 行为是真的**」最硬的证据之一。

**与 WebContainer 对照**：WebContainer 的表更全，但**异步 crypto job（线程池）不工作**（实测决定性
差异）；web-node 则明确**不支持的部分响亮抛错**，不用「静默 no-op」冒充可用。

---

## 8. 网络（入站）：虚拟 TCP —— `listen(3000)` 真的有端口

`src/node-runtime/net/network.ts`：一个**进程内 TCP 外表**（"A tiny in-process TCP lookalike"），
纯 TS 建模 Node 的 `tcp_wrap`：

- **端口表** + **双工字节管道**；核心类 `VirtualSocket`（`_pair`/`_stamp`/`onData`/`onEnd`/`onClose`/
  `localPort`/`remotePort`）。
- `http.createServer(...).listen(3000)` 在本 runtime 内**真的绑定一个端口**，虚拟网络里有记录。
- `src/node-runtime/net/socket-address.ts`：`net.Socket`/`server.address()` 的地址表面。
- **dns**：`dns.lookup` 是**回环哨兵**（实测返回 `127.0.0.1/4`）——与 WebContainer 的「假 IP」同类手法。
- 端口可被**外部**通过 `VirtualNetwork.dial()` 拨入（这是 §11 预览 SW 的挂点）。

**与 WebContainer 对照**：WebContainer **没有内核/libuv**，靠**入站虚拟 TCP + 假 DNS IP** 把
`listen` 装出来；web-node 同理。差别在**「谁来拨入」**：见 §11。

---

## 9. 网络（出站）：egress —— 经**宿主源 worker 的 `fetch`**（M122）

**改前的真差距**：web-node 只有入站虚拟 TCP + 回环 DNS，**公网 `https` / `net.connect` 直接
`ECONNREFUSED`**；只有被包了一层宿主 `fetch` 的 `fetch()` 能用（受宿主 CORS）。

**做法**（`src/node-runtime/net/egress.ts`，`Egress` 传输层）：

- `Egress.request()` 用**宿主 `fetch`** 执行出站请求——受宿主 CORS 约束（浏览器无法绕过），
  必要时由**可自备的 `proxy`** 兜底（`{url}`/`%s` 模板，或路径前缀；直连失败才回退）。
- **接入缝**：`Bindings.egress`（`bindings/context.ts`）+ `RuntimeOptions.egress`（`runtime.ts`）；
  worker 里 `createWorkerEgress()` 用**宿主源 worker 的 `fetch`** 作传输。
- **proxy 配置**：`VITE_WEB_NODE_EGRESS_PROXY` / `__WEB_NODE_EGRESS_PROXY__`——**不硬编码任何第三方**。
- **裸 TCP**：可选 `dialTcp`（WebSocket 桥，`VITE_WEB_NODE_TCP_PROXY`）——浏览器开不了裸 TCP，**默认无**。
- **`http`/`https` 的 `acquire(port, host, protocol)`**：非回环主机 → `EgressConnection`——把请求
  **序列化**交给 egress，回包经**同一 `HttpMessageReader`** 复帧（状态行/头/体一致）。因 `fetch`
  已解压/解帧，回包**丢弃 `content-encoding`/`transfer-encoding` 并补 `content-length`**（已记入偏离）。
- **`net.connect` 非回环**：无桥 → **响亮 `ECONNREFUSED`**（带 `syscall`/`address`/`port`），绝不吊死或假装。
- **回环判定** `isLoopbackHost`：`localhost`、`127.*`、`::1`、`[::1]`、`0.0.0.0`、`::`、`*.localhost`、
  空串 → 页内；其余一律出站。

**实测（真浏览器、构建产物）**：

| 调用 | 改动前 | 改动后 |
|---|---|---|
| `fetch('https://registry.npmjs.org/ms')` | 200（宿主 fetch） | **200** |
| `fetch('https://httpbin.org/get')` | 200 | **200** |
| `https.get('https://registry.npmjs.org/ms')` | ❌ `ECONNREFUSED` | ✅ **200** |
| `net.connect({host, port:443})` | ❌ `ECONNREFUSED` | `ECONNREFUSED`（**诚实**，无 TCP 桥） |
| `dns.lookup(...)` | `127.0.0.1/4` | `127.0.0.1/4` |

**与 WebContainer 对照**：WebContainer 的出网走 **`stackblitz.com` 源的专用 `Fetcher Worker`** +
**托管 proxy**（不受沙箱页 CORS；npm registry 走 server-side 加速）——**这依赖 StackBlitz 的服务**，
其 README 明确 API 依赖它的 proxy。**web-node 刻意自足**：出站只经**自家页面同源 worker** 的
`fetch`（受宿主 CORS，符合企业出口合规），要绕过 CORS 就**自备 proxy**，**零第三方托管依赖**。

---

## 10. 多进程：1 进程 = 1 worker（`fork` / `cluster`，M123）

- `proc/host.ts` + `proc/ipc.ts`：`child_process.fork` 起**真正的第二个 runtime worker**（自带注册表 /
  `process` 视图 / pid / IPC 通道）。
- `cluster`：primary 视图（`isPrimary`/`fork()`/`workers`…）；**共享端口复用虚拟 TCP**——
  `net.Server` 支持 `exclusive`（Node 的 cluster 共享监听标志），worker 视图把 `net`/`http`/`https`
  的 `Server`/`createServer` 包成默认 `exclusive:false`，监听时向 primary 回传内部帧
  （`{cmd:'NODE_CLUSTER', act:'listening'}`，**不冒泡成用户 `'message'`**）；`VirtualNetwork` 加
  `listenShared/unlistenShared` + 轮询分发。
- 差分：2-worker 的 cluster 程序**原样在真 Node v26.9.0 跑、输出逐行一致**。

**与 WebContainer 对照**：**建模一致**——真 WebContainer 每个「进程」就是独立 Web Worker，
故多进程天然可用；web-node 的 `fork`/`cluster` 正是把这层显式做出来，并把**共享端口**接回虚拟 TCP。

---

## 11. 预览：端口 → 子域名 + 每端口 DevServer ServiceWorker（M3.5d / M113）

`listen(3000)` 绑的是**页内虚拟端口**，浏览器进不去。要让这个端口「从 URL 访问」，需要
**独立 origin + ServiceWorker** 把请求接回虚拟网络。

**三策略**（`src/ui/preview-url.ts`，纯函数）：

| 环境 | 预览地址 | 壳从哪来 |
|---|---|---|
| dev server | `<port>.localhost:<devport>` | dev 中间件 `plugins/dev-subdomains.ts` |
| 静态托管 + 通配域 | `<port>.<VITE_WEB_NODE_PREVIEW_DOMAIN>` | **静态资产** `public/__webnode__/index.html` |
| 其它（Pages / `vite preview`） | `<base>preview/<port>/` | 同源路径式兜底 |

**工作流**：

1. 预览壳（子域）注册 `sw.js?domain=<domain>`，scope 为 `base`；
2. 壳把 worker 抛出的 `web-node:http` 请求**经 `window.top` 转发**给顶层 App 页（端口跨源 transfer）；
3. 顶层页把请求交给**运行时 worker** → `VirtualNetwork.dial(port)` → 真应用；
4. HMR 帧反向：App 页 → 壳 → 预览子帧。
5. 壳内再嵌一个**同源子 iframe `src=base`**，渲染真应用。

**关键工程点**：

- `public/sw.js` 的 `SUBDOMAIN_SHELL_PATH` 供壳时**必须补 COOP/COEP**——静态托管设不了响应头，
  而跨源隔离又是 `SharedArrayBuffer` 的前提；`withShellHeaders` 只在 SW 已控制该 origin 后才生效。
- `wsShim(port, subdomain)` 显式标明「是否子域」（不再靠 hostname 猜），HMR 走对通道。
- 来源校验：`client`/`main` 的 `message` 监听一律用 `previewPortFromHost(host, domain)`——**别用
  `endsWith('.localhost')`**（会漏通配域且过宽）。

**实测（真浏览器）**：dev `http://3000.localhost:5199/__webnode__/`、静态服务器
（`python3 -m http.server`）`http://3000.localhost:4180/__webnode__/`——子帧**均从虚拟 FS 供给真应用**
（title `web-node preview`、body `Hello from your in-browser Node.js server`、`appUrl=…/`），
SW target `sw.js?domain=localhost` 存在，scope 正确。

**与 WebContainer 对照**：WebContainer 把 `listen(8080)` **编进一个唯一子域名**
（`<proj>--8080--<hash>.local-credentialless.webcontainer.io`）再注册 DevServer SW 供给内存 FS；
web-node 的**机理同构**（子域 + 每端口 SW），但**壳是自带的静态资产**、通配域由**部署方**提供
（自定义域 / `localhost`），因此**不绑定任何托管商**。

---

## 12. 安全 / 隔离模型

- **执行隔离**：所有不可信代码在 **worker** 里跑（无 `window`/DOM 直通；`document` 在 Node 语境下
  本就 `undefined`，实测真应用里 `ReferenceError: document is not defined` 是**正确**行为）。
- **跨源隔离**：页面 `crossOriginIsolated`（COOP/COEP），换来 `SharedArrayBuffer`。
- **网络隔离**：入站只在**虚拟 TCP** 内；出站只经**同源 worker 的 `fetch`**（受宿主 CORS），
  要过 CORS 需**显式自备 proxy**——默认**不开**。
- **诚实的边界**：**不能做的响亮抛错**，不静默伪造。
  - 页面开不了裸 TCP → `net.connect` 非回环且无桥 = **`ECONNREFUSED`**。
  - 加载不了 native addon（`.node`）→ 抛 `ERR_DLOPEN_DISABLED` 类错误。
  - V8 堆快照/profiler 等页内**本质不可达**的 API → 抛 `ERR_WEB_NODE_NOT_IMPLEMENTED`（`notImplemented(api, …)`），
    **绝不编造数字或静默返回 0**。

**与 WebContainer 对照**：WebContainer 用 **`local-credentialless` 域 + 独立 origin** 做隔离；
它的一些 API 是「类在、方法没挂」的半成品（`node:sqlite` 实测不可用）——**它不总是响亮报错**。
web-node 的取态相反：**表面尽量齐，但假的就假得响亮**（`unsupported.ts` 登记 + 差分门禁兵护）。

---

## 13. 质量门禁（怎么保证「真」）

- **真 Node 差分**：以 **fnm Node v26.9.0** 为 oracle（与 vendored 源 v26.9.1-dev 同代），
  逐 API 跑最小基准 → web-node 同调用比对 → **0 diff** 才收。涉及**浮点递推/超越函数**时（FMA vs 无 FMA、
  arm64 vs wasm），把**统计量按有效位数归一**再比，只对与浮点无关的段做逐字节比对（不为「0 diff」造数据）。
- **行为门禁**：`tools/behavior-smoke-probe.cjs` 观测 **187** 项（值/错误形状/async 往返），非只 `typeof`。
- **结构门禁**：`test/errors-table.test.ts`（码表）、`test/bindings-surface.test.ts`（`internalBinding` 表面）、
  `test/vendored-tiers.test.ts`（core/lazy 分层）、`test/wasm-tiers.test.ts`（wasm 分层）…
- **验收门槛**：`tsc --noEmit` 净 · `vitest run` 全绿 · `npm run build` 记录体积 · gh-pages 线上 200。

**与 WebContainer 对照**：WebContainer 的取舍是**广度优先**（表齐、但部分半成品）；web-node 是
**深度 + 诚实优先**（真差分 0 diff、假的响亮抛错），并用**永久门禁**把「真」钉死。

---

## 14. 已知偏离（诚实清单）

| 处 | 偏离 | 原因 |
|---|---|---|
| `https`/`http` 出站回包 | 丢 `content-encoding`/`transfer-encoding`，改补 `content-length` | 走宿主 `fetch`，已解压/解帧 |
| `net.connect` 非回环 | 无 TCP 桥时 `ECONNREFUSED` | 浏览器不能开裸 TCP |
| native addon | 不可加载 | 不能 `dlopen` 页内 wasm 之外的 `.node` |
| V8 堆快照/profiler | 抛 `ERR_WEB_NODE_NOT_IMPLEMENTED` | 页内本质不可达，不伪造 |
| `vm` 第二 realm | 单 realm 内**就地标记**沙箱对象等价复刻 | 页面造不出第二个 V8 realm |
| 浮点递推/超越函数 | 与 arm64 可能差 **1 ULP** | 宿主 FMA vs wasm 无 FMA / libm 不同 |

---

## 15. 附：代码地图

| 关注点 | 入口 |
|---|---|
| 运行时装配 / realm | `src/node-runtime/runtime.ts` · `realm.ts` · `worker/runtime.worker.ts` |
| Node 用户态源码 | `src/node-runtime/vendored.ts` · `vendored-sources.ts` · `loader/` |
| native → WASM | `native/build.mjs` · `src/node-runtime/wasm/` |
| 同步 RPC | `src/sync/sab-rpc.ts` · `src/sync/fs-protocol.ts` |
| 文件系统 | `src/node-runtime/vfs/` |
| 入站网络 | `src/node-runtime/net/network.ts` · `socket-address.ts` |
| 出站网络（M122） | `src/node-runtime/net/egress.ts` |
| 多进程 | `src/node-runtime/proc/` · `builtins/cluster.ts` |
| 预览（M113） | `src/ui/preview-url.ts` · `public/sw.js` · `public/__webnode__/index.html` · `plugins/dev-subdomains.ts` |
| 绑定表 | `src/node-runtime/bindings/` · `builtins/` |
| 门禁 | `test/` · `tools/behavior-smoke-probe.cjs` |

---

## 附：WebContainer 一手实测来源

- 本仓 [`webcontainer-research.md`](./webcontainer-research.md)（含 2026-09-24 的**活体探针实测**：
  运行时拓扑、native addon、网络入/出站、TLS、crypto 线程池、`http2`/`sqlite`/`wasi`/`sea` 逐项）。
- 官方 README 明确其 API 依赖 **StackBlitz 托管 proxy**——这正是 web-node 刻意**自足**的原因。
