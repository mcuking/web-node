# DEVLOG — web-node

> 开发日志 + 进度快照。**每次改动都往这里追加一条**，让下次开工能 30 秒内知道「做到哪了 / 下一步从哪开始」。
>
> - 追加规则：新条目写在最上面 `## 变更记录` 区域顶部（倒序），一条一段，包含 **改了什么 / 为什么 / 涉及文件**。
> - 每隔一段把「当前状态」和「下一步」两节更新一次，保证它始终反映最新事实。

---

## 当前状态

**阶段**：M4 npm client 已落地（registry 解析 + tarball 解包 + npm 式 hoisting 写入 VFS），并在真实浏览器从公共 registry 安装 `ms` 验证通过。下一步是 M3.5 网络收敛或 M5 真实构建工具。

| 里程碑 | 内容 | 状态 |
|---|---|---|
| M1 | 纯 JS 运行层（realm / bindings / module loader） | ✅ 完成 |
| M2 | 虚拟文件系统（内存树 + OPFS 持久化） | ✅ 完成 |
| M3 | 网络（虚拟 TCP + ServiceWorker 桥 + 预览） | ✅ 完成（基础版） |
| S | **stream 前置**（Readable/Writable/pipe/背压 + chunked） | ✅ 完成 |
| M4 | **npm client**（registry + tarball + node_modules 写入） | ✅ 完成 |
| M3.5 | 网络收敛（子域名路由 / keep-alive / https） | ⬜ 未开始 |
| M5 | 真实构建工具（vite / webpack） | ⬜ 未开始 |

**质量门禁**：`tsc --noEmit` 干净 · `vitest run` **61/61 通过** · `vite build` 绿（worker ~230KB / index ~7.5KB / css ~4.1KB）

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
- 预览走路径前缀 `/preview/<port>/`，不是 `<port>.localhost`。绝对路径资源（`/app.js`）会落在前缀外；HTML 响应会注入 `<base>` 修正**相对路径**资源。
- HTTP/1.1 每次连接只处理一个请求（`Connection: close`），无 keep-alive、无 TLS。
- 响应在服务端是真流式的（无 `Content-Length` 就按 chunked 分帧），但 SW 桥会把整个 body 收齐再回给浏览器，所以**浏览器侧看不到逐段流式**（要真正流式需要 SW 直接转发 ReadableStream，属 M3.5）。
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

1. **M3.5 网络收敛**：
   - **子域名路由**：`<port>.localhost:5199` 替代路径前缀 → 绝对路径资源正确。需要：Vite `server.allowedHosts: ['.localhost']`；预览页需要在子域名下注册自己的 SW。
   - **keep-alive**：`HttpMessageReader` 每个连接只读一条消息（读完 body 就 `done`），要改成连接循环 + `Connection: keep-alive`。
   - **浏览器侧真流式**：SW 目前把 body 收齐再回；要让 `res.write()` 逐段到达浏览器，需要把 runtime 的 chunk 流经 MessageChannel 推给 SW 并用 `ReadableStream` 组装 Response。
   - **`https`**：直接 `notImplemented` 或复用 http 的模块壳。
2. **M5 真实构建工具**：跑通 vite/webpack（依赖 M4 的 node_modules + M3.5 的资源路由）。
3. **npm 收尾**：lockfile 读写、`.bin` shim、peer 依赖自动安装、integrity 校验、生命周期脚本、`file:`/`git+` 说明符。
4. **扩大 vendoring**：把 TS 实现逐步换成真源码 + shim（先 `node tools/dep-scan.mjs` 估算）。
5. **stream 收尾**：`read(n)` 字节精确切分、`autoDestroy` 细节、`objectMode` 边界。
6. **Buffer slice 语义**：目前是拷贝而非共享内存（见设计文档「已知限制」）。

---

## 变更记录

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
