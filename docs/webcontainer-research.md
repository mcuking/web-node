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
