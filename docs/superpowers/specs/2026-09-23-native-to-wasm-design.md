# web-node — native → WASM 迁移设计（对齐 WebContainer 架构）

> 状态：**待评审**（2026-09-23）
> 目标编号：**B2 目标 + B1 验收**（见 §1）；技术路线：**甲（真上游 C/C++ → wasi-sdk → wasm）**
> 关联：`docs/ROADMAP.md` 阶段 C / E / F / G / **H**、`docs/webcontainer-research.md`、`docs/superpowers/specs/2026-09-17-web-node-design.md`

---

## 1. 目标、验收与路线

**架构目标（B2）**：`internalBinding()` 背后的 native 层，从「TS 手写 shim / 平台 API 适配」迁移为
**真上游 C/C++ 源码编出的 WASM 模块**；JS 层改用 Node 自己的 `lib/` 真源码。这正是 WebContainer 的形态
（`lib/` + `internal_bindings`），上层 API 与验收装置不变。

**验收闸门（B1）**：每个里程碑都必须过两关——
1. **现有差分装置 0 diff**（`tools/*-probe.cjs` + `*-oracle.mjs` + `test/fixtures/*.json`）；
2. **北极星**：页内跑通 **webpack / rspack 生产构建**。

即：**"native 层从 JS 迁到 WASM"是原则，但每一步都用"真构建工具跑通 + 差分 0 diff"来验收**，不为全量而全量。

**技术路线（甲）**：能编真上游 C/C++ 的（zlib / histogram / brotli / zstd / ada / OpenSSL 子集）一律用
**wasi-sdk（clang + wasi-libc）** 编；**syscall 层不编 libuv**，改用 WebContainer 式
**SAB + `Atomics.wait` + FS-worker**。备选路线：乙（Rust + wasm-bindgen 逐字复刻对手）、丙（分层混合，纯计算 wasm + crypto 留 JS）。
选甲的理由：**同一份上游代码编出的 wasm 天然贴合"逐字节 0 diff"验收**；乙的手工移植语义漂移风险与之直接冲突。

---

## 2. 现状与不变式

**不变（与 native 层正交，继续沿用）**：
- Realm / loader / `internalBinding` 调度表（`src/node-runtime/bindings/index.ts` 的 `REGISTRY`）；
- VFS（内存树 + OPFS write-behind）、虚拟 TCP + ServiceWorker 预览、子域名路由（M3.5d）；
- npm client（lockfile / 完整性 / peer / overrides / `file:`）；
- **全部 vendored 真 Node `lib/` 源码**（M17–M56 那一大批）——wasm 来了照用；
- UI（文件树 / 编辑器 / 终端 / 预览）。

**载体已在位**：runtime 的 globals 白名单已含 `WebAssembly`（esbuild-wasm 已在跑）；dev server 已配
**COOP/COEP**（`vite.config.ts`），SAB 前置就绪。

**将被替换的是"实现"，不是"接口/知识"**：纯 JS 重写的 native 原语（crypto、zlib shim、string_decoder、
buffer、v8 serdes …）。它们保留——① 当前是 main 上可跑可部署的版本；② wasm 编不出来时的兜底；③ 语义参照。

---

## 3. 架构

### 3.1 接入缝

`REGISTRY` 是唯一插槽。wasm 模块编好后**注册成一个 binding**（如 `zlib` / `crypto`）：它导出的函数就是
wasm exports 的 JS 包装。目前 `zlib` / `crypto` 位于 `UNSUPPORTED_BINDINGS`（刻意不提供），
B2 下把它们**移回 `REGISTRY` 并指向 wasm**。
关键收益：**差分装置不认识 JS 还是 wasm，照跑**——验收成本几乎为零。

### 3.2 产物交付与加载

- wasm 作为**独立静态资产**（仿 `vendored-sources.txt`），**文件名带内容哈希**；
- worker 里 `fetch` + `WebAssembly.instantiate`，**按 binding 惰性实例化**（不在启动期全量加载）；
- 与 vendored 源的策略一致（M107 已验证"拆分 + 预加载"路线）。

### 3.3 ABI

- 纯 **C ABI**：导出函数 + 线性内存（`malloc`/`free`）；**不引 Rust / wasm-bindgen**；
- 配一层薄 TS 适配器，把导出包装成 vendored `lib/*.js` 期望的原生 binding 形状；
- 纯计算库无需 syscall，wasi shim 近乎空。

