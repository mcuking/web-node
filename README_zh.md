# web-node

在浏览器里跑 Node.js 源码（WebContainer 式运行时）。

[![在线 demo](https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%20demo-mcuking.github.io%2Fweb--node-5ef1a5)](https://mcuking.github.io/web-node/)

[English](README.md) · **简体中文**

- **在线 demo**：<https://mcuking.github.io/web-node/> —— 选一个项目（**Vite** / **Webpack** / **Rspack** / **Node.js** / **uni-app**），点 **⬇ Install deps** → **▶ Run dev** 和/或 **⚙ Run build**，全在标签页里
- **开发日志 / 进度 / 下一步**：[`docs/DEVLOG.md`](docs/DEVLOG.md) ← **每次改动都往这里追加**
- 设计文档：[`docs/superpowers/specs/2026-09-17-web-node-design.md`](docs/superpowers/specs/2026-09-17-web-node-design.md)、[`docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`](docs/superpowers/specs/2026-09-23-native-to-wasm-design.md)
- 上游源码：本地 Node.js checkout（v26.9.1-dev，`v26.9.0-1-g7a3437d`），经 `tools/` vendor

## 工作原理

WebContainer **不是**把 Node.js 编成 WASM。真正的诀窍是让用户代码跑在**浏览器自己的 JS 引擎**上（不搬 V8），只把 native / syscall 层换成虚拟实现。`internalBinding()` 是唯一的接缝，它上面坐着若干虚拟子系统：

```
┌──────────────────────────────── browser page ────────────────────────────────┐
│                                                                              │
│  UI (项目步进器 / 文件树 / 编辑器 / 终端 / 预览)                                │
│        │                                                                     │
│        ▼                                                                     │
│  RuntimeClient (主线程)       ◄── ServiceWorker 桥 (/preview/<port>/…)        │
│        │                                                                     │
│        ▼  postMessage                                                        │
│  Runtime Worker                                                              │
│    Realm ── internalBinding() 分发 ──────┬─→ bindings/  (TS shim)            │
│                                          ├─→ builtins/  (node:* 模块)        │
│                                          ├─→ VFS        (内存树 + OPFS)      │
│                                          └─→ VirtualNetwork (虚拟 TCP)       │
└──────────────────────────────────────────────────────────────────────────────┘
```

- **Realm** —— 唯一的引擎替换点：一张 binding 分发表 + 内部 binding 白名单。
- **Loader** —— CommonJS resolver + ESM→CJS 转换；能复用就复用 vendored 真源码，其余用 TS shim。
- **VFS** —— 以内存 inode 树为准，写回（防抖）持久化到 OPFS。
- **虚拟网络（入站）** —— 纯 TS 的端口表与双工字节管道，经 ServiceWorker 暴露给页面，于是 `http.createServer().listen(3000)` 在真实浏览器 URL 上可达。
- **出站网络（egress）** —— 一个基于 `fetch` 的 `Egress`：非回环的 `http(s)` 请求会被序列化、用宿主 `fetch` 执行（直连被拦时可走可选 proxy），再经**同一个 HTTP 解析器**重新组帧，于是 `https.get('https://…')` 可用。非回环的 `net.connect` 在没有 TCP 桥时**诚实抛 `ECONNREFUSED`**，绝不吊死或假装（M122）。
- **Streams** —— `Readable` / `Writable` / `Duplex` / `Transform` / `PassThrough`，带真背压，接进 `fs` 与 `http`。
- **npm client** —— 向 registry 解析 `package.json` 版本范围，下载并解包 tarball（gzip + tar）写入虚拟 `node_modules`（npm 式 hoisting），于是 `require('pkg')` 无需服务器即可用。安装会写 `package-lock.json`（lockfileVersion 3），二次安装直接复用已锁版本不再解析；每个 tarball 在写入前先校 registry 的 sha512/sha1；缺失的 peer 装到根；跳过为其他平台构建的 optional 依赖；根 `overrides`（或 yarn `resolutions`）可钉传递依赖版本，`file:`/`link:` 直接从虚拟文件系统装包，tarball 有界并发下载；也可以**往已有工程按需加包**——UI 里跑 `npm install <spec>`（M142）。
- **构建工具** —— esbuild（官方 WASM 构建，就是 Vite 内部用的那个转换器）跑在标签页里：编译 TypeScript、打包真实 `node_modules` 依赖、写 `/project/dist/app.js`。
- **真 bundler** —— rollup（官方 WASM 构建）从虚拟文件系统直接读 ES 模块图做 tree-shaking；**webpack 5** 与 **rspack 2.2.7** 在页内跑真生产构建（见《构建工具》）。
- **Vite 本体** —— 真正的 Vite（v5）跑在标签页里。Vite 是纯 ESM、且 `import` 原生 esbuild addon，运行时把 `esbuild`→`esbuild-wasm`、`rollup`→`@rollup/wasm-node` 别名，于是 Vite 在虚拟文件系统上启动并产出真生产包。
- **Vite dev server** —— `createServer()` + `listen()` 也在页内启动，绑一个虚拟端口、按需转换模块。**HMR** 走 `BroadcastChannel`（ServiceWorker 无法代理 WebSocket），所以编辑**原地热更**。
- **进程与 cluster** —— `fork()` 把模块作为第二个模块注册表启动并接 IPC 通道；`cluster` 每个子进程一个 runtime worker，在虚拟网络上轮询分发一个共享端口（M123）。
- **原生层 → WASM** —— 标签页没有 native addon、也没有 `dlopen`，所以凡是真实现坐在 C/C++ 库上的核心模块，就**把那上游库编成 WASM**（见下），而不是自己重写。这些模块是真实现、不是桩：`zlib`（+ brotli/zstd）、`perf_hooks` 直方图、以及整个 `crypto` 表面（OpenSSL）。

## 原生层 → WASM（阶段 H）

标签页里没有 native addon、也没有 `dlopen`，而此前的手写 JS 替身在压缩 / 加密这类场景里终究会撞到正确性天花板。所以 native 层的规则改成了：**用 `wasi-sdk` 把真上游 C/C++ 编成 WASM**，而不是自己重写。产物提交在 `src/node-runtime/wasm/artifacts/`，在 `src/node-runtime/wasm/index.ts` 里登记（用 `?url` 导入，Vite 会按内容哈希发到 `assets/`）。加载分三层，见 M107：小 codec（`wn_stub`、`wn_zlib`）在**建 Realm 之前**启动期 await（绑定表是同步构建的，任何 binding 建表时要用的东西必须先就绪）；较重的 codec（`wn_histogram`、`wn_brotli`、`wn_zstd`）启动后在后台取回，但在**跑用户代码前** await 完；最重的 ~2.4 MB OpenSSL 子集**懒加载**（`wasm/lazy.ts`，由 `opensslReady()` 把关），缺席时退回 JS 实现。

`native/build.mjs` 驱动构建（`npm run build:native`）：每个模块声明自己的源文件，工具链目标 **`wasm32-wasip1`**、**reactor 模型**（`-mexec-model=reactor -Wl,--no-entry`，实例化后调一次 `_initialize`），导出严格用 `__attribute__((export_name(…), used))` 声明——**不用 `--export-all`**（会泄 libc 符号）。一个最小 WASI 宿主（`src/node-runtime/wasm/wasi.ts`）接住 `wasi_snapshot_preview1` 导入（时钟 → `performance.now()`、随机 → `crypto.getRandomValues`、默认写 fd 丢弃）。

| 模块 | 上游 | 服务对象 | 体积 | 里程碑 |
| --- | --- | --- | --- | --- |
| `wn_stub` | 手写 C 桩（冒烟） | 工具链→binding 接缝 | 46.5 KB | M115 |
| `wn_zlib` | `deps/zlib` 1.3.2.1-motley（11 个 `.c`） | `zlib` binding | 108.8 KB | M116 |
| `wn_histogram` | `deps/histogram`（hdr_histogram）+ 逐行移植 `src/histogram.cc` | `performance` binding | 257.7 KB | M117 |
| `wn_brotli` | `deps/brotli` 1.2.0（36 个 `.c`） | `zlib` binding（brotli 半边） | 847.4 KB | M118 |
| `wn_zstd` | `deps/zstd` 1.5.7（27 个 `.c`，不开多线程） | `zlib` binding（zstd 半边） | 484.0 KB | M118 |
| `wn_openssl` | `deps/openssl` 3.5.8 子集（自包含 WASI target） | `crypto` 模块（TS 层直驱，非 binding） | 2483.2 KB | M119 |

> 这一阶段的设计文档在 [`docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`](docs/superpowers/specs/2026-09-23-native-to-wasm-design.md)。

## 开发

> ⚠️ 用 fnm 的独立 Node（**v26.9.0**，与上游 vendored 源码同版本；v22.19.0 也保留），
> 不要用宿主机内置的 Electron Node（Electron Node 会让 rollup 原生模块 dlopen 代码签名失败）。

```bash
export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v26.9.0/installation/bin:$PATH"

npm install
npm run dev        # http://localhost:5173
npm test           # 单元 + 集成测试
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建
npm run build:native  # 重新构建 WASM 产物（需 wasi-sdk）
npm run vendor     # 重新从 Node 源码 vendor 文件
```

### 部署（GitHub Pages）

Pages 的 project site 跑在子路径下，所以构建要带 base path；脚本会把 `dist/` 发布到
`gh-pages` 分支（无需 Actions）：

```bash
npm run deploy     # = BASE_PATH=/web-node/ tools/deploy-pages.sh
```

上线地址：<https://mcuking.github.io/web-node/>。

## Demo

Demo 就是一个小型 IDE。顶栏在**五个自包含项目**间切换，第二栏跑当前项目的步骤：

| 项目 | 技术栈 | 步骤 | 端口 |
| --- | --- | --- | --- |
| **Vite** | Vue 3 SFC，真 Vite v5 | **▶ Run dev**（HMR） · **⚙ Run build** | 5173 |
| **Webpack** | React，真 webpack 5 + JSX loader | **▶ Run dev**（watch + full-reload） · **⚙ Run build** | 5174 |
| **Rspack** | React，真 rspack 2.2.7 + swc loader | **▶ Run dev** · **⚙ Run build** | 5175 |
| **uni-app** | 跨端应用，真 uni-app CLI → H5 | **⚙ Build H5** | 5176 |
| **Node.js** | 纯 `node index.js`（HTTP server） | **▶ Run** | 3000 |

每个项目装各自的 `node_modules`、全在标签页里跑、输出进终端 / 预览。**+ New project** 可用任意模板
在独立端口上脚手架出一个新项目（M134）；文件树可编辑——内联增删改名文件与文件夹（M135–M136）。
切项目会清空终端与预览、并释放上一个项目的文件体（字节仍留在磁盘上）（M133）。

## 结构

```
src/
  node-runtime/   运行时核心：realm(binding 分发) / loader / runtime
    bindings/     TS 实现的 internalBinding
    builtins/     node:* 模块实现（真源码 + TS 实现）
    crypto/       加密引擎，TS 直驱 `wn_openssl` WASM 构建
    loader/       CJS resolver + ESM→CJS 转换
    net/          虚拟 TCP（入站）+ egress（出站）
    npm/          npm client（semver / registry / tarball / installer）
    proc/         fork / cluster 的子进程宿主
    vfs/          虚拟文件系统（内存树 + OPFS 持久化）
    wasm/         WASM 产物 + 注册表 + 最小 WASI 宿主
  sync/           SharedArrayBuffer + Atomics 同步 RPC
  worker/         Dedicated Worker 入口（runtime + 文件系统）
  client/         主线程 Runtime Client API（含 ServiceWorker 桥）
  ui/             Demo UI（项目步进器 / 文件树 / 编辑器 / 终端 / 预览）
  demo/           五个 demo 项目（node / vite / webpack / rspack / uni）
native/           C/C++ 源码 + build.mjs（wasi-sdk → src/node-runtime/wasm/artifacts）
examples/rspack/  自定义 rspack binding 入口（用真浏览器 Worker 承载 emnapi 线程）
public/sw.js      ServiceWorker：/preview/<port>/ → 虚拟网络，+ COOP/COEP
public/wasi-thread-child.js  rspack WASM binding 用的预打包 thread-child
vendor/node-lib/  从 Node.js 源码复制的真实文件（含来源记录 MANIFEST.json）
tools/            依赖扫描 / vendoring / 构建工具
docs/             设计文档 + 开发日志
test/             Vitest 单测 / 集成测试
```

## 网络（M3）

`http.createServer().listen(3000)` 后，在 UI 的 **Preview** tab 或 `/preview/3000/` 访问：

```
浏览器 URL → ServiceWorker → 主线程 → runtime worker → VirtualNetwork → 你的 handler
```

已知 MVP 限制：**dev server** 上每个预览有自己的源 `<port>.localhost`，所以绝对路径、cookie、
storage 都像真主机一样（一个小中间件供一个引导壳，把子域名的请求中继回主 origin——唯一的
runtime/VFS/OPFS 都在那里）。静态宿主没有 `*.localhost` 通配，所以构建、`vite preview` 与
GitHub Pages 退回 `/preview/<port>/` 路径前缀（HTML 响应会注入 `<base>` 修正相对路径），除非
配置了通配预览域（M113）。

连接默认 keep-alive（HTTP/1.1），服务端支持 pipelining，客户端按端口做连接池。响应全程**真流式**：
ServiceWorker 直接把 `ReadableStream` 交给浏览器，所以 `res.write()` / SSE / 大文件边产生边到达，
而不是一次性 blob（HTML 例外，为注入 `<base>` 先缓冲）。`https` 是 `http` 表面的 TLS 同名壳——
虚拟网络没有 TLS。

### 出站网络（egress）（M122）

只有**回环**是虚拟的，其余都经宿主出去。非回环的 `http`/`https` 请求会变成一个 `EgressConnection`，
用宿主 `fetch` 执行（`src/node-runtime/net/egress.ts`）；回包经**同一个 HTTP reader** 重新组帧，
所以状态行、头、体都与入站响应一致。`fetch` 已经解压 / 解帧，因此 `content-encoding`/`transfer-encoding`
被丢弃并补一个 `content-length`。直连被拦（CORS）时可由
`VITE_WEB_NODE_EGRESS_PROXY` / `__WEB_NODE_EGRESS_PROXY__` 配置的 proxy 兜底——**不硬编码任何第三方**。
裸的（非回环）`net.connect` 默认没有桥，会**诚实抛 `ECONNREFUSED`**（可选的
`VITE_WEB_NODE_TCP_PROXY` WebSocket 桥可提供一个）。错误带 `code='ERR_WEB_NODE_EGRESS'` 与目标地址。

## 流

`req` 是 `Readable`、`res` 是 `Writable`，所以常见写法都能直接用：

```js
const fs = require('fs');
const { Transform, pipeline } = require('stream');

// 1) 文件直接流给响应（无 Content-Length → chunked 分帧）
http.createServer((req, res) => fs.createReadStream('/project/a.txt').pipe(res));

// 2) 请求体直接落盘
http.createServer((req, res) => {
  const out = fs.createWriteStream('/project/upload.txt');
  req.pipe(out);
  out.on('finish', () => res.end('saved ' + out.bytesWritten));
});

// 3) 三段链（带真背压）
pipeline(fs.createReadStream('/project/a.txt'), new Transform({
  transform: (c, e, cb) => cb(null, c.toString().toUpperCase()),
}), fs.createWriteStream('/project/a-upper.txt'));
```

`Readable` / `Writable` / `Duplex` / `Transform` / `PassThrough`、`pipe()`、`pipeline()`、
`finished()`、`stream/promises`、`fs.createReadStream` / `fs.createWriteStream` 均已实现，
高水位之上的 `write()`/`push()` 返回 `false` 并在排空后发 `'drain'`（背压真实生效）。

**整个 `stream` 模块就是 Node 真源码**（`lib/stream.js` + `internal/streams/*`）：
`Readable` / `Writable` / `Duplex` / `Transform` / `PassThrough` / `pipeline` /
`finished` / `compose` / `duplexPair` / 异步操作符（`map`/`filter`/`toArray`）/
`stream/promises` —— 不再有手写 stream。流的核心内部（`internal/streams/`
`state.js`、`from.js`、`utils.js`、`destroy.js`、`end-of-stream.js`、
`add-abort-signal.js`）也都是真源码，`events` 同样是真 `events.js`：
真 `EventEmitter` 形状（`_events` / `prependListener` / `errorMonitor` /
`captureRejections`）、默认高水位、`Readable.from`、谓词、`destroy()` / `_undestroy()`、
`finished()` / `eos()`、`addAbortSignal()`。因此
`destroy(err)` 会在下一 tick 依次发 `error`、`close`；`finished()` 就是真的 end-of-stream：
吃 options（`readable`/`writable` 覆盖、`AbortSignal` → `AbortError`），“writable 未完成就
close”会报 `ERR_STREAM_PREMATURE_CLOSE`。

`url` 同样是 Node 真 `lib/url.js`——legacy `Url`/`parse`/`format`/`resolve`/`resolveObject`
与 WHATWG 重导出（`URL`/`URLSearchParams`/`URLPattern`）都在。WHATWG 那半边住在
`internal/url`，本运行时把它桥到标签页自带的规范 URL 解析器（Node 那半是 native Ada）；
`pathToFileURL`/`fileURLToPath` 按 Node 自己的算法重写（`src/node_url.cc` 的编码表 + POSIX 路径规则）。

`v8` 也是真的 `lib/v8.js`：`v8.serialize`/`v8.deserialize` 说的是 V8 自己的结构化克隆线格式
（版本 15）——在 `serdes` binding 里逐标签重写（页面 JS 拿不到 `ValueSerializer`）。普通对象、
数组、Map/Set、Date、RegExp、Error、BigInt、ArrayBuffer 与 TypedArray 产出的字节与真 Node
一致；堆快照与 profiler 那半边在标签页里没有对应物，一律抛错而不编造数字。

`tty` 也是真的 `lib/tty.js`。标签页里没有文件描述符，所以 `isatty` 返回 `false`、
`ReadStream`/`WriteStream` 构造即抛——但颜色深度逻辑（`lib/internal/tty.js`）是真的，
正因如此 `FORCE_COLOR` 才能让 `util.styleText` 真的输出 ANSI。

`vm` 也是真的 `lib/vm.js`。页面造不出第二个 V8 realm，所以由 `contextify` binding 顶上：
上下文**就是**那个沙箱对象（标上 Node 的 contextify 符号），脚本跑在 `with (context) { … }`
里、`this` 绑到它。`createContext`/`isContext`/`Script`/`compileFunction` 与 `runIn*Context`
都是真的，沙箱读写与 Node 一致，新上下文只有标准内建（加 `console`），`process`/`require`/
`Buffer`/`setTimeout` 保持 `undefined`。

`Worker` 则是本运行时自己的实现。标签页起不了线程，所以一个 worker 就是同一事件循环上的
第二个模块注册表，拥有自己的 `process`/`worker_threads` 视图与与父侧的**真** `MessageChannel`。
`workerData`、消息往返、`online`/`message`/`error`/`exit` 生命周期、`terminate()` 与构造校验
与 Node 一致；`worker.stdin`/`stdout`/`stderr` 也是真的——经第二条 `MessageChannel` 传输的流，
且 worker 的 `console` 绑到它自己的 stdout/stderr。缺的是并行能力（文档里写明），而需要原生
isolate 的东西（`eval`、`resourceLimits`、剖析、嵌套 worker）一律抛错。

## npm

文件面板的 **⬇ Install deps** 会读项目 `package.json`，向 npm registry 解析依赖版本，
下载 tarball 后 gunzip + untar 写入虚拟 `node_modules`（顶层 hoisting，仅在版本冲突时嵌套），
之后普通 `require` 就能拿到：

```js
const ms = require('ms');
ms(60000); // '1m'
```

- **lockfile** —— 安装写入 `package-lock.json`（lockfileVersion 3）；二次安装直接复用已锁版本，不再解析。
- **完整性校验** —— 每个 tarball 在写入 VFS **之前**用 WebCrypto 校 registry 的 sha512/sha1。
- **peer / 平台** —— 缺失的 peer 自动装到根 `node_modules`（npm 7+ 行为）；为其他平台
  （`linux`/`wasm32`）构建的 optional 依赖静默跳过。
- **`overrides`/`resolutions`** —— 根 `package.json` 的 `overrides`（或 Yarn 的 `resolutions`）
  能钉住一个传递依赖的版本，不用改那个声明依赖的包。
- **`file:`/`link:`** —— 直接从虚拟文件系统装包：`file:` 指向目录（读其 `package.json`，递归拷贝，
  跳过 `node_modules`）或本地 `.tgz`（解包）；`link:` 因 VFS 无符号链接而物化为拷贝。
- **有界并发** —— tarball 下载最多 `concurrency`（默认 8）个同时在飞，且**先全部下载校验再写树**。
- **按需加包** —— **Add dependency** 按钮对已有工程跑 `npm install <spec>`（M142）：解析 spec
  （`name`、`name@range`、`name@tag`、scoped `@scope/pkg`）、合入解析，并把解析出的版本写回
  `package.json` 与 `package-lock.json`（裸名 / tag / 精确版本写 `^<resolved>`，显式范围原样保留；
  `save: false` 只装不写）。

未支持：`git+`/`git:` 说明符；`link:` 是拷贝而非符号链接，所以对源包的修改不会反映到消费方。
（生命周期脚本与 `.bin` shim 已可用：它们跑在运行时自带的 `child_process` 表面之上，见里程碑 7。）

## 进程、cluster 与 IPC（M7 / M40 / M123）

`spawn`/`exec`/`execFile` 在受控子进程（虚拟文件系统 + 虚拟网络 + mini-shell）里把程序跑完。
`fork()` 再进一步：它像 `node <module>` 一样启动模块，**并在父子之间接一条通道**，所以普通的父子协议直接可用：

```js
const { fork } = require('child_process');
const child = fork('/project/worker.js');
child.on('message', (m) => console.log('child said', m));
child.send({ job: 21 });
```

```js
// /project/worker.js
process.on('message', (m) => process.send({ doubled: m.job * 2 }));
```

有意做对的几处细节：

- **默认 JSON 序列化**（与 Node 一致）：Buffer 到对端变成 `{ type: 'Buffer', data: [...] }`、`Date` 变 ISO 串、
  `undefined` 属性消失、循环结构从 `send()` 同步抛；`serialization: 'advanced'` 换成结构化克隆。
- **开着的通道会把子进程留在事件循环里**：模块最后一行执行完也不退，等消息；`process.channel.unref()`
  或 `disconnect()` 才放行。监听器还没挂上就到的那批消息会**缓存**，不会丢。
- 子进程死掉时父侧事件序是 `disconnect` → `exit` → `close`，`child.connected`/`child.channel` 跟着通道状态走。

**`cluster`（M123）** —— 每个 fork 本就已是独立 runtime worker（自己的注册表、`process` 视图、
pid 与 IPC），所以 `cluster` 也是真的：primary 视图与 Node 对齐（`isPrimary`/`isWorker`、`fork()`、
`workers`、`setupPrimary`、`Worker` 类，以及 `fork`/`online`/`listening`/`exit`/`message` 事件），
worker 侧有 `cluster.isWorker=true` 视图，**共享端口**在虚拟网络上轮询分发（`net.Server` 支持
`exclusive`；worker 的 `net`/`http`/`https` server 默认 `exclusive: false`）。内部帧走
`{cmd:'NODE_CLUSTER'}` 封包，**不冒泡成用户 `'message'`**。一个双 worker 程序产出的输出与真
Node v26.9.0 **逐行一致**。

未支持：**send handle**（`net.Socket`/server）显式拒绝而不是静默丢弃（这里没有 OS 句柄可传）；
`'advanced'` 能保 `Map`/`Set`/`Date`，但不保 `Buffer` 子类（V8 serializer 会保，`structuredClone` 不会）；
`cwd` 不隔离：父子共享同一个虚拟文件系统。

## 构建工具（M5）

运行时自带模块级 **`require.resolve()`**，并认 `package.json` 的 **`browser` 字段**（字符串形式；
object 形式是 bundler 替代表，真 Node——以及提供了 `fs`/`os`/`path` 的本运行时——都会忽略）。
在此之上，真构建工具跑在标签页里。

### 用 esbuild 打包（M5）

在标签页里跑 **esbuild 的官方 WASM 构建**（就是 Vite 内部用的那个转换器）：它会
`require('esbuild-wasm')`、用 VFS 里的 `esbuild.wasm` 初始化、再用一个 VFS 插件打包
TypeScript + 真实 `node_modules` 依赖，写回 `/project/dist/app.js`：

```
tool        : esbuild-wasm v0.28.2 (13.3 MB wasm)
wasm        : compiled + service started in 37ms
bundle      : 5138 bytes in 116ms
written     : /project/dist/app.js
```

### 用 rollup 打包（M5b）

**rollup 的官方 WASM 构建**直接从虚拟文件系统读项目 ES 模块（**无需插件** —— 我们的 `fs` 就是 VFS），
做 tree-shaking 后写回 `/project/dist/app.esm.js`：

```
tool        : rollup v4.63.3 (official WASM build)
bundle      : 339 bytes in 13ms
tree-shaken : yes (dead export dropped)
written     : /project/dist/app.esm.js
```

### 用 Vite 构建（M5c）

**真正的 Vite（v5）**在页内打包一个 Vue 3 项目。Vite 是纯 ESM，且 `import` 原生 esbuild addon，
所以运行时把 `esbuild`→`esbuild-wasm`、`rollup`→`@rollup/wasm-node` 别名；WASM 版 esbuild
显式初始化后，`vite.build()` 整个跑在虚拟文件系统上：

```
tool        : vite v5.4.21 (running in the tab)
esbuild     : wasm started in 33ms
built in    : 148ms
written     : /project/site/dist/
  assets/index-DTtKUl1f.js
  index.html
```

为支撑它，ESM→CJS 转换器重写成了对顶层语句的扫描器（多行 import、模板字面量、正则vs除号、
动态 `import()`），并补齐了 `PathLike` 参数、`createRequire(...).resolve`、Node 的 `events`
模块身份、以及 `crypto`。注意 Vite 8 已改用 rolldown（Rust 原生二进制），浏览器里跑要钉 **Vite 5.x**。

### 跑 Vite dev server（M5d–M5e）

真正的 Vite dev server 在标签页里启动，`createServer()` 绑一个虚拟端口（5173）并**按需转换**模块，
和 Node 里一样。打开 **Preview** tab（`:5173`）页面就能渲染，全部来自虚拟文件系统。

```
tool        : vite v5.4.21 dev server (in the tab)
esbuild     : wasm started in 38ms
listening   : http://127.0.0.1:5173
```

为此补了两样东西：loopback-only 的 **`dns`** builtin（Vite 的 `buildStart` 会解析 `localhost`）、
以及真 EventEmitter 的 `process.stdin`（`close()` 会卸载 SIGTERM 监听）。预览桥还学会了把浏览器的
**绝对路径**资源（`/@vite/client`、链式 import）回路由到正确虚拟端口——靠记住 `clientId → port`。

**HMR 可用，走非 WebSocket 通道。** HMR 是本 WebSocket，而 ServiceWorker 无法代理 upgrade，
但预览 iframe 与 runtime 同源，于是 ServiceWorker 注入一段 `WebSocket` 垫片，把命中 `vite-hmr`
子协议的 socket 改道到 `BroadcastChannel`。通道按虚拟端口取名（`web-node-hmr:<port>`）；runtime
交给 Vite 一个 HMR 服务器对象，其 `send()` 走该通道而非 socket。另有一个小 Vite 插件把 VFS 变更
事件转成 Vite watcher 事件。编辑源文件后再点 **▶ Run dev**，预览**原地更新**，不整页刷新。

### 用 webpack 构建（M109–M110）

真正的 **webpack 5** 在页内跑。**生产构建**经完整 loader / plugin 生态编译项目——`ts-loader`、
`babel-loader`（`preset-env`，`targets: ie11`）、`css-loader`、`mini-css-extract-plugin`、
`html-webpack-plugin`——`hasErrors=false`，产出 `bundle.js`、`index.html`、`styles.css`：

```
Webpack 5.111.1 compiled successfully in 14.3s  (mode=production)
assets : bundle.js + index.html + styles.css
babel  : optional chaining / classes compiled away (ie11 target)
css    : extracted by MiniCssExtractPlugin
```

`webpack-dev-server` 要 express + ws + chokidar，标签页里都没有，所以 demo 自带一个**手写 dev-server**：
虚拟 `http.createServer().listen(5174)` 托管 `/` 与 `/bundle.js`，每次重编译以 `{type:'full-reload'}`
经**与 Vite 同一条 `BroadcastChannel` 桥**推给预览。因为 webpack 的 `watchpack` 最终落到 `fs.watch`，
而我们的 `fs_event_wrap.FSEvent` 是 VFS 投影，所以保存文件会**原生**触发重编译，无需轮询。

### 用 rspack 构建（M125）

真正的 **rspack 2.2.7** 在标签页里跑生产构建——**含 terser 压缩**：

```
Rspack 2.2.7 compiled successfully in 47.76 s   (minimize:true)
OUT_BYTES=51  OUT_HEAD=(()=>{"use strict";console.log("hello rspack")})();
```

这是几种 bundler 里最难的，因为 rspack 的 Rust 内核在**初始化期就要真 OS 线程**
（wasm32-wasi `wasi_threads` → `@emnapi/wasi-threads`），而同 realm 协作式的 `worker_threads`
提供不了。修法是**自定义 binding 入口**（`examples/rspack/webnode-binding.cjs`，drop-in
`rspack.wasi.cjs`）：用 `@napi-rs/wasm-runtime` 配一个自定义 `onCreateWorker`，返回**真·浏览器
`Worker`**，加载预打包的 self-contained thread-child（`public/wasi-thread-child.js`，519 KB /
gzip 141 KB）。子线程不需要 VFS——emnapi 的 `createFsProxy` 把 `fs` 操作经 message port 回环父侧
（父侧即 VFS）。前提有两个：真的 **`node:wasi`** 宿主（46 个 `wasi_snapshot_preview1` syscall、
落在 VFS 上），以及**跨域隔离**页面（`SharedArrayBuffer` + COOP/COEP，由 `public/sw.js` 注入，
即使在设不了响应头的静态宿主上也行，M134）。

### 用 uni-app 构建 H5 站点（M143）

真的 **uni-app CLI** 在标签页里跑跨端项目的 **H5 目标**，产出静态站点到 `dist/build/h5/`：

```
DONE  Build complete.
written     : /project/uni/dist/build/h5/
```

uni-app 比几个 bundler demo 更重：它跑的是带 `@dcloudio/vite-plugin-uni` 的 Vite，而且 CLI 是
**自动发现** `vite.config.mjs` 而非由调用方传入——于是 Vite 要用 **esbuild 打包这个配置，而 esbuild
在标签页里没有文件系统**。这正是运行时的 **esbuild ⇄ VFS 桥**（`tooling/esbuild-bridge.ts`）的用途：
运行时对项目代码**透明包装 `esbuild`**，让它的 `build()` 经 VFS 解析 / 载入文件，第三方 CLI 无需任何改动。
uni 默认还走 **terser** 压缩，而 Vite 的 terser 跑在一个 `worker_threads` Worker（`eval: true`）里，
标签页起不了——所以 `vite.config.mjs` 改用 esbuild 压缩器。这里只提供 H5 目标：小程序目标产出的是微信的
`wxml`/`wxss`，浏览器里没有任何东西能跑它（那需要微信开发者工具）。

## Vendored 真源码现状

Node 的 `lib/` 里可原样复用的文件直接取真源码（内容哈希 + 上游 revision 记在 `vendor/node-lib/MANIFEST.json`），不自己重写；`npm run vendor` 从本地 Node checkout 重新生成，我们打过的每个 patch 都列在 manifest 里。

磁盘上的真源码保持原样；**进 bundle 的那份由构建期插件去注释**（`plugins/vendored-source.ts`）。Node 的 `lib/` 注释很厚（~23%），而 vendored 源是以字符串形式进 bundle 的，minifier 碰不到。插件删注释但**严格保留行号与代码列**（堆栈仍指向真行）、保留每文件 MIT 声明；worker 从 1259KB 降到 1028KB（**gzip 315KB → 237KB**）。

**当前覆盖**（revision `7a3437d`，v26.9.1-dev）：

- **163 个文件**已 vendor：整套 `stream` 层、`events`、`internal/event_target`（+ `internal/webidl`、`internal/perf/utils`）、`internal/abort_controller`、`console`（+ `internal/console/*`、`internal/cli_table`、`internal/util/debuglog`、`internal/trace_events`、`internal/readline/*`）、`os`、`timers`（+ `internal/timers`、`timers/promises`、`internal/linkedlist`、`internal/priority_queue`）、`internal/worker/io`（+ `internal/per_context/messageport`、`internal/worker/js_transferable`，真 `MessageChannel`/`MessagePort`/`BroadcastChannel`）、`readline`（+ `readline/promises`、`internal/readline/{interface,emitKeypressEvents,promises}`、`internal/repl/history`，真行编辑器/按键解码/ANSI 光标/历史环）、`internal/fs/glob`（+ 随包的 `internal/deps/minimatch/index`，真 glob 遍历器与匹配器，`path.matchesGlob`/`fs.glob`/`fs.globSync`/`fs.promises.glob` 可用）、`perf_hooks`（+ 整个 `internal/perf/*` 组，真 `Performance`/`PerformanceMark`/`PerformanceMeasure`/`PerformanceObserver`/`PerformanceNodeTiming`/`timerify`，跑在 JS `performance` binding 上；直方图 `createHistogram`/`monitorEventLoopDelay` 是真的，跑在 `deps/histogram` 的 `wn_histogram` WASM 构建上）、`stream/web`（+ 整个 `internal/webstreams/*` 组，真 WHATWG `ReadableStream`/`WritableStream`/`TransformStream`、queuing strategies、`TextEncoderStream`/`TextDecoderStream`，以及经典流↔web 流双向适配，`Readable.toWeb`/`Writable.toWeb`/`Duplex.toWeb` 可用；`CompressionStream`/`DecompressionStream` 是真的，跑在 `deps/zlib` 的 `wn_zlib` WASM 构建上（brotli/zstd 编解码另有 `wn_brotli`/`wn_zstd`））、`stream/iter`（+ 整个 `internal/streams/iter/*` 组，新的实验性 iterable-streams API：`push`/`pull`/`from`/`merge`/`broadcast`/`share`/`tap`、同步与异步两套消费者、经典流↔iter 双向互操作）与 `stream/consumers`（`text`/`json`/`buffer`/`bytes`/`arrayBuffer`/`blob`）、`internal/blob`（+ `internal/file`，真 `Blob`/`File`，跑在 JS `blob` binding 上并保留 `DataQueue` 契约：reader 每次 `pull` 只交出一片，所以 `blob.stream()` 按原始 source 边界切块；`Blob`/`File` 是全局且与 `require('buffer').Blob` 同身份，`fs.openAsBlob` 与 `URL.createObjectURL` 对象存储一并就位）、`async_hooks`（+ `internal/async_local_storage/*`、`internal/promise_hooks`）、`path`、`querystring`、`punycode`、`domain`、`diagnostics_channel`、`string_decoder`、`assert`（+ `internal/assert/*`）、`internal/validators`、`internal/util/types`、`internal/util/inspect`（真 `util.inspect`）、`internal/util/comparisons`（真 `isDeepStrictEqual`）、`internal/util/colors`、`util`（+ `internal/util.js`、`internal/util/diff`、`internal/util/parse_args/*`）、`internal/mime`，以及它们依赖的 `internal/*`（`primordials`、`fixed_queue`、`constants`、`encoding/util`、`streams/state`、`streams/destroy`、`per_context/*` 等）。
- **58 个顶层 `lib/*.js` 里已有 32 个可用**——其中 31 个是真实现（vendored 真源码，或因为真文件依赖浏览器里不存在的 native 层而由我们自研，或直接跑在 WASM 构建上），只剩 **`tls`** 一个是只保证 `import` 不出错的占位桩，调用时抛带类型的 `NotImplementedError`（`tty`/`v8`/`zlib` 都已是真实现）。最新的真实现就包括跑在 wasm 上的 `zlib`（`wn_zlib`/`wn_brotli`/`wn_zstd`）与 `perf_hooks` 直方图（`wn_histogram`），以及 `stream/web`（整个 `internal/webstreams/*` 组）、`internal/blob`/`internal/file` 背后的 `Blob`/`File` 全局、`stream/iter`（+ `internal/streams/iter/*`）与 `stream/consumers`。`crypto` 是覆盖最深的那个：WebCrypto 只有异步 API，而 Node 的 `createHash`/`createHmac`/`pbkdf2Sync`/`scryptSync` 以及密码、密钥 API 都是同步的，所以需要一个完整加密引擎——它跑在 OpenSSL 3.5.8 子集的 `wn_openssl` WASM 构建上，由 `src/node-runtime/crypto/` 的 TS 直接驱动：摘要（MD5、SHA-1、SHA-2、SHA-3/Keccak、BLAKE2、RIPEMD-160、SM3）、MAC（HMAC、Poly1305、SipHash）、KDF（PBKDF2、HKDF、scrypt、Argon2）、对称密码（AES 含 GCM/CCM/OCB/SIV/XTS/CBC-CTS/CFB、ChaCha20-Poly1305、DES/3DES、Camellia、ARIA、SM4）、非对称（RSA/DSA/DH/ECDH/Ed25519/Ed448/X25519/X448/ML-KEM），以及 X.509/SPKAC 证书与 DER；输出逐一对照 Node 自己的 OpenSSL 输出。

### 能搬与不能搬

Node `lib/` 约 420 个 `.js`。"全搬"不是复制活：绝大多数直接坐在 native binding（V8 C++ API、libuv handle、raw socket、native addon、模组 loader）上，浏览器没有对应物。所以规则是——**纯 JS 层原样 vendor，下面的 native 层要么用 JS 在本页自带 API 上重写**（`async_hooks` 的 `async_wrap`、`string_decoder` 的 JS decoder binding 都是这个套路），**要么——当真实现坐在 C/C++ 库上时——把那库直接编成 WASM**（见《原生层 → WASM（阶段 H）》）。当某个文件的依赖只有我们已提供的 shim 时，它就可 vendor。真实现坐在 C/C++ 库上的现在都走 WASM：`zlib`（+ brotli/zstd）、`perf_hooks` 直方图、整个 `crypto` 引擎。`wasi` 和 `cluster` 也都是真的——前者是 VFS 上的完整 `wasi_snapshot_preview1` 宿主（正是它让 rspack 的 WASM binding 能跑），后者是「一 fork 一个 worker」并在虚拟网络上共享端口。

剩下的大缺口是根本无浏览器故事的那些（`http2`、`dgram`、`tls`/`_tls_*`、`inspector`、`repl`、`sqlite`、`sea`，以及 `worker_threads` 背后的**真线程**），以及值得做的 native 层重写（`internal/util/inspect.js`、`internal/util/types.js`、`internal/fs/*`）。`vm` 已经是真的 `lib/vm.js`（下面垫一层 JS 复刻的 V8 context），`worker_threads.Worker` 则是同 loop 的协作式工作器（真消息、真生命周期与真 stdio，无并行）；`internal/errors` 已覆盖 vendored 模块实际取用的每一个码，并有回归测试兵护。Node 核心模块里只剩 `tls` 是纯报错桩。

## 改动约定

1. 改完先跑 `npm run typecheck && npm test`，保持全绿。
2. 浏览器验证清单见 `docs/DEVLOG.md` 顶部。
3. 在 `docs/DEVLOG.md` 追加一条变更记录（改了什么 / 为什么 / 涉及文件）。
