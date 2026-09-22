# ROADMAP — web-node 路线图

> **用途**：一份**固定、可追溯**的任务清单，回答两个问题——「现在坐到哪了？」「还剩多少任务？」
> 与 `docs/DEVLOG.md` 的分工：DEVLOG 记**已发生**的变更（倒序流水）；ROADMAP 记**还没做**的事（正序规划）。每完成一项，在这里打勾并把成果写进 DEVLOG。
>
> - **状态图例**：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 已完成 · `[-]` 不做（有意不做 / 死路，附理由）
> - **编号**：沿用里程碑号 `M88` 起。已完成的 `M1–M87` 见文末「已完成总览」。
> - **验收标准（每项都适用）**：① 差分语料对真 Node v26.9.0 **0 diff**；② `npm run typecheck` 干净；③ `npx vitest run` 全绿；④ `npm run build` 记录 worker 体积；⑤ 部署 gh-pages 且线上资产 200；⑥ 更新 DEVLOG + memory；⑦ 不能对真的东西响亮抛 `NotImplementedError`，绝不静默伪造。
> - **最后更新**：2026-09-22（基线 = M90.4 完成）

---

## 进度总览

| 阶段 | 主题 | 任务数 | 已完成 | 剩余 |
|---|---|---|---|---|
| A | crypto 收尾（接续 M87） | 11 | 6 | 5 |
| B | 语义深度（差分语料继续扩面） | 4 | 0 | 4 |
| C | 平台无对应物的补齐（选择性） | 3 | 0 | 3 |
| D | 运行时常量小项收尾 | 4 | 0 | 4 |
| E | 性能路线（wasm / 共享内存） | 2 | 0 | 2 |
| F | 构建工具链（**用户愿景，最后做**） | 5 | 0 | 5 |
| — | 已判定不做 | 1 | — | — |
| **合计** | | **30** | **6** | **23**（+1 不做） |

> 加上已完成的 **M1–M87**，项目整体：**已完成 93 个里程碑，剩余 23 个规划任务（其中 5 个是 webpack/rspack 构建工具链，排最后）**。
> 注：M90 于 2026-09-22 拆为 M90.1–M90.5（任务数 26 → 30）。

---

## 阶段 A — crypto 收尾（接续 M87）

> 现状：非对称半边（RSA/EC/Ed25519/ECDH/DH/X509）已在 M83–M87 完成。剩下的都是「还没做的算法/API」。

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

- [ ] **M90 · `createMac` / `getMacs`**（拆为 M90.1–M90.5）
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

- [ ] **M90.5 · 补齐 `getHashes` 面**（M90.1 发现的新缺口）
  > **发现原因**：实现 M90.1 时发现 web-node 的 `crypto.getHashes()` 只覆盖 md5/sha1/sha224/256/384/512，而真 Node 还包含 `sha3-224/256/384/512`、`blake2b512`/`blake2s256`、`sm3`、`ripemd160`（及变体）。这也意味着 `createHmac('ripemd160')`、`createHash('sha3-256')` 目前都会响亮抛错（与 Node 不一致）。
  - 需新增：SM3、RIPEMD-160；BLAKE2b-512 / BLAKE2s-256 现已就绪（`blake2b.ts` / `blake2s.ts`，M90.1/M90.4）；SHA-3 已随 **M90.2** 落地（`keccak.ts` 已含 sha3-224/256/384/512 + shake，只待接进 `DEFS`）。
  - 同步把新名字加入 `listHashes()`，并加 `getHashes()` 差分门禁。
  - 风险：中低。

- [ ] **M91 · 后量子 KEM**
  - `encapsulate` / `decapsulate`（ML-KEM / Kyber）。
  - 纯 JS 实现 ML-KEM（FIPS 203），或明确评估代价后再定。
  - 风险：高（代码量大、向量多）。**优先级最低，可后置或砍。**

