# WebContainer（StackBlitz）实现原理调研

> 调研时间：2026-09-22（实测） / 2026-09-23（成文）
> 方法：官方文档 + 在 StackBlitz 官网**开真应用实测**（`stackblitz.com/fork/node`、`/fork/http-server`），用 CDP 扒 target / 资源 / WASM 导出。
> 目的：为 web-node（浏览器内跑 Node 源码）提供对照与可借鉴点。

---

## 一句话结论

WebContainer **不是**"用 JS 模拟 Node"，而是：

1. 把 Node 的 **native 层编译成 WASM（Rust / wasm-bindgen）**；
2. JS 层**用 Node 自己的 `lib/`**（真源码）；
3. 用 **`SharedArrayBuffer` + `Atomics.wait`** 把**同步系统调用**"接"回另一个 worker 里的**内存虚拟文件系统**；
4. 网络把**端口映射成独立子域名 + 每个项目一个 Service Worker**。

它是个**精选子集**（够跑 Webpack/Vite），**不是完整 Node**。

---

## 一、安全 / 隔离模型

每个项目跑在一个**独立子域名的 credentialless iframe** 里：

```
runner iframe: https://<proj>-<hash>.w-credentialless-staticblitz.com/iframe.<hash>.html
crossOriginIsolated : true      SharedArrayBuffer : function
```

