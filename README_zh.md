# web-node

在浏览器里跑 Node.js 源码（WebContainer 式运行时）。

[![在线 demo](https://img.shields.io/badge/%E5%9C%A8%E7%BA%BF%20demo-mcuking.github.io%2Fweb--node-5ef1a5)](https://mcuking.github.io/web-node/)

[English](README.md) · **简体中文**

- **在线 demo**：<https://mcuking.github.io/web-node/>（装依赖、跑 demo 项目、点 **⚡ Vite build**，全在标签页里）
- **开发日志 / 进度 / 下一步**：`docs/DEVLOG.md` ← **每次改动都往这里追加**
- 设计文档：`docs/superpowers/specs/2026-09-17-web-node-design.md`
- 上游源码：`/Users/tangjianghong/Downloads/node`（Node.js v26.9.1）

## 开发

> ⚠️ 用 fnm 的独立 Node v22.19.0，不要用 ClawHive 内置 Electron Node
> （Electron Node 会让 rollup 原生模块 dlopen 代码签名失败）。

```bash
export PATH="/Users/tangjianghong/Library/Application Support/fnm/node-versions/v22.19.0/installation/bin:$PATH"

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

响应到浏览器也是**真流式**：SW 直接把 `ReadableStream` 交给浏览器，`res.write()` / SSE / 大文件
边产生边到达（HTML 例外，为注入 `<base>` 先缓冲）。连接默认 keep-alive，服务端支持 pipelining，
客户端按端口做连接池。`https` 是 `http` 的同名壳（虚拟网络无 TLS）。

## npm（M4）

点顶栏 **⬇ Install deps**：客户端会读项目 `package.json`，向 npm registry 解析依赖版本，
下载 tarball 后 gunzip + untar 写入虚拟 `node_modules`（顶层 hoisting，仅在版本冲突时嵌套），
之后普通 `require` 就能拿到：

```js
const ms = require('ms');
ms(60000); // '1m'
```

未支持：生命周期脚本、`.bin` shim、peer 依赖自动安装、lockfile 读写、integrity 校验。

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
把 **loopback** URL 改道到 `BroadcastChannel`；runtime 交给 Vite 一个 HMR 服务器对象，
其 `send()` 走该通道而非 socket。**Vite 照常计算所有更新，我们只负责搬运**。另有一个小 Vite 插件
把 VFS 变更事件转成 Vite watcher 事件（标签页里没有 inotify），所以编辑源文件会触发真正的
`js-update`：点 **✏️ HMR edit**，预览**原地重渲染**，不整页刷新。

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

## 改动约定

1. 改完先跑 `npm run typecheck && npm test`，保持全绿。
2. 浏览器验证清单见 `docs/DEVLOG.md` 顶部。
3. 在 `docs/DEVLOG.md` 追加一条变更记录（改了什么 / 为什么 / 涉及文件）。