- [ ] **M92 · DH KeyObject 派生**
  - `crypto.diffieHellman({ privateKey, publicKey })`——基于 DH `KeyObject` 的共享密钥派生（M85 记的已知偏离，目前抛错）。
  - 风险：低（复用 M85 的 `dh.ts` 模幂）。

- [ ] **M93 · 更多对称密码**
  - 目前未实现（抛 `NotImplementedError`）：DES / 3DES / ChaCha20-Poly1305 / CCM / OCB / SIV / XTS / wrap 系列；以及 Camellia / ARIA / SM4。
  - 建议顺序：**ChaCha20-Poly1305**（用得最多、规范清晰）→ **DES/3DES**（老但有固定向量）→ CCM → 其余按需求。
  - 风险：低–中（ChaCha20-Poly1305 是 RFC 8439，纯 JS 可控）。

- [ ] **M94 · `crypto.Certificate`**
  - Node 已弃用的 `crypto.Certificate` 类（`verifySpkac`/`exportPublicKey`/`exportChallenge`）。
  - 基于 M87 的 `x509.ts`/`der.ts`。目前是响亮抛错的桩（M87 保留）。
  - 风险：低。

---

## 阶段 B — 语义深度（差分语料继续扩面）

> 已做：`http`(M79) · `net`(M80) · `fs`(M81) · `crypto` 非对称(M83–87)。方法固定为「同一观测程序在真 Node 与 web-node 各跑一遍，JSON 逐字段相等」。

- [ ] **M95 · `net` 连接生命周期与超时**
  - 连接状态机、`connect`/`timeout`/`error` 事件序、`socket.setTimeout`、半开连接、`allowHalfOpen` 语义的差异对齐。

- [ ] **M96 · `fs` 错误形状补全**
  - 把剩余 ENOENT/EACCES/EISDIR/ENOTDIR 等路径的错误码、`syscall`、`path`、`errno` 逐字对齐真 Node（VFS 层）。

- [ ] **M97 · `module` 语义**
  - `registerHooks`（同步 loader hooks）、`stripTypeScriptTypes`（需 TS transform）、`SourceMap` 的注册/查找语义、`_load`/`_findPath` 的 loader 面。
  - 现状：`module.ts` 里这些是响亮抛错或返回 `undefined`；按需落地。

- [ ] **M98 · `http`/`https` 报文级差分**
  - 请求/响应全流程（keep-alive、pipeline、chunked、trailer 已在 M69 部分覆盖）的端到端差分；`https` 无 TLS 加密但语义对齐。

---

## 阶段 C — 平台无对应物的补齐（选择性，代价大）

> 这些「真 Node 能、浏览器平台没有对应物」。当前是**响亮抛错**（正确姿态）。只有确有需求才做。

- [ ] **M99 · `zlib` 同步形式 + 编码参数**
  - `gzipSync`/`deflateSync`/… 与 `level`/`windowBits`/`memLevel`/`strategy`/`dictionary`/`flush()`。
  - 需要**自研纯 JS deflate/inflate**（平台 `CompressionStream` 只有异步、无参数面）。
  - 工作量：大。除非确实需要同步压缩，否则维持抛错。

- [ ] **M100 · `perf_hooks` 直方图**
  - `createHistogram`/`importHistogram`/`monitorEventLoopDelay`（需 JS 版 hdr_histogram + 统计检验）。
  - 工作量：中–大。

- [ ] **M101 · `stream/iter` 的 `transform`**
  - `internal/streams/iter/transform.js`（顶层 `internalBinding('zlib')`，native 绑定）——依赖上面 M99 的纯 JS zlib。

---

## 阶段 D — 运行时常量小项收尾

- [ ] **M102 · `net.BoundSocket`**
  - `net.BoundSocket`（`isPipe`/`fd`/`close`/`address`）——无 OS 句柄，仍是抛错桩；按需评估。

- [ ] **M103 · `http.Agent` 的连接方法**
  - `Agent#createSocket` / `Agent#createConnection`（目前抛错）。