---

## 4. 迁移顺序

> **2026-09-23 与路线图对齐**：本条即 `ROADMAP.md` 的**阶段 H**。原先散落在阶段 C/E/F/G 的条目已按此收敛——C 的 M99/M100 由 **P1/P2** 完成、M101 并入 **P1+**；E 的 M106 拆入 **P4/P5**；G 的 M114 并入 **P5**；F 的 M108/M111 汇入 **P6**。

| 步 | 内容 | 依赖 | 验收 |
|---|---|---|---|
| **P0** | 装 wasi-sdk；打通「hello wasm → `REGISTRY` binding」 | — | 桩 binding 走通 |
| **P1** | **`zlib`**：真 `deps/zlib`（1.3.2.1-motley）**编 wasm** + `builtins/zlib.ts`（`lib/zlib.js` 的 zlib 半边移植） | P0 | 差分 **0 diff**（含 `gzipSync`/`level`/`windowBits`）✅ 2026-09-23（M116） |
| **P1+** | **`stream/iter` 的 `transform`**：vendor 真 `lib/internal/streams/iter/transform.js`（顶层 `internalBinding('zlib')`，M116 后就绪） | P1 | 差分 **0 diff** |
| **P2** | **`histogram`**：真 `deps/histogram`（HdrHistogram）+ `wn_histogram.cc`（移植 `src/histogram.cc`）✅ 2026-09-23（M117） | P0 | 差分 0 diff |
| **P3** | `brotli` / `zstd`（纯计算） | P0 | 差分 0 diff |
| **P4** | **crypto → OpenSSL 子集**（hash/hmac/cipher/kdf） | P0 | 现有 crypto 差分 **保持 0 diff** |
| **P5** | **同步 syscall**：SAB + `Atomics.wait` + FS-worker | P0 | 同步 `fs` 真逐字节 |
| **P6** | 页内跑通 **webpack / rspack** | P1–P5 | **B1 北极星** |

---

## 5. 资产盘点：既往工作如何衔接

| 类别 | 内容 | 处置 |
|---|---|---|
| **地基（继续用）** | Realm/loader/`internalBinding` 调度、VFS+OPFS、虚拟 TCP+SW、npm client、UI、子域名路由、**全部 vendored 真 `lib/` 源码** | **原样保留** |
| **验收装置（最值钱）** | `tools/*-probe.cjs` + `*-oracle.mjs` + `test/fixtures/*.json`（M64–M98 + 阶段 A/B 攒的差分语料） | **原样保留，直接作为 wasm 的验收闸门** |
| **将被取代的实现（保留作 fallback/oracle）** | 纯 JS 重写的 native 原语：crypto（hash/cipher/kdf/非对称/PQC）、zlib shim、string_decoder、buffer、v8 serdes … | **不删**：① 当前可跑可部署版本；② 兜底；③ 语义参照 |
| **语义知识** | DEVLOG / MEMORY 里记的坑（SM4-XTS 的 GB 变体、GCM-SIV one-shot 报错、`internal/errors` 码表…） | **保留**——正是 wasm 移植最易踩处 |

**结论**：不是推翻重来，是**「换发动机、留仪表盘」**。

---

## 6. 风险与退路

1. **OpenSSL → wasm 最重**（5063 文件 / 246M）：需 `--no-asm` + 裁 provider。若编不动，P4 退回
   「JS crypto 保留 + wasm 只补缺」，并**显式报告**而非硬上。
2. **体积**：OpenSSL wasm 可能数 MB，与当前 665KB worker 冲突 → **必须独立资产 + 惰性加载**（§3.2）。
3. **0 diff 边界**：同一份 C 代码数值应一致，但 wasi 的整数/浮点边角行为要逐项验。
4. **SAB / COEP**：P5 需跨源隔离；dev 已配，线上 gh-pages 需确认 COOP/COEP 头。

---

## 7. 开放问题

- P5 的 FS-worker 与现有 **同 realm VFS** 如何共处（双栈并存 or 替换）？
- wasm crypto 与现有 JS crypto 的**切换开关**（灰度 / 回退）？
- `getCiphers()` 等**表面常量**由 wasm 导出还是 TS 常量表维护？
