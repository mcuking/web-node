# web-node

在浏览器里跑 Node.js 源码（WebContainer 式运行时）。

[![在线 demo](https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%20demo-mcuking.github.io%2Fweb--node-5ef1a5)](https://mcuking.github.io/web-node/)

[English](README.md) · **简体中文**

- **在线 demo**：<https://mcuking.github.io/web-node/>（装依赖、跑 demo 项目、点 **⚡ Vite build**，全在标签页里）
- **开发日志 / 进度 / 下一步**：`docs/DEVLOG.md` ← **每次改动都往这里追加**
- 设计文档：`docs/superpowers/specs/2026-09-17-web-node-design.md`
- 上游源码：`/Users/tangjianghong/Downloads/node`（Node.js **v26.9.1-dev**，`v26.9.0-1-g7a3437d`）

## 开发

> ⚠️ 用 fnm 的独立 Node（**v26.9.0**，与上游 vendored 源码同版本；v22.19.0 也保留），
> 不要用 ClawHive 内置 Electron Node（Electron Node 会让 rollup 原生模块 dlopen 代码签名失败）。

```bash
export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v26.9.0/installation/bin:$PATH"

npm install
npm run dev        # http://localhost:5173
npm test           # 单元 + 集成测试
npm run typecheck  # tsc --noEmit
npm run build      # 生产构建
npm run vendor     # 重新从 Node 源码 vendor 文件
```

### 部署（GitHub Pages）

Pages 的 project site 跑在子路径下，所以构建要带 base path；脚本会把 `dist/` 发布到
`gh-pages` 分支（无需 Actions）：

```bash
npm run deploy     # = BASE_PATH=/web-node/ tools/deploy-pages.sh
```

上线地址：<https://mcuking.github.io/web-node/>。

## 结构

```
src/
  node-runtime/   运行时核心：realm(binding 分发) / loader / runtime
    bindings/     TS 实现的 internalBinding
    builtins/     node:* 模块实现（真源码 + TS 实现）
    loader/       CJS resolver + ESM→CJS 转换
    net/          虚拟 TCP（VirtualNetwork / VirtualSocket）
    vfs/          虚拟文件系统（内存树 + OPFS 持久化）
    npm/          npm client（semver / registry / tarball / installer）
  worker/         Dedicated Worker 入口
  client/         主线程 Runtime Client API（含 ServiceWorker 桥）
  ui/             Demo UI（文件树 / 编辑器 / 终端 / 预览）
public/sw.js      ServiceWorker：/preview/<port>/ → 虚拟网络
vendor/node-lib/  从 Node.js 源码复制的真实文件（含来源记录 MANIFEST.json）
tools/            依赖扫描 / vendoring 工具
docs/             设计文档 + 开发日志
test/             Vitest 单测 / 集成测试
```

## 网络（M3）

`http.createServer().listen(3000)` 后，在 UI 的 **Preview** tab 或 `/preview/3000/` 访问：

```
浏览器 URL → ServiceWorker → 主线程 → runtime worker → VirtualNetwork → 你的 handler
```

## 流（stream 前置）

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

响应到浏览器也是**真流式**：SW 直接把 `ReadableStream` 交给浏览器，`res.write()` / SSE / 大文件
边产生边到达（HTML 例外，为注入 `<base>` 先缓冲）。连接默认 keep-alive，服务端支持 pipelining，
客户端按端口做连接池。`https` 是 `http` 的同名壳（虚拟网络无 TLS）。

## npm（M4 / M6 / M39）

点顶栏 **⬇ Install deps**：客户端会读项目 `package.json`，向 npm registry 解析依赖版本，
下载 tarball 后 gunzip + untar 写入虚拟 `node_modules`（顶层 hoisting，仅在版本冲突时嵌套），
之后普通 `require` 就能拿到：

```js
const ms = require('ms');
ms(60000); // '1m'
```

M6 把 npm 客户端补到实用：
- **lockfile**：安装写入 `package-lock.json`（lockfileVersion 3）；二次安装直接复用已锁版本，不再解析。
- **完整性校验**：每个 tarball 在写入 VFS **之前**用 WebCrypto 校 registry 的 sha512/sha1。
- **peer 依赖**：缺失的 peer 自动装到根 `node_modules`（npm 7+ 行为）。
- **平台过滤**：仅不匹配当前平台（`linux`/`wasm32`）的 `optionalDependencies` 静默跳过。

M39 又把解析推进一步：
- **`overrides`/`resolutions`**：根 `package.json` 的 `overrides`（或 Yarn 的 `resolutions`）能钉住一个
  传递依赖的版本（支持扁平、嵌套、`.`、`$ref`；最长路径优先），不用改那个声明依赖的包。
- **`file:`/`link:`**：直接从虚拟文件系统装包——`file:` 指向目录（读其 `package.json`，递归拷贝，
  跳过 `node_modules`）或本地 `.tgz`（解包）；`link:` 因其物化为拷贝（VFS 无符号链接）。
- **有界并发下载**：tarball 下载最多 `concurrency`（默认 8）个同时在飞，且**先全部下载校验再写树**，
  失败不留半成品。

未支持：`git+`/`git:` 说明符；`link:` 是拷贝而非符号链接，所以对源包的修改不会反映到消费方。
（生命周期脚本与 `.bin` shim 已可用：它们跑在运行时自带的 `child_process` 表面之上，见里程碑 7。）

## 进程与 IPC（M7 / M40）

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

未支持：**send handle**（`net.Socket`/server）显式拒绝而不是静默丢弃（这里没有 OS 句柄可传）；
`'advanced'` 能保 `Map`/`Set`/`Date`，但不保 `Buffer` 子类（V8 serializer 会保，`structuredClone` 不会）；
`cwd` 不隔离：父子共享同一个虚拟文件系统。

## 构建工具（M5）

点顶栏 **▦ Build**：在标签页里跑 **esbuild 的官方 WASM 构建**（就是 Vite 内部用的那个转换器）。
它会 `require('esbuild-wasm')`（靠 `browser` 字段解析到自包含的浏览器构建）、用 VFS 里的
`esbuild.wasm` 初始化、再用一个 VFS 插件打包 `src/app.ts`（TypeScript + 真实 `node_modules`
依赖），写回 `/project/dist/app.js`。

```
tool        : esbuild-wasm v0.28.2 (13.3 MB wasm)
wasm        : compiled + service started in 37ms
bundle      : 5138 bytes in 116ms
written     : /project/dist/app.js
```

为支持它顺带补齐了：`package.json` 的 **`browser` 字段**（字符串/对象形式，`false` → 空模块）和
模块级 **`require.resolve()`**。

### 用 rollup 打包（M5b）

点 **⧉ Bundle**：在页内跑 **rollup 的官方 WASM 构建**，直接从虚拟文件系统读项目 ES 模块
（**无需插件** —— 我们的 `fs` 就是 VFS），做 tree-shaking 后写回 `/project/dist/app.esm.js`：

```
tool        : rollup v4.63.3 (official WASM build)
bundle      : 339 bytes in 13ms
tree-shaken : yes (dead export dropped)
written     : /project/dist/app.esm.js
```

Vite / webpack 本体曾是下一步——现在 Vite 跑通了（M5c）：

### 用 Vite 构建（M5c）

点 **⚡ Vite build**：在页内跑**真正的 Vite（v5）**打包 `site/`。Vite 是纯 ESM，且 `import` 原生
esbuild addon，所以运行时把 `esbuild`→`esbuild-wasm`、`rollup`→`@rollup/wasm-node` 别名；WASM
版 esbuild 显式初始化后，`vite.build()` 整个跑在虚拟文件系统上：

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
模块身份、以及 `crypto`。

注意 Vite 8 已改用 rolldown（Rust 原生二进制），浏览器里跑要钉 **Vite 5.x**。

### 跑 Vite dev server（M5d–M5e）

点 **🛠 Vite dev**：真正的 Vite dev server 在标签页里启动，`createServer()` 绑一个虚拟端口
（5173）并**按需转换**模块，和 Node 里一样。打开 **Preview** tab（`:5173`）页面就能渲染，
全部来自虚拟文件系统。

```
tool        : vite v5.4.21 dev server (in the tab)
esbuild     : wasm started in 38ms
listening   : http://127.0.0.1:5173
```

为此补了两样东西：loopback-only 的 **`dns`** builtin（Vite 的 `buildStart` 会解析 `localhost`）、
以及真 EventEmitter 的 `process.stdin`（`close()` 会卸载 SIGTERM 监听）。预览桥还学会了把浏览器的
**绝对路径**资源（`/@vite/client`、链式 import）回路由到正确虚拟端口——靠记住 `clientId → port`，
因为 ServiceWorker 眼中一个文档及其所有子资源共享同一个 client id。

**HMR 可用，走非 WebSocket 通道。** HMR 是本 WebSocket，而 ServiceWorker 无法代理 upgrade，
浏览器经预览桥到不了它。但预览 iframe 与 runtime 同源，于是 ServiceWorker 注入一段 `WebSocket` 垫片，
把命中 `vite-hmr` 子协议的 socket 改道到 `BroadcastChannel`；通道按虚拟端口取名（`web-node-hmr:<port>`），
所以两个 dev server 互不干扰；而 `<port>.localhost` 预览是**别的源**，听不到该通道，改由顶页中继。
runtime 交给 Vite 一个 HMR 服务器对象，其 `send()` 走该通道而非 socket。**Vite 照常计算所有更新，我们只负责搬运**。
另有一个小 Vite 插件把 VFS 变更事件转成 Vite watcher 事件（标签页里没有 inotify），所以编辑源文件会触发
真正的更新：点 **✏️ HMR JS**（`js-update`）或 **🎨 HMR CSS**（`css-update`），预览**原地更新**，不整页刷新。

## 里程碑

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 纯 JS 运行层 | ✅ |
| M2 | 虚拟文件系统 | ✅ |
| M3 | 网络（虚拟 TCP + SW 桥 + 预览） | ✅ |
| S | stream 前置 | ✅ |
| M4 | npm client | ✅ |
| M3.5a | keep-alive（持久连接 + pipelining + 连接池） | ✅ |
| M3.5b | 浏览器侧真流式（SW 直转 ReadableStream） | ✅ |
| M3.5c | https（http 同名壳） | ✅ |
| M3.5d | 子域名路由（`<port>.localhost`） | ✅ 完成（dev server） |
| M5 | 真实构建工具 —— esbuild WASM：安装→初始化→打包→写回 | ✅ |
| M5b | 真实打包器 —— rollup WASM：ESM 图 + tree-shaking → VFS | ✅ |
| M5c | 真实构建工具链 —— Vite 本体：production build → VFS | ✅ |
| M5d | Vite dev server 在页内跑通（按需转换 + 预览） | ✅ |
| M5e | Vite HMR 在页内跑通（走 BroadcastChannel，非 WebSocket） | ✅ |
| M5f | HMR 收尾（CSS `css-update` + 按端口隔离通道） | ✅ |
| M6 | npm 收尾（lockfile + 完整性校验 + peer 自动安装） | ✅ |
| M7 | `child_process` + 受控 spawn 面（fork/exec/spawn + mini-shell） | ✅ |
| M7 | npm `.bin` shim + 生命周期脚本 | ✅ |
| M8 | stream 收尾（字节精确 `read(n)` + objectMode 分离 + `autoDestroy`） | ✅ |
| M9 | Buffer 共享内存（`slice`/`subarray`、`from(ArrayBuffer)` 视图） | ✅ |
| M10 | 扩大 vendoring —— 真源码 `internal/streams/state.js` 接管 hwm | ✅ |
| M11 | 修 stream 核心 bug + 真源码 `Readable.from` | ✅ |
| M12 | 对齐流状态形状（`_readableState`/`_writableState`）+ 真谓词 | ✅ |
| M13 | vendor `internal/streams/destroy.js`（真 `destroy`/`_undestroy` + `[kState]` 位域）+ `finished()` 接真谓词 | ✅ |
| M14 | vendor `internal/streams/end-of-stream.js` —— `finished()`/`eos()` 就是真源码（options + AbortSignal） | ✅ |
| M15 | vendor 真 `events.js`（换掉自研 EventEmitter）+ 真 `stream.addAbortSignal` | ✅ |
| M16 | **整套 stream 换真源码**（`lib/stream.js` + `internal/streams/*`：Writable/Duplex/Transform/PassThrough/pipeline/compose/duplexPair/operators + `stream/promises`），删除手写 stream | ✅ |
| M17 | **真 `async_hooks`**（`lib/async_hooks.js` + `internal/async_hooks.js` + `internal/async_local_storage/*` 落在自研 JS `async_wrap` 绑定上）；tick/timer 是真 async resource，hook 会触发、`AsyncLocalStorage` 能跨异步边界传 store | ✅ |
| M18 | **真框架**——@vitejs/plugin-vue 在页内编译 **Vue 3 SFC**；`vite build` 出生产 Vue bundle，dev server 在预览里跑真实可交互应用（含 HMR） | ✅ |
| M19 | **更多 vendored 真源码**——`punycode.js`、`domain.js`、`diagnostics_channel.js`（跑在真 `async_hooks` 上，配一个小 JS binding） | ✅ |
| M20 | **真 `string_decoder`**——把 native 解码状态机（`src/string_decoder.cc`）用 JS 逐字节重写；`lib/string_decoder.js` 换真源码 | ✅ |
| M21 | **真 `internal/util/types`** + 对齐 `src/node_types.cc` 的 `types` binding；`util.types` 指向真模块 | ✅ |
| M22 | **真 `internal/util/inspect.js`**——`util.inspect`/`format`/`formatWithOptions` 就是真源码；`console` 走真 `formatWithOptions` | ✅ |
| M23 | **真断言栈**——`lib/assert.js` + `internal/assert/*` + `internal/util/comparisons` + 真 `internal/validators.js`；堆栈帧通过 `sourceURL` 显示真文件名 | ✅ |
| M24 | **整套 `util` 换真源码**（`lib/util.js` + `lib/internal/util.js`）：`promisify`/`callbackify`/`styleText`/`parseArgs`/`diff`/`MIMEType`/`parseEnv` | ✅ |
| M25 | **真 Web EventTarget 栈**——`internal/event_target.js` + `internal/webidl.js`：真 `EventTarget`/`Event`/`CustomEvent`/`defineEventHandler` | ✅ |
| M26 | **真 `AbortController`/`AbortSignal`**——`internal/abort_controller.js` 建在真 EventTarget 上（`timeout`/`any`/`throwIfAborted`） | ✅ |
| M27 | **真 `console`**——`lib/console.js` + `internal/console/*` + `internal/cli_table`：真 `Console` 与 `table`/`count`/`group`/`time` | ✅ |
| M28 | **真 `os`**——`lib/os.js` 站在对齐 `src/node_os.cc` 的静态 `os` binding 上 | ✅ |
| M29 | **真 `timers`**——`lib/timers.js` + `internal/timers.js` + `timers/promises.js`，`timers` binding 内置一个代替 libuv 的驱动 | ✅ |
| M30 | **真 `worker_threads` 消息传递**——`internal/worker/io.js`：真 `MessageChannel`/`MessagePort`/`BroadcastChannel`，`messaging` binding 用 JS 重实现 `src/node_messaging.cc` | ✅ |
| M31 | **真 `readline`**——`lib/readline.js` + `internal/readline/*`：真行编辑器、按键解码、ANSI 光标函数与历史环 | ✅ |
| M32 | **worker 减重**——构建期剥离 vendored 注释（保留行号/列号与 MIT 声明）：worker 1259KB → 1028KB（gzip 315 → 237KB） | ✅ |
| M33 | **真 glob**——`internal/fs/glob.js` + 随包的 `internal/deps/minimatch`：`path.matchesGlob`、`fs.glob`/`globSync`/`promises.glob` | ✅ |
| M34 | **`crypto` 同步面**——纯 JS 的 MD5/SHA-1/SHA-2/HMAC/PBKDF2/HKDF/scrypt，逐一对照 Node 的 OpenSSL 输出 | ✅ |
| M35 | **真 `perf_hooks`** + 整个 `internal/perf/*` 组，跑在 JS `performance` binding 上（需 native hdr_histogram 的直方图抛错） | ✅ |
| M36 | **真 WHATWG streams**——`stream/web.js` + `internal/webstreams/*`，`Readable.toWeb`/`Writable.toWeb`/`Duplex.toWeb` 双向打通 | ✅ |
| M37 | **真 `Blob`/`File`**——`internal/blob.js` + `internal/file.js` 跑在 JS `blob` binding 上；全局可用，并带 `fs.openAsBlob` 与 `URL.createObjectURL` 存储 | ✅ |
| M38 | **真 `stream/iter`**（新的 iterable-streams API）与 **`stream/consumers`**（`text`/`json`/`buffer`/`bytes`/`arrayBuffer`/`blob`） | ✅ |
| M39 | **npm 深化**——根级 `overrides`/`resolutions`、`file:`/`link:` 说明符、有界并发下载 | ✅ |
| M40 | **`fork()` IPC**——双向真通道（`child.send`/`process.send`）、默认 JSON 序列化、开着通道保活、`node nope.js` 像真 Node 一样 exit 1 | ✅ |
| M41 | **Buffer slab 池化**——小于 `Buffer.poolSize` 一半（64 KiB）的分配共享一块对齐 slab，`.byteOffset`/`.buffer.byteLength` 与 Node 对齐 | ✅ |
| M42 | **`util.inspect` / ICU 保真度**——`async function*` 既是 generator 又是 async（输出 `[AsyncGeneratorFunction: x]`）；`icu.getStringWidth` 按真实 Unicode 列宽度量，`console.table`/CJK 折行与 Node 一致 | ✅ |
| M43 | **真 `process` 表面**——逐键对照 Node v26.9.0（`getBuiltinModule`/`getActiveResourcesInfo`/`loadEnvFile`/未捕获异常捕获三件套/`reallyExit` 等）；timer/nextTick 回调抛出的异常现在统一经 `process._fatalException` 路由 | ✅ |
| M44 | **宿主 `fetch` 计入退出判定**——在飞的宿主请求会吊住子进程（不再丢输出）；纯微任务 promise（WebCrypto、`Blob.arrayBuffer`）不计数，与 Node 一致 | ✅ |
| M45 | **真 `zlib`**——deflate/gzip 的流式与一次性形式跑在平台 `CompressionStream`/`DecompressionStream` 上，与 Node v26.9.0 逐字节一致；同步形式与编码参数显式抛 `NotImplementedError`（不静默忽略） | ✅ |
| M46 | **宿主 `WebSocket` 计入退出判定**（M44 的姊妹缺口），并修一个 loader 顶层词法声明与注入沙箱全局冲突的 bug | ✅ |
| M47 | **`crypto` 对称密码**——AES-128/192/256 的 ECB/CBC/CTR/CFB/OFB/GCM，纯 JS，逐字节对齐 OpenSSL；未实现的 cipher 抛类型化 `NotImplementedError` | ✅ |
| M48 | **真 `Buffer`**——vendor `lib/buffer.js` + `lib/internal/buffer.js`，删手写 `buffer.ts`；`buffer` binding 扩成完整 JS 实现 | ✅ |
| M49 | **真 `vfs` 子系统**——`lib/internal/vfs/*` + `lib/internal/fs/utils.js`；`vfs` 模块可用（完整 `MemoryProvider`）；`uv` binding 换成真 85 条 `UV_ERRNO_MAP` | ✅ |
| M50 | **真 `fs/promises`**——`lib/fs/promises.js` + `lib/internal/fs/promises.js`；`fs` binding 补齐整张 async/promise 面 | ✅ |
| M51 | **真回调式 `fs`**——`lib/fs.js`（4083 行）；`fs.watch`/`fs.promises.watch` 经 VFS 投影走真 watchers 代码 | ✅ |
| M51b | **`fs.opendir`/`Dir` + `fs.watchFile`**——真 `fs_dir` binding + 复刻 libuv `uv_fs_poll` 的 `StatWatcher` 轮询实现 | ✅ |
| M52 | **真 `internal/fs/streams.js`**——`fs.ReadStream`/`fs.WriteStream` 换真源码（惰性加载，顶层 `require('fs')` 回环自然解除） | ✅ |
| M53 | **真 `url`**——vendor `lib/url.js`（legacy parse/format/resolve + WHATWG 重导出）；`internal/url` 改成宿主 URL 桥，新增 `url`/`url_pattern`/`encoding_binding` binding | ✅ |
| M54 | **真 `v8`**——vendor `lib/v8.js`；`serialize`/`deserialize` 与 `Serializer`/`Deserializer` 跑在新的 `serdes` binding 上（用 JS 重写 V8 结构化克隆线格式（版本 15），与真 Node v26.9.0 的 115 条差分语料逐字节一致）；堆快照/`queryObjects`/profiler 一律抛错 | ✅ |
| M55 | **真 `tty`**——vendor `lib/tty.js` + `lib/internal/tty.js`，新增 `tty_wrap` binding（`isTTY` 恒 false、`TTY` 构造即抛）：`isatty` 与 `getColorDepth`/`hasColors` 是真实现，`ReadStream`/`WriteStream` 抛错而不假装终端；`internal/util/colors` 的 `FORCE_COLOR` 惰性路径（之前指向未注册模块、会炸）从此可用，`util.styleText` 会真的上色。57 条颜色深度 + 10 条 `hasColors` 语料与真 Node v26.9.0 全等 | ✅ |
| M56 | **真 `vm`**——vendor `lib/vm.js` + `lib/internal/vm.js`，新增 `contextify` binding：沙箱对象**本身就是**上下文（标 Node 的 contextify 符号），脚本跑在它上面的 `with` scope 里，所以 `createContext`/`isContext`/`Script`/`compileFunction`/`runIn*Context` 都是真的，且新上下文里 `process`/`require`/`Buffer`/`setTimeout` 保持 `undefined`。59 条行为与真 Node v26.9.0 全等 | ✅ |
| M57 | **真 `Worker`**——协作式工作器：同一事件循环上的第二个模块注册表，拥有自己的 `process`/`worker_threads` 视图与与父侧的**真** `MessageChannel`。`workerData`、消息往返、`online`/`message`/`error`/`exit` 生命周期、`terminate()` 与构造校验均与 Node 对齐（包括退出后 `threadId === -1`、`postMessage` 为 no-op）。唯一要紧的偏离是**无真并行**（已写明），需原生线程的东西（`eval`/worker 标准 IO/`resourceLimits`/剖析/嵌套 `Worker`）全部响亮报错。15 条行为与真 Node v26.9.0 全等 | ✅ |
| M58 | **补齐 `internal/errors` 码表**——把 vendored/`src` 树里所有 `ERR_*` 引用与 shim 表对了一遍，发现 **9 个码被 `internal/errors` 解构引用但表里从未定义**，于是 `codes.X` 是 `undefined`、`new` 在罕至路径上报 “is not a constructor”。9 个码已逐字（对齐 `lib/internal/errors.js` 与 `src/node_errors.h`）补齐，并有结构回归门测试（每个被引用的码都必须是构造函数，扫到 76 个）与差分语料（真 Node 经 `--expose-internals` 直取 `internal/errors` 逐字段比对，10/10 一致）兵护 | ✅ |
| M59 | **真 worker 标准 IO**——`worker.stdin`/`stdout`/`stderr` 三个 getter 以前都抛错，而 Node 从不（`stdin` 默认 null，仅 `stdin: true` 时是流；`stdout`/`stderr` 总是可读流、默认只是转发到父进程）。现为经**第二条 MessageChannel** 传输的真流：worker 侧 `process.stdout/stderr/stdin` 是真流、其 `console` 绑到自己的 stdout/stderr、转发行为与 Node 一致，未 `end()` 的 `worker.stdin` 会 ref 住 worker；顺带用静默期修复了“worker 可能在在途消息送达前先退出”的竞态 | ✅ |
| M60 | **修正 SystemError 基底错误码**——Node 用 `E(code, msg, SystemError)` 声明的码（`ERR_FS_CP_*`、`ERR_FS_EISDIR`、`ERR_SYSTEM_ERROR`）本应从**上下文对象**拼消息且 `name='SystemError'`；表里只登记了 `ERR_TTY_INIT_FAILED`，其余丢了名字与 `: syscall returned code (message) path => dest` 后缀。11 个码现已全部正确，并带上 `HideStackFramesError` 伴生类；一条新的全量消息文案差分还抓出 3 处真实文案错误（两个 `ERR_FS_CP_*` 互换了文案） | ✅ |
| M61 | **补齐 `internalBinding` 表面**——Node 内部只经 `internalBinding(id)` 取宿主能力，名字没定义就 `undefined`、调用点报 “is not a function”（与 M58 同类）。扫出 5 处真缺失并补上：`util.markPromiseAsHandled`（`internal/streams/iter/*` 调用）、`uv.UV_ENOSPC` 及整张 `UV_E*` 表（`internal/fs/watchers`）、`v8.kSampling*`、`constants.internal`（`internal/vfs/setup`）、`process_methods.dlopenBinary`；`uv` 改为从 `ERRNO` 生成整张常量表（88 值逐值对齐真 Node），并新增一条遍历 vendored 树的结构金门卫 | ✅ |

## Vendored 真源码现状

Node 的 `lib/` 里可原样复用的文件直接取真源码（内容哈希 + 上游 revision 记在 `vendor/node-lib/MANIFEST.json`），不自己重写；`npm run vendor` 从本地 Node checkout 重新生成，我们打过的每个 patch 都列在 manifest 里。

磁盘上的真源码保持原样；**进 bundle 的那份由构建期插件去注释**（`plugins/vendored-source.ts`）。Node 的 `lib/` 注释很厚（~23%），而 vendored 源是以字符串形式进 bundle 的，minifier 碰不到。插件删注释但**严格保留行号与代码列**（堆栈仍指向真行）、保留每文件 MIT 声明；worker 从 1259KB 降到 1028KB（**gzip 315KB → 237KB**）。

**当前覆盖**（revision `7a3437d`，v26.9.1-dev）：

- **119 个文件**已 vendor：整套 `stream` 层、`events`、`internal/event_target`（+ `internal/webidl`、`internal/perf/utils`）、`internal/abort_controller`、`console`（+ `internal/console/*`、`internal/cli_table`、`internal/util/debuglog`、`internal/trace_events`、`internal/readline/*`）、`os`、`timers`（+ `internal/timers`、`timers/promises`、`internal/linkedlist`、`internal/priority_queue`）、`internal/worker/io`（+ `internal/per_context/messageport`、`internal/worker/js_transferable`，真 `MessageChannel`/`MessagePort`/`BroadcastChannel`）、`readline`（+ `readline/promises`、`internal/readline/{interface,emitKeypressEvents,promises}`、`internal/repl/history`，真行编辑器/按键解码/ANSI 光标/历史环）、`internal/fs/glob`（+ 随包的 `internal/deps/minimatch/index`，真 glob 遍历器与匹配器，`path.matchesGlob`/`fs.glob`/`fs.globSync`/`fs.promises.glob` 可用）、`perf_hooks`（+ 整个 `internal/perf/*` 组，真 `Performance`/`PerformanceMark`/`PerformanceMeasure`/`PerformanceObserver`/`PerformanceNodeTiming`/`timerify`，跑在 JS `performance` binding 上；直方图 `createHistogram`/`monitorEventLoopDelay` 需 native hdr_histogram，抛错）、`stream/web`（+ 整个 `internal/webstreams/*` 组，真 WHATWG `ReadableStream`/`WritableStream`/`TransformStream`、queuing strategies、`TextEncoderStream`/`TextDecoderStream`，以及经典流↔web 流双向适配，`Readable.toWeb`/`Writable.toWeb`/`Duplex.toWeb` 可用；`CompressionStream`/`DecompressionStream` 需 native zlib，抛错）、`stream/iter`（+ 整个 `internal/streams/iter/*` 组，新的实验性 iterable-streams API：`push`/`pull`/`from`/`merge`/`broadcast`/`share`/`tap`、同步与异步两套消费者、经典流↔iter 双向互操作）与 `stream/consumers`（`text`/`json`/`buffer`/`bytes`/`arrayBuffer`/`blob`）、`internal/blob`（+ `internal/file`，真 `Blob`/`File`，跑在 JS `blob` binding 上并保留 `DataQueue` 契约：reader 每次 `pull` 只交出一片，所以 `blob.stream()` 按原始 source 边界切块；`Blob`/`File` 是全局且与 `require('buffer').Blob` 同身份，`fs.openAsBlob` 与 `URL.createObjectURL` 对象存储一并就位）、`async_hooks`（+ `internal/async_local_storage/*`、`internal/promise_hooks`）、`path`、`querystring`、`punycode`、`domain`、`diagnostics_channel`、`string_decoder`、`assert`（+ `internal/assert/*`）、`internal/validators`、`internal/util/types`、`internal/util/inspect`（真 `util.inspect`）、`internal/util/comparisons`（真 `isDeepStrictEqual`）、`internal/util/colors`、`util`（+ `internal/util.js`、`internal/util/diff`、`internal/util/parse_args/*`）、`internal/mime`，以及它们依赖的 `internal/*`（`primordials`、`fixed_queue`、`constants`、`encoding/util`、`streams/state`、`streams/destroy`、`per_context/*` 等）。
- **58 个顶层 `lib/*.js` 里已有 32 个可用**——其中 28 个是真实现（vendored 真源码，或因为真文件依赖浏览器里不存在的 native 层而由我们自研），另 4 个（`tty`/`v8`/`tls`/`zlib`）是只保证 `import` 不出错的占位桩，调用时抛带类型的 `NotImplementedError`。最新的真实现是 `perf_hooks`（整个 `internal/perf/*` 组）、`stream/web`（整个 `internal/webstreams/*` 组）、`internal/blob`/`internal/file` 背后的 `Blob`/`File` 全局，以及 `stream/iter`（+ `internal/streams/iter/*`）与 `stream/consumers`。手写实现里最新的是 `crypto`：WebCrypto 只有异步 API，而 Node 的 `createHash`/`createHmac`/`pbkdf2Sync`/`scryptSync` 都是同步的，所以 MD5、SHA-1、SHA-2（224/256/384/512）、HMAC、PBKDF2、HKDF、scrypt 都在 `src/node-runtime/crypto/hash.ts` 里用纯 JS 实现，并逐一对照 Node 的 OpenSSL 输出；密文、签名、密钥对象仍显式不支持。

**能搬与不能搬**：Node `lib/` 约 420 个 `.js`。"全搬"不是复制活：绝大多数直接坐在 native binding（V8 C++ API、libuv handle、raw socket、native addon、模组 loader）上，浏览器没有对应物。所以规则是——**纯 JS 层原样 vendor，下面的 native 层用 JS 重写**（`async_hooks` 的 `async_wrap`、`string_decoder` 的 JS decoder binding 都是这个套路）。剩下的大缺口是根本无浏览器故事的那些（`http2`、`dgram`、`tls`/`_tls_*`、`cluster`、`worker_threads` 背后的**真线程**、`inspector`、`repl`、`wasi`、`sqlite`、`sea`），以及值得做的 native 层重写（`internal/util/inspect.js`、`internal/util/types.js`、`internal/fs/*`）。`vm` 已经是真的 `lib/vm.js`（下面垫一层 JS 复刻的 V8 context），`worker_threads.Worker` 则是同 loop 的协作式工作器（真消息、真生命周期与真 stdio，无并行）；`internal/errors` 已覆盖 vendored 模块实际取用的每一个码，并有回归测试兵护。Node 核心模块里只剩 `tls` 是纯报错桩。

## 改动约定

1. 改完先跑 `npm run typecheck && npm test`，保持全绿。
2. 浏览器验证清单见 `docs/DEVLOG.md` 顶部。
3. 在 `docs/DEVLOG.md` 追加一条变更记录（改了什么 / 为什么 / 涉及文件）。