- [ ] **M104 · `url.fileURLToPath({ windows: true })`**
  - Windows 路径形态（浏览器标签页无 Windows FS，但可纯字符串实现）。

- [ ] **M105 · `console` / `v8` inspector 面收尾**
  - `console.createTask` 的 async_hooks 链路、`v8` inspector 相关成员的最终收尾（M75 已做移植）。

---

## 阶段 E — 性能路线

- [ ] **M106 · 热点 binding → wasm**
  - 把热点（buffer/fs/crypto）替换为 wasm 实现；引入 **SharedArrayBuffer + Atomics** 做同步 syscall。
  - 前置：COOP/COEP 响应头（子域名隔离路由已就绪 M3.5d）。

- [ ] **M107 · 启动性能**
  - 缩短冷启动（模块懒加载、预编译缓存、快照）——对标 WebContainer 的「毫秒级启动」。

---

## 阶段 F — 构建工具链（**用户愿景，拍到最后做**）

> 目标：这个浏览器 Node 环境能跑 **rspack / vite / webpack** 等前端构建工具。现状：**vite 已通**（M5c–M5f，build + dev + HMR）。

- [ ] **M108 · 对齐异步 / tick 语义，跑通 webpack build**  ⚠️ 关键前置，建议排在 F 阶段首位
  - 已定位阻塞点：webpack 5 能加载、能进 `compiler.run`，卡在 `enhanced-resolve` 的模块解析（回调不推进）。
  - 根因候选：① `fs` 回调的投递时机与真 Node 不一致；② 程序结束前 pending 的 **nextTick / microtask 未排空**；③ `CachedInputFileSystem` 的「缓存命中 → `process.nextTick`」路径在此语义下停摆。
  - 顺手已修：`browser` 字段替换目标的解析基准（`78f8a59`）。
  - 验收：页内 `webpack` 生产构建产出 bundle。

- [ ] **M109 · webpack loader / plugin 生态**
  - `babel-loader` / `ts-loader` / `css-loader` / `style-loader` / `html-webpack-plugin` / `terser-webpack-plugin`。

- [ ] **M110 · webpack watch / dev-server**

- [ ] **M111 · rspack（wasm32-wasi + emnapi）**
  - 现状：核心是 Rust napi 原生插件（`.node`）页面跑不了；但官方有 `@rspack/binding-wasm32-wasi`（2.2.6，基于 `@emnapi/core` + `@napi-rs/wasm-runtime`）。
  - 需要 **WASI 宿主 + 线程（SharedArrayBuffer / COOP-COEP）**。**先做一次性 spike 验证 wasm 能否在页内初始化**，再决定投入。

- [ ] **M112 · 其他框架 / 工具链**
  - React（SWC / Babel）、Svelte、TypeScript 项目、Tailwind / PostCSS 管线。

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
- **crypto 主线**：M34 同步面 · M47 对称密码 · M83 非对称 · M84 RSA 加密 + ECDH · M85 DH · M86 对称密钥生成 + FIPS · M87 X509Certificate 真解析 · M88 素数生成/素性检验 · M89 Argon2 · M90.1 MAC（HMAC + BLAKE2b MAC） · M90.2 KMAC（Keccak/SHA-3/cSHAKE） · M90.3 CMAC/GMAC（AES） · M90.4 BLAKE2s MAC / Poly1305 / SipHash

---

## 怎么用这份文件

1. **开工前**：看「进度总览」知道还剩多少；从当前阶段往下挑第一个 `[ ]`。
2. **开工时**：把该项改成 `[~]`。
3. **完成后**：改成 `[x]`，并在 `docs/DEVLOG.md` 顶部加一条变更记录；刷新本文件「最后更新」的基线提交号与进度总览数字。
4. **新任务**：追加到对应阶段；若是新方向，开一个新阶段。
5. **不做了**：移到「已判定不做」并写理由，别删（保留决策痕迹）。
