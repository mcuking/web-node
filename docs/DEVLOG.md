# DEVLOG — web-node

> 开发日志 + 进度快照。**每次改动都往这里追加一条**，让下次开工能 30 秒内知道「做到哪了 / 下一步从哪开始」。
>
> - 追加规则：新条目写在最上面 `## 变更记录` 区域顶部（倒序），一条一段，包含 **改了什么 / 为什么 / 涉及文件**。
> - 每隔一段把「当前状态」和「下一步」两节更新一次，保证它始终反映最新事实。

---

## 当前状态

**阶段**：M5 真实构建工具已落地（**esbuild** WASM），M5b 接入 **rollup 的官方 WASM 构建**；M5c 把 **Vite 本体**跑了起来（`vite build` → VFS）；M5d 又把 Vite 的 **dev server** 在页内跑通（`createServer` + `listen` + 按需转换，预览真实渲染）；M5e 把 **HMR** 接通了——ServiceWorker 代理不了 WebSocket，于是 HMR 改走 **BroadcastChannel**；M3.5d 把预览从路径前缀升级为 **子域名真源隔离**（`<port>.localhost`，仅 dev server）。已部署到 **GitHub Pages**：<https://mcuking.github.io/web-node/>。

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
| D | **GitHub Pages 部署**（子路径站点 + gh-pages 发布） | ✅ 完成 |

**在线 demo**：<https://mcuking.github.io/web-node/>

**质量门禁**：`tsc --noEmit` 干净 · `vitest run` **100/100 通过** · `vite build` 绿（worker ~264KB / index ~8.5KB / css ~4.1KB）

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
- `Readable.read(n)` 字节模式下是「整块交付」而非精确切 n 字节（`data`/`pipe()` 路径是精确的）；objectMode 只支持基本形态。

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

1. **HMR 收尾**：CSS HMR（`updateStyle` 路径）与**多端口隔离**（一个端口一个 HMR 通道，不能共用一个 BroadcastChannel 把更新广播给所有预览）。
2. **npm 收尾**：lockfile 读写、`.bin` shim、peer 依赖自动安装、integrity 校验、生命周期脚本、`file:`/`git+` 说明符。
3. **扩大 vendoring**：把 TS 实现逐步换成真源码 + shim（先 `node tools/dep-scan.mjs` 估算）。
4. **stream 收尾**：`read(n)` 字节精确切分、`autoDestroy` 细节、`objectMode` 边界。
5. **Buffer slice 语义**：目前是拷贝而非共享内存（见设计文档「已知限制」）。

---

## 变更记录

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