- `COEP: credentialless`：既能用 `SharedArrayBuffer`（需跨源隔离），又能嵌任意第三方资源——这是 WebContainer 能同时满足"SAB 可用"与"加载 CDN/npm 资源"的关键。
- 官方文档印证：*"每运行项目各有自己的域名，需在该域名安装 Service Worker"*；受第三方 cookie/storage 限制影响（见 [browser-config](https://webcontainers.io/guides/browser-config)）。

## 二、运行时 = Node 的 JS `lib/` + native 编译成 WASM

实测加载的模块：

| 资源 | 大小 | 说明 |
|---|---|---|
| `iframe.main.js` | 618 KB | runner 入口 |
| `filesystem-worker.js` | 503 KB | 文件系统 worker |
| `internal_bindings_bg.wasm` | 780 KB | **206 个导出** |
| `fs_bg.wasm` | 528 KB | **129 个导出** |
| `webcontainer.js` | 270 KB | 对外 API |
| `sw.js` | 216 B | 主 SW 加载壳（workbox） |

**`internal_bindings_bg.wasm` 导出（dump 实测）**：
- hash：`md4 / md5 / ripemd160 / sha1 / sha224 / sha256 / sha384 / sha512 / sha3_*`
- hmac：61 个（`hmacmd5_* / hmacsha256_* …`）
- cipher：42 个 aes（`aes*cbc/gcm`）、21 个 gcm
- kdf：`pbkdf2`（12）、`hkdf`
- 导入全部是 `__wbindgen_*` → **Rust（wasm-bindgen）编的**，不是原版 OpenSSL。

**`fs_bg.wasm` 导出**：整套 `fs` 系统调用（`open/read/readFile/writeBuffers/mkdir/rmdir/rename/realpath/opendir/lseek/ftruncate/…`）+ **`createSocket`**（虚拟 TCP）。

**关键缺失（对手短板）**：wasm 里**没有** `rsa / ecdsa / ed25519 / x509 / asn1 / scrypt`。
→ WebContainer 只做"跑得动前端构建工具"的子集；非对称 / X509 这类**没有**。

## 三、同步 syscall 的秘诀：SAB + Atomics

- `crossOriginIsolated=true`，`SharedArrayBuffer` / `Atomics.wait` 均在。
- 把 **14 个 worker** 逐个 `Runtime.evaluate` → **全部超时**，因为容器**主线程正卡在 `Atomics.wait`** 上同步等 `filesystem-worker`。
- 这就是浏览器里能提供**真·同步 `fs.readFileSync`** 的手法：
  主线程 `Atomics.wait(sharedBuf, …)` 阻塞 → FS 在另一个 worker 里处理 → `Atomics.notify` 唤醒。
- 工程前提：**跨源隔离（COOP/COEP）→ 才能用 SAB**。官方 [browser-support](https://webcontainers.io/guides/browser-support) 也强调此点。

## 四、端口 → 独立域名 + Service Worker（最精妙的一环）

`http-server` 模板（`listen(8080)`）实测：

```
iframe         https://<proj>--8080--<hash>.local-credentialless.webcontainer.io/
service_worker https://<proj>--8080--<hash>.local-credentialless.webcontainer.io/.localservice@service.worker.js
service_worker https://stackblitz.com/sw.js                          ← 主 SW（workbox，216B 壳）
shared_worker  https://stackblitz.com/.localservice@preview.shared_worker.js   (PreviewRelay)
```

链路：容器里 `listen(8080)` →
**把端口编进一个唯一子域名**（`…--8080--<hash>.local-credentialless.webcontainer.io`）→
在该域名**再注册一个 DevServer Service Worker** 拦截所有请求、从**内存 FS** 取资源返回。

好处：站点根相对路径、刷新、离线访问、cookie 作用域全部对得上（路径式路由 `/preview/3000/` 会踩这些坑）。代价：需通配 DNS + 动态注册 SW。

## 五、文件系统：纯内存

runner iframe 里 `navigator.storage.estimate()` → **usage ≈ 22 KB、OPFS 0 条目**。
→ FS 就是 **WASM 内存**，不落盘（所以每次 refresh 都是"干净"的）。

---

## 六、对照 web-node（现状）

| 维度 | WebContainer | web-node |
|---|---|---|
| native 层 | C/OpenSSL 逻辑**编译成 Rust→WASM**（`internal_bindings_bg` + `fs_bg`） | **纯 JS 重写** native，逐字节对齐 OpenSSL / 真 Node |
| 覆盖度 | **精选子集**（无 RSA/EC/x509；wasm 里确实没有） | 表面更宽；缺失处**响亮抛错**，绝不静默伪造 |
| fs 同步 | 主线程 `Atomics.wait` + worker 托管 FS（需 SAB/COI） | 同 realm 内实现（单线程，简单，不阻塞 UI） |
| 端口映射 | **`<proj>--<port>--<hash>.local-credentialless.webcontainer.io` + 独立 DevServer SW** | `/preview/<port>/` **路径式**路由 |
| 隔离 | credentialless iframe + 每项目子域 | 单页沙箱 |

## 七、给 web-node 的可借鉴点

1. **端口用子域名而不是路径**：路径式 `/preview/3000/` 对站点根相对路径、cookie、SW scope 都会踩坑；WebContainer 的子域名 + DevServer SW 更通用（代价：通配 DNS + 动态注册 SW）。
2. **要真·同步 fs 且不阻塞 UI**：SAB + `Atomics.wait` + FS-worker 是标准答案；同 realm 版够用，但一旦要真并发就绕不开（且需要跨源隔离 COOP/COEP）。
3. **native 层的两种路线取舍**：WebContainer 走"native→Rust→WASM"（真实但体积大、需编译链）；web-node 走"纯 JS 重写 native"（可读、可差分对齐、体积小，但需自己保证与 OpenSSL 逐字节一致）。两条路都能跑构建工具，差异在**覆盖度 vs 体积/可维护性**。

---

## 八、专项：`module.stripTypeScriptTypes` / TS 类型剥离怎么做的（M97.1 对标）

> 实测时间 2026-09-23；实测环境：StackBlitz `stackblitz.com/fork/node`（WebContainer 内 Node 报 **v22.22.3**），在该容器终端直接跑 `node`。

### 8.1 它能做（行为与真 Node strip-only 一致）

- **`.ts` 文件原生可跑**：`node t.ts` → `TSFILE 42`，exit 0。
- **`require('module').stripTypeScriptTypes` 存在**，输出与 Node **strip-only** 语义一致（类型→空格、列保真）：

| 输入 | WebContainer 输出 | 真 Node v26.9.0 |
|---|---|---|
| `const x: number = 1;` | `"const x         = 1;"` | 同 ✅ |
| `const x = 1 as number;` | `"const x = 1          ;"` | 同 ✅ |
| `enum E{A}` | `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` | 同 ✅ |
| `function f<X>(x: X): X {...}` | `"function f   (x   )    {...}"` | 同 ✅ |
| `class C { x: number = 1 }` | `"class C { x         = 1 }"` | 同 ✅ |
| `const v = 1 satisfies number` | `"const v = 1                 "` | 同 ✅ |
| `import type { A } from './a'` | `"                            "`（整句抹成空格） | 同 ✅ |
| `{mode:'transform'}` | 返回字符串（**不报错**） | `ERR_INVALID_ARG_VALUE` ❌（版本差异） |

→ 它实现的是一套**真 TS 感知**的剥离器（覆盖 interface / 泛型 / class 字段 / `satisfies` / `import type` / enum 报错），**不是** naive 正则。`mode:'transform'` 差异来自 Node 版本（v22.22.3 vs v26.9.0），非实现差异。

### 8.2 关键：**没有用 amaro / SWC 的 WASM**

在 WebContainer 里逐个 dump 资源：

- **全部 wasm 只有 3 个**：`fs_bg`(540KB)、`internal_bindings_bg`(797KB)、`storage_slab_bg`；
  - 前两个逐字节扫字符串：**0 处 `amaro` / `swc` / `TypeScript`**（只有 wasm-bindgen 的 crypto/fs 符号）。SWC 的 TS wasm 是 ~5MB+，也不可能塞进 797KB。
- **所有 JS 资产**（`iframe.main` 618KB / `filesystem-worker` 503KB / `wc-engine` 615KB / `engineworker` 131KB）：**0 处 base64 wasm 魔数 `AGFzbQ`**、**0 处** `amaro`(`2` 处均在 `process.config` 构建配置 dump 里) / `ts-blank-space` / `sucrase` / `esbuild` 等库名。
- **每个 worker 的 `performance.getEntriesByType('resource')`**：跑完 `node t.ts` 与 `stripTypeScriptTypes` 后，**从未出现任何 TS 解析器 wasm**。
- 它仍在 `process.config.variables` 宣称 `node_use_amaro: true`、`node_builtin_shareable_builtins` 含 `deps/amaro/dist/index.js`——**这只是从上游 Node 抄来的 build-config 元数据，不代表真用了 amaro**。

### 8.3 结论（对 web-node M97.1 的意义）

- **WebContainer 选的是「纯 JS 自实现 strip-only」路线（= 我们的选项 B），没有 vendor amaro 的 wasm**——这也解释了它运行时只有约 1.1MB（而非 +5MB 的 SWC wasm）：**体积优先**。
- 它证明**纯 JS 可行**且能覆盖常见 / 中等复杂度 TS 语法（interface、泛型、`satisfies`、`import type`、enum 报错）。
- 但它 Node 是 **v22.22.3**、是**自研精简 runtime**，**不承诺与 v26.9.0 逐字节一致**；我们要求「逐字节 0 diff」，风险在边角：**注释 / 字符串 / 模板串 / 正则 / JSX 里的「像类型」的字符不能误伤**、错误码与消息要精确。这是纯 JS 方案的主要工作量与风险点。

> 附：`process.config.variables.node_builtin_shareable_builtins` 实测（WebContainer 内）：
> `["deps/cjs-module-lexer/lexer.js","deps/cjs-module-lexer/dist/lexer.js","deps/undici/undici.js","deps/amaro/dist/index.js"]`

## 附：官方来源

- 介绍文（Google I/O 发布）：https://blog.stackblitz.com/posts/introducing-webcontainers/
- API 文档 · Introduction：https://webcontainers.io/guides/introduction
- 浏览器配置（SW 跨域限制）：https://webcontainers.io/guides/browser-config
- 浏览器支持（COOP/COEP / SAB）：https://webcontainers.io/guides/browser-support
- Firefox 支持篇（WASM 化细节）：https://blog.stackblitz.com/posts/webcontainers-are-now-supported-on-firefox/

---

## 九、逐条对照：web-node 当前 5 项「限制」在 WebContainer 怎么做（2026-09-24 调研）

> 起因：向唐工盘点 web-node 现状时列了 5 项限制，唐工要求「去调研 WebContainer 是怎么做的」。
> 方法：官方文档/博客（webcontainers.io、blog.stackblitz.com、`@webcontainer/api` README）+ emnapi/napi-rs 官方生态 + bolt.diy 社区文档。
> 标注：**已证** = 有官方/一手来源；**推断** = 由架构与来源导出的合理推论，未获官方明述。

### ① 一部分 TS 等价实现 / 一部分虚拟 / 32 个 binding 刻意不提供

**WebContainer 的做法：不是「补全」，而是「划一条够用的线」，缺口交给纯 JS 生态。**

- 它只把**构建工具真正用到的 native 面**编进 wasm：`internal_bindings_bg.wasm`（crypto 的 hash/hmac/cipher/kdf）+ `fs_bg.wasm`（fs 系统调用 + `createSocket`）。**已证**（我们 2026-09-23 实测 dump）。
- 覆盖度**比 web-node 窄**：wasm 里**没有** rsa/ecdsa/ed25519/x509/asn1/scrypt——即「非对称 / 证书」整块没有。**已证**。
- native 层用 **Rust（wasm-bindgen）重写**，不是编原版 OpenSSL/C。**已证**（导入全是 `__wbindgen_*`）。
- Node core 之外的「系统能力」缺口，**不在容器里补，而是换纯 JS 生态包**：git → `isomorphic-git`（容器无 `git` CLI）；sqlite → `libsql`/纯 JS 实现（无 better-sqlite3 原生二进制）；python → 只有标准库、无 pip。**已证**（bolt.diy 社区文档）。
- **对 web-node 的启示**：这条路线我们**已经走得更远**（表面 67 模块差分清零、crypto 覆盖到 RSA/EC/X509/ML-KEM，且是**真上游 C 编 wasm**）。差别在「缺失时的姿态」：WebContainer 是「面更小、够用就行」；我们是「面更宽 + 缺失处响亮抛错」。两种都合理；我们的差异点应**保持**（更大覆盖 + 显式报错），不必学它缩面。

### ② 没有内核/libuv、虚拟 TCP、dns 只解析到回环

**WebContainer 分两半：入站全虚拟，出站走真网络。**

- **入站（你 `listen()` 的服务）**：`virtualized TCP network stack mapped to ServiceWorker API, running completely locally`，**离线也能跑**；端口编进 `…--<port>--<hash>.local-credentialless.webcontainer.io` 子域 + 每端口一个 DevServer SW，从内存 FS 供给。**已证**（官方博客 + 我们实测）。
- **出站（你 `fetch`/`http` 出去）**：`WebContainers can fetch from the internet (they run in your browser, so they have your browser network access)`——即**借浏览器自己的网络**，故受 CORS 约束；npm registry / 私有包走 **StackBlitz 托管的 proxy 与 server-side 加速**（`@webcontainer/api relies on hosted proxies and server-side acceleration`）。**已证**（社区 FAQ + 官方 README）。
- **dns**：无官方明述。**推断**——出站 DNS 由浏览器/宿主 proxy 解析；容器内虚拟网络只认自己的端口/子域。
- **对 web-node 的启示（真差距）**：我们的 `net`/`dns` **只有入站虚拟 + 回环**，**没有出站到真互联网**。若要让页内程序真连外网，可照此：把沙箱 `fetch`/socket 桥到宿主 `fetch`（受 CORS），registry 类需求走一个受控 proxy。这条比 rspack 更「用户可感」，可考虑排进路线图。

### ③ 加载不了 native addon（`.node`）——也是 rspack 的前置

**WebContainer 同样「不能执行任意 native 二进制」**：无 gcc/rustc/make/cmake，**不能加载/编译 `.node`**。**已证**（bolt.diy 系统提示明写）。

**它的出路不是「让容器能编 native」，而是「让 addon 作者预先产出 wasm 版」：**

- **`emnapi`**：Node-API 的 wasm 实现（Emscripten / wasi-sdk / clang wasm32），README 明写 **「enables many Node.js native addons to run on StackBlitz's WebContainer」**，也是 **napi-rs 的 WebAssembly 特性**底座。**已证**。
- 因此「native addon」在 WebContainer 里 = **包自带 `wasm32-wasi` / `wasm32-unknown-unknown` 构建**（napi-rs 生态大量包已发 `*-wasm32-wasi`）。运行时只**实例化 wasm**，从不加载 `.node`。**已证**。
- **rspack 正是如此**：官方发 **`@rspack/binding-wasm32-wasi`**（含浏览器入口 `rspack.wasi-browser.min.js`，基于 `@emnapi/core` + `@napi-rs/wasm-runtime`）。**已证**。→ 我们要跑 rspack，**不需要**实现 native-addon 加载，只需要一个能实例化该 wasm 的 **WASI 宿主（+ 线程，若该构建需要）**；而阶段 H 已有 SAB/Atomics，WASI 宿主也在 M115 起就有了最小实现。**这是 M121 rspack 一侧的正解。**

### ④ 不做真 TLS 握手（https 只是同名壳）

- WebContainer 官方文档**未**描述容器内做 TLS 握手。
- **推断**：入站预览是 `*.webcontainer.io` 的**真 HTTPS**——证书在 **StackBlitz/边缘**终止；出站 TLS 由**浏览器或 StackBlitz proxy** 完成。**容器内任何一层都不跑握手**，`https` 只是「安全传输已由平台保证」的同名面。→ 与我们做法**一致**（我们记录 TLS 材料、不握手）。这条**不算我们的独有短板**，是这类架构的共性。

### ⑤ 「32 个 binding 刻意不提供 → 响亮抛错」

- 同 ① 的哲学：WebContainer 是**精选子集**，不追求「完整 Node」；缺口用**纯 JS 生态替代**而非在容器内实现（git/sqlite/…）。**已证**。
- **对 web-node**：我们的「缺失即响亮抛错、绝不静默伪造」在**保真度**上更严；要不要像它那样**同时给出纯 JS 替代路径**（如内置 `isomorphic-git` 类 fallback），是产品取舍，不是架构必需。

### 汇总对照

| web-node 现状 | WebContainer 怎么做 | 我们该不该动 |
|---|---|---|
| native 层部分 TS 等价/虚拟；32 binding 刻意不提供 | 面更窄的精选子集；缺的口子换纯 JS 生态包 | 不必缩面；可考虑给关键缺口配纯 JS fallback |
| 网络只有入站虚拟 + 回环，**无真出网** | 入站虚拟(SW, 可离线) + **出站走浏览器真网络/托管 proxy** | **可借鉴**：桥到宿主 fetch（受 CORS），registry 走受控 proxy |
| 加载不了 `.node` | 同样不能；改用 **emnapi/napi-rs 预编译 wasm** | **正解**：rspack 直接上 `@rspack/binding-wasm32-wasi` + WASI 宿主 |
| 不做真 TLS 握手 | 同（边缘终止 + proxy） | 不动，属共性 |
| 32 binding 抛错 | 精简子集 + 生态替代 | 保持「响亮抛错」；可选纯 JS fallback |

### 一手来源（本轮）

- 官方博客《Introducing WebContainers》<https://blog.stackblitz.com/posts/introducing-webcontainers/>（virtualized TCP + ServiceWorker + offline）
- 官方文档 Introduction <https://webcontainers.io/guides/introduction>
- 官方 API Reference <https://webcontainers.io/api>（`boot`/`spawn`/`on('port'|'server-ready')`；无 native addon/网络实现细节）
- COOP/COEP <https://webcontainers.io/guides/configuring-headers>
- `@webcontainer/api` README（hosted proxies / server-side acceleration）<https://www.npmjs.com/package/@webcontainer/api>
- emnapi 文档 <https://emnapi-docs.vercel.app/guide/>（Node-API for Emscripten/wasi-sdk；WebContainer 场景）
- `@rspack/binding-wasm32-wasi`（浏览器入口）<https://www.jsdelivr.com/package/npm/@rspack/binding-wasm32-wasi>
- bolt.diy 环境限制（无 native 二进制 / 无 git / python stdlib-only）<https://deepwiki.com/stackblitz-labs/bolt.diy/6.2-environment-constraints-and-limitations>

---

## 十、活体探针实测（2026-09-24）——并修正第九节中基于文章的结论

> 起因：唐工质疑第九节「只看文章、没开真容器」。本节是**真开一个 WebContainer 并逐条实测**的结果。
> 复现：`docs/webcontainer-probe/`（`server.mjs` 起带 COOP/COEP 的本地页 → `index.html` 从 esm.sh 载 `@webcontainer/api@1.6.0` → `WebContainer.boot()` → `fs.writeFile`+`spawn('node',…)` 跑 `probe*.cjs`）。
> 环境：Chrome 153（宿主 macOS arm64）；`crossOriginIsolated: true`；`boot()` **5.1s**；容器 Node **v22.22.3**，`process.arch= x64 / linux`。

### 10.1 运行时拓扑（CDP target 列表实测）

| target | 作用 |
|---|---|
| `https://<workdir>.w-corp-staticblitz.com/iframe.d5306e6f.html` | runner iframe（用 COEP:credentialless 时域名是 `w-corp-*`） |
| `https://stackblitz.com/headless?version=1.6.0` | **宿主侧 iframe（stackblitz.com 源）** |
| `Node.js Worker PID 2 … 22`（blob，staticblitz 源） | **每个「进程」= 一个独立 Web Worker** |
| `Fetcher Worker`（blob，**stackblitz.com 源**） | **出站网络的执行点** |
| `PreviewRelay`（shared worker，`stackblitz.com/.localservice@preview.shared_worker.d5306e6f.js`） | 预览转发 |
| `File System Worker` / `FS Worker`（`filesystem-worker.d5306e6f.js`） | 文件系统 |

- `process.versions.webcontainer = d5306e6f`，与 `iframe.d5306e6f.html` 同 hash → 版本标识一致。

### 10.2 它到底跑的是什么（**推翻第九节的判断**）

`Object.keys(process.versions)` 实测：
```
node,acorn,ada,amaro,ares,brotli,cjs_module_lexer,cldr,icu,llhttp,modules,
napi,nbytes,ncrypto,nghttp2,openssl,simdjson,simdutf,sqlite,tz,undici,
unicode,uv,uvwasi,v8,zlib,zstd,webcontainer
```
→ **它是「真 Node.js 编译到 wasm」（libuv 走 `uvwasi`），不是「Rust 重写的窄子集」**。第九节说的「Rust(wasm-bindgen) 重写、面更窄」**不准确**：`fs_bg.wasm`/`internal_bindings_bg.wasm` 是**宿主 syscall 垫片**，OpenSSL/ICU/V8/nghttp2 都编在 Node 的 wasm 里。

模块可用性实测：
- ✅ `http2`、`node:sqlite`、`tls`、`dgram`、`dns`、`inspector`、`v8`、`node:sea`、`node:wasi`
- ❌ `node:quic`、`node:ffi` → `ERR_UNKNOWN_BUILTIN_MODULE`
- （`process.binding('http2'|'sqlite'|'napi'|'wasi'|'ffi'|'sea'|'quic')` 报 “No such module”，但这是现代 Node 本就从 legacy binding 表移走的正常现象，JS 层仍可 `require`。）

### 10.3 native addon：**`ERR_DLOPEN_DISABLED`**（实测）

```js
require('/tmp/x.node')  // → ERR_DLOPEN_DISABLED
```
`process.dlopen` 存在但是**被明确禁用**。→ 与第九节方向一致：`WebContainer 不能加载 `.node``；出路是 **Node-API（`process.versions.napi` 在）的 wasm 生态（emnapi / napi-rs wasm）**。rspack 走 `@rspack/binding-wasm32-wasi` 的判断**成立**。

### 10.4 网络：**入站虚拟 + 出站经「托管 proxy / 宿主源 Fetcher Worker」**（实测）

- **DNS 分配假 IP**：`example.com→1.0.0.2`、`registry.npmjs.org→1.0.0.3`、`api.github.com→1.0.0.1`、`httpbin.org→1.0.0.4`、`google.com→1.0.0.5`（**每个域名一个 `1.0.0.x` 哨兵 IP**）。`dns.getServers()===[]`；**无 `/etc/hosts`、`/etc/resolv.conf`**。
- 裸 TCP 连哨兵 IP：`remoteAddress` 实测为 `127.0.0.1:1`（映射到本地端点）。
- **入站**：`http.createServer().listen(0)` 后自连 `http://localhost:<port>/` → 返回 body ✅。
- **出站**：`fetch('https://registry.npmjs.org/ms')`→**200**；`httpbin.org`→200；`api.github.com`→403（缺 UA）；`cdn.jsdelivr.net`→200（`acao:*`）；**`example.com`→`fetch failed`/`ECONNRESET`（域名个例）**。
- **出站不受「我们页面」的 CORS 约束**（httpbin 无 ACAO 也 200）→ 因为**请求在 `stackblitz.com` 源的 `Fetcher Worker` 里发出**（官方 README：`relies on hosted proxies and server-side acceleration`）。
  → **修正第九节**：我上轮引社区 FAQ 说「出站受浏览器 CORS 约束」**不成立**（至少 1.6.0 不是）；正确表述是「出站走 StackBlitz 托管 proxy，由平台侧发出」。

### 10.5 TLS：**不做真端到端握手**（由推断 → **实测证实**）

```js
tls.connect({ host:'1.0.0.2', servername:'example.com', port:443 })
// → authorized === true，但 getPeerCertificate().subject === ""、issuer.CN === undefined
// https.get('https://registry.npmjs.org/ms') → 200，peer certificate 同样为空
```
→ **握手被代理终止，证书是空的/合成的**，`authorized` 是平台「声称」。第九节 ④ 的**推断成立**（且与我们 web-node「记录 TLS 材料但不真握手」本质一致）。

### 10.6 crypto：**表齐全，但异步 crypto job（线程池）不工作**（决定性）

- `crypto.getCiphers().length = 175`、`getHashes().length = 31`（OpenSSL 表齐全）
- ✅ `sha256`、`hmac`、`randomBytes`、`randomUUID`、`aes-256-gcm`、`pbkdf2Sync`
- ❌ `generateKeyPairSync('rsa'|'ec'|'ed25519')`、`crypto.sign/verify`、`scryptSync`
  → 全部抛 **`createJob(...).run is not a function` / `p.run is not a function`**

→ 精确表述：**它的 crypto 缺「job runner」，非对称/部分 KDF 直接崩**（不是我上轮说的「wasm 里没有 RSA 代码」——表其实在，**操作跑不起来**）。这对我们是**反向利好**：web-node 已实现 RSA/EC/X509/ML-KEM，是**真实差异点**。

### 10.7 其它实测

- `os.networkInterfaces()` 返回**宿主真网卡**（`en0=192.168.1.104`…）——占位/泄漏，非容器网卡。
- `worker_threads` 真起 Worker ✅（worker 也是独立 CDP target）。
- `node:wasi`、`node:sqlite` 可用（实验性警告）。

### 10.8 结论修正表（第九节 → 实测）

| 第九节说法（基于文章） | 实测结论 |
|---|---|
| ❌ native 层是「Rust 重写、覆盖更窄」 | ✅ **真 Node.js 编 to wasm（uvwasi）**，native 面≈Node 自身 |
| ❌ 出站 Fetch「受 CORS 约束」 | ✅ 出站走 **stackblitz.com 源 Fetcher Worker / 托管 proxy**，不受我们 CORS |
| ⚠️ 不做真 TLS（推断） | ✅ **实测证实**（peer cert 空、authorized 是平台声称） |
| ⚠️ native addon 用 emnapi | ✅ 方向对：**`.node` = `ERR_DLOPEN_DISABLED`**；走 Node-API wasm 生态 |
| ⚠️ 缺 32 类 binding、靠纯 JS 替代 | ⚠️ 部分对：**http2/sqlite/wasi/sea 它都有**；真缺的是 **quic/ffi + 大量非对称 crypto 操作** |

### 10.9 对 web-node 的更新建议

1. **出站网络（可借鉴，优先级↑）**：在**「宿主源」的专用 worker**（或自建受控 proxy）里发请求——既绕开沙箱 CORS 又能做 server-side 加速。注意官方 `@webcontainer/api` 依赖 StackBlitz 托管 proxy，自建需自备 proxy。
2. **进程模型**：WebContainer **1 进程 = 1 worker**（所以原生支持 fork/cluster/多进程）；我们是 **1 Run = 1 runtime worker**。若要多进程语义，这是参考架构。
3. **TLS**：两边都不做真握手（**边缘终止**），共识，不必动。
4. **crypto**：连它自己都因缺 job runner 跑不了非对称——**web-node 的 RSA/EC/X509/ML-KEM 是差异化优势**，保持并在差分里覆盖。
5. **rspack**：按 `@rspack/binding-wasm32-wasi` + WASI 宿主推进（其 `.node` 同样加载不了）。

---

## 十一、追问实测：http2 / sqlite / wasi / sea 到底怎么实现的（2026-09-24 晚）

> 唐工追问：「这四个也是 to wasm 实现的么？」
> 复现：`docs/webcontainer-probe/probe6.cjs`（功能面）、`probe7.cjs`（`--expose-internals` 内部 binding 面）、`wasi_probe.c`（用 **wasi-sdk 34.0** 编 `wasm32-wasip1` reactor）。

**核心结论：它们不是「各自单独编 to wasm」，而是「整个 Node.js（连同 native 依赖）被编成一个大 wasm」，这四个只是该 Node 构建里的模块；能不能用，取决于平台把哪条路径接通/桩掉。四个的实测状态完全不同。**

### 11.1 `node:wasi` —— **真·端到端可用**（最硬的一条）

- `internalBinding('wasi')` → `WASI` 类存在。
- 用 **wasi-sdk 34.0** 编的 reactor 模块实测：
  - `probe_add(1,2)` → **1003**
  - `wasi_env()`（`getenv("WC_PROBE")` 长度）→ **8**（`"hello-wc"`）
  - `wasi_hello()` 经 `fd_write` 真打印 **`WASI-HELLO from wasm`**，返回 **42**
- → **它把 Node 自带的 WASI 宿主（libuv 的 `uvwasi`，preview1）连进 wasm 一起跑**，是**真实现**。（也解释了我们 web-node 阶段 H 的 WASI 宿主路线是对的。）

### 11.2 `http2` —— **真 nghttp2 在，但没接通**

- `internalBinding('http2')` 表面**完整且是真 Node 形状**：`Http2Session,Http2Stream,constants,nameForErrorCode,kSession*`（字段计数常量都在）；`http2.constants` **240 项**、取值正确（`SETTINGS_TIMEOUT=4`、`NO_ERROR=0`）。
- **但**：`getDefaultSettings()` → **`{}`**（真 Node 有 `headerTableSize:4096` 等）；实际 `h2c` 自连**崩** `TypeError: n.consume is not a function @ ClientHttp2Session.setupHandle` → `ERR_HTTP2_STREAM_CANCEL`。
- → **nghttp2 编进来了、binding 壳是真的，但连接路径缺方法（`consume`）、默认参数为空** → **加载即「看起来有」，一用就崩**。

### 11.3 `node:sqlite` —— **类在、方法没挂（不可用）**

- `internalBinding('sqlite')` → `DatabaseSync,StatementSync,constants,backup`（名字齐）。
- **但** `Object.getOwnPropertyNames(DatabaseSync.prototype)` → **只有 `constructor`**（`StatementSync.prototype` 同样）。
- → `db.exec is not a function`。**壳在、方法全无**，不可用。

### 11.4 `node:sea` —— **JS 层桩**

- 表面：`isSea,getAsset,getRawAsset,getAssetAsBlob,getAssetKeys`。
- `sea.isSea()` → **`undefined`**（真 Node 是 `false`）；`getAssetKeys()` 抛的是**照抄真 Node 的文案**「Operation cannot be invoked when not in a single-executable application」。
- → **JS 占位桩**，语义未对齐。

### 11.5 汇总（实测）

| 模块 | 实现形态 | 实测可用性 |
|---|---|---|
| `node:wasi` | **真 WASI 宿主（uvwasi）编进 wasm** | ✅ **完全可用**（fd_write/getenv/导出函数全通） |
| `http2` | **真 nghttp2 编进 wasm**，binding 表面完整 | ❌ 连接崩（缺 `consume`）、默认参数空 |
| `node:sqlite` | sqlite binding 注册了类名 | ❌ `DatabaseSync.prototype` 无方法 |
| `node:sea` | 纯 JS 桩 | ❌ `isSea()` 返回 undefined |

**给 web-node 的启示**：
- 「模块 `require` 得成功」**完全不能**当作「功能可用」——WebContainer 里 `http2`/`sqlite` 就是「加载 OK、一用就崩/不存在」。这**反向印证我们「缺失即响亮抛错、不静默伪造」的取向更诚实**（虽然我们更严格，会让 `require` 就失败而非运行期崩）。
- **WASI 可用**说明「真上游 C/C++ → wasm + 最小 WASI 宿主」是被验证可行的路线 → 我们的 `wasm/wasi.ts` 路线正确，可继续扩（也是 rspack `binding-wasm32-wasi` 的前置）。
- **http2/sqlite 的半成品**提醒：若我们要实现这类，**差分要以「行为」为准**（我们现有 67 模块行为差分的方法正好挡住这种"表面在、行为错"）。
