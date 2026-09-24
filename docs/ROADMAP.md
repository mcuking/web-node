# ROADMAP — web-node 路线图

> **用途**：一份**固定、可追溯**的任务清单，回答两个问题——「现在坐到哪了？」「还剩多少任务？」
> 与 `docs/DEVLOG.md` 的分工：DEVLOG 记**已发生**的变更（倒序流水）；ROADMAP 记**还没做**的事（正序规划）。每完成一项，在这里打勾并把成果写进 DEVLOG。
>
> - **状态图例**：`[ ]` 未开始 · `[~]` 进行中 · `[x]` 已完成 · `[⤳]` **已并入其他里程碑**（保留条目作决策痕迹，**不单独计数**） · `[-]` 不做（有意不做 / 死路，附理由）
> - **编号**：沿用里程碑号 `M88` 起。已完成的 `M1–M87` 见文末「已完成总览」。
> - **验收标准（每项都适用）**：① 差分语料对真 Node v26.9.0 **0 diff**；② `npm run typecheck` 干净；③ `npx vitest run` 全绿；④ `npm run build` 记录 worker 体积；⑤ 部署 gh-pages 且线上资产 200；⑥ 更新 DEVLOG + memory；⑦ 不能对真的东西响亮抛 `NotImplementedError`，绝不静默伪造。
> - **执行顺序**：**阶段 H（native → WASM，主线）** → 阶段 E（M107）→ 阶段 F → 阶段 G。阶段 A/B/C/D 均已结清。
> - **最后更新**：2026-09-24（**阶段 H：M119 第二增量 ✅**——OpenSSL 的对称密码族与 KDF 切到 wasm，`test/crypto-openssl-engine.test.ts` 对同组操作做「wasm / 纯 JS / 真 Node」三方逐字节比对全绿；阶段 H 进度 **5/8**，M119 余非对称/X509）

---

## 阶段重规划说明（2026-09-23）

**背景**：架构从「JS 重写 native」转为「**真上游 C/C++ 编 wasm**（阶段 H，对齐 WebContainer）」后，原先按「JS 重写」排的阶段 C/E/F/G 出现三类错位：

| 错位类型 | 条目 | 处置 |
|---|---|---|
| **已由阶段 H 完成** | M99（zlib）→ **M116**；M100（histogram）→ **M117** | 就地打勾 `[x]`，注明「经阶段 H 完成」 |
| **已被阶段 H 吸收** | M106（热点 binding）→ **M119 + M120**；M114（同步 fs）→ **M120**；M108 / M111（webpack/rspack）→ **M121** | 原条目改标 `[⤳]`，注明并入对象，**不再单独计数** |
| **仍然独立、仅被 wasm 解锁** | M101（`stream/iter` 的 `transform`）、M107（启动/加载性能）、M109/M110/M112（构建工具链）、M113（子域名静态托管） | 保留，归入对应阶段 |

**本次重规划做三件事**：
1. **保留**所有里程碑编号与历史勾选——已完成的（含 M1–M87）原样不动；
2. **结清 / 吸收**上面第 1、2 类，使同一件工作不在两处重复计数；
3. **立阶段 H 为主线**，其余阶段只保留各自真正剩余的任务，并按重算结果刷新「进度总览」。

**重算结果（M88 起）**：共 **50** 项任务（另 1 项判定不做）→ 已完成 **40**、剩余 **10**。其中 **阶段 C 就此解散**（M99/M100 经 H 完成、M101 移入 H），**阶段 E 收敛为「启动与加载性能」**（M106 已拆入 H），**阶段 G 收敛为「预览与路由」**（M114 并入 H）。

---

## 进度总览

| 阶段 | 主题 | 任务数 | 已完成 | 剩余 |
|---|---|---|---|---|
| **H** | **native → WASM（主线，P0–P6）** | 8 | 5 | 3 |
| E | 启动与加载性能 | 1 | 0 | 1 |
| F | 构建工具链（**用户愿景，最后做**） | 3 | 0 | 3 |
| G | 预览与路由 | 1 | 0 | 1 |
| A | crypto 收尾（**已归档**） | 26 | 26 | 0 |
| B | 语义深度（**已归档**） | 5 | 5 | 0 |
| C | 平台无对应物（**已解散**，条目已分流） | 2 | 2 | 0 |
| D | 运行时常量小项（**已归档**） | 4 | 4 | 0 |
| — | 已判定不做 | 1 | — | — |
| **合计** | | **51** | **42** | **9**（+1 不做） |

> **阶段 H 明细**：M115 ✅ · M116 ✅ · M117 ✅ · M118 ✅ · M101 ✅ · M119 · M120 · M121。
> 加上已完成的 **M1–M87**（87 个），项目整体：**已完成 129 个里程碑，剩余 9 个规划任务**。
> 注：本表按**叶子任务**计数——M90（拆 M90.1–M90.9）、M92（拆 M92.1/M92.2）、M93（拆 M93.1–M93.4）、M93.4（拆 a–h）、M97（拆 M97.1）的**父项为拆分占位、不计入**。（旧表 A=22 系拆分前的陈旧值，本次一并修正为 26。）

---

## 阶段 H — native → WASM（**主线**，对齐 WebContainer 架构）

> **架构目标（B2）**：`internalBinding()` 背后的 native 层，从「TS 手写 shim / 平台 API 适配」迁移为**真上游 C/C++ 源码编出的 WASM 模块**；JS 层改用 Node 自己的 `lib/` 真源码（即 WebContainer 的 `lib/` + `internal_bindings` 形态）。
> **验收闸门（B1）**：① 现有差分装置 **0 diff**；② **北极星**：页内跑通 **webpack / rspack 生产构建**。
> **阶段 C 结清（2026-09-23）**：M99（zlib）→ **M116** ✅、M100（histogram）→ **M117** ✅（均已在此完成）；M101 移入本阶段（见下）。
> **技术路线（甲）**：能编真上游 C/C++ 的（zlib/histogram/brotli/zstd/ada/OpenSSL 子集）用 **wasi-sdk** 编；syscall 层**不编 libuv**，改用 **SAB + `Atomics.wait` + FS-worker**。
> **设计文档**：[`docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`](superpowers/specs/2026-09-23-native-to-wasm-design.md)。接入缝 = `REGISTRY`（把 `zlib`/`crypto` 从 `UNSUPPORTED_BINDINGS` 移回并指向 wasm）；产物 = 带内容哈希的独立资产 + 惰性实例化。

- [x] **M115 · wasm 工具链 + binding 接入缝（P0）** ✅ 2026-09-23
  - **工具链**：装 **wasi-sdk 34.0**（`~/wasi-sdk-34.0`，clang 23.1.0-wasi-sdk + wasi-libc + wasm-ld；可用 `WASI_SDK_PATH` 覆盖）。构建入口 `native/build.mjs`（`npm run build:native [-- --inspect]`），产物写到 `src/node-runtime/wasm/artifacts/`（**提交进仓库**，部署/CI 不需工具链）并附 `manifest.json`（工具链版本 + sha256）。
  - **桩模块** `native/src/wn_stub.c`：导出函数 + 线性内存 + `malloc`/`free` 三件事，用 `__attribute__((export_name(...)))` 精确导出（不给链接器传 `--export-all`，libc 符号不泄出）。
  - **加载器** `src/node-runtime/wasm/`：`loader.ts`（`WebAssembly.Module` 同步编译 + reactor `_initialize`）、`registry.ts`（已实例化模块表）、`index.ts`（`WASM_MODULES` + `loadWasmModules()`）。资产走 `?url` → Vite 按内容哈希发到 `assets/`（**不内联进 worker bundle**，M107 的教训）。
  - **接入缝**：`REGISTRY` 新增 `wn_stub`（`bindings/wn_stub.ts`）；worker 启动期 `wasmReady` 与 `vendoredSourcesReady` 并列 await（绑定表是**同步**构建的，wasm 必须在那之前预编译好）；`ready` 信息加 `wasmModules`，UI 显示。
  - **验收**：门禁全绿——`tsc --noEmit` 净 · `vitest run` **997 passed / 2 skipped（119 文件）** · `npm run build`（`dist/assets/wn_stub-Kli7lsuY.wasm` 46.48 kB、`runtime.worker-CqufMlXm.js` **666.38 kB**）；部署 gh-pages 后线上资产全 **200**（含 wasm 46479 字节）；**页面端到端验证**：真实浏览器打开线上站点报告 `native→wasm modules: wn_stub`、`40 bindings · 1 wasm modules`。
  - **两个关键坑**：① 目标名必须是 `--target=wasm32-wasip1`（`wasm32-wasi` 已弃用，且会让 clang 去查不存在的 multilib 目录 → `stdlib.h` 找不到）；② `--export-dynamic` 对非 PIE 可执行模块**不导出**任何符号，用源码里的 `export_name` 属性才可靠。
  - **测试环境**：`npx vitest` 必须用 **fnm Node v26.9.0**——vendored 源里有 `using stack = new DisposableStack()`（Node 24+ 语法），v22.19.0 会在编译期报 `Unexpected identifier 'stack'`。

- [x] **M116 · `zlib` → 真 `deps/zlib` 编 wasm（P1）** ✅ 2026-09-23  ← 取代 M99 的纯 JS 方案
  - **真上游 C → wasm**：把 Node 自己那份 `deps/zlib`（zlib **1.3.2.1-motley**）的 11 个 `.c` 原封不动编成 wasm（`-DDYNAMIC_CRC_TABLE` 免掉 591KB 的 `crc32.h`，`-DZLIB_CONST`，`-DOS_CODE=3`），外加一个薄包装 `native/src/wn_zlib.c`（流式 ABI：`wn_zlib_new`/`write`/`reset`/`set_params`/`set_reject_garbage`/`ensure` + 缓冲区指针），产物 **106.2 KB、零 imports**。
  - **JS 层**：`bindings/zlib.ts` 的 `ZlibCodec`（mode→windowBits 映射、预设字典装载时机、`Z_NEED_DICT` 重试、gzip 多成员、错误形状逐条对齐 `src/node_zlib.cc` 的 `ZlibContext`）+ `builtins/zlib.ts`（Node `lib/zlib.js` 的 **zlib 半边逐条移植**：`ZlibBase`/`Zlib`/`processChunk(Sync)`/便利方法/`flush`/`params`/`crc32`），brotli/zstd/zip 仍响亮抛错。
  - **解锁**：`gzipSync`/`deflateSync`/`inflateRawSync`/`unzipSync`/… 全部可用；`level`/`windowBits`/`memLevel`/`strategy`/`dictionary`/`chunkSize`/`flush`/`finishFlush`/`params()`/`rejectGarbageAfterEnd` 全部生效（此前传非默认值即抛）。`zlib.constants` 补齐到 Node 全量 **170** 项（含 `BROTLI_*`/`ZSTD_*`）。
  - **顺带修的真 gap**：`internal/errors` 补上 `ERR_TRAILING_JUNK_AFTER_STREAM_END`（`TypeError` 基底，Code/文案逐字对齐）。
  - **验收**：新差分装置 `tools/zlib-probe.cjs`（+ `tools/zlib-oracle.mjs` → `test/fixtures/zlib.json`）在真 Node v26.9.0 与 web-node 各跑一遍，**逐字段 0 diff**（同步/异步一次性、编解码参数、字典、流式+字节流、`flush`/`params`、UNZIP 自动识别、多成员 gzip、错误形状、常量/码表）；`tsc --noEmit` 净 · `vitest run` **998 passed / 2 skipped（119 文件）** · `npm run build`（`wn_zlib-ElRqH9jS.wasm` **108.78 kB**、`runtime.worker-xzjeutnS.js` **674.09 kB**）；部署后线上资产全 **200**。
  - **三个真 bug（都已修）**：① `wn_init_stream()` 在“已初始化”时返回的是 `h->err`（上一次操作的返回码），于是 `Z_STREAM_END` 之后的调用被误判为初始化失败而**跳过写入**，调用方看到陈旧的 `avail_out` → 把上一次的输出**又推了一遍**（异步 `gunzip` 出 2× 数据）；② `ZlibBase.prototype._final` 忘了调 `callback()`，writable 端永不 finish（流不结束）；③ `DeflateRaw` 的 `windowBits: 8` 需要按 Node 抬到 9。
  - **两个有意偏离（写进文档）**：① gzip 头第 9 字节（OS）在真 Node（macOS）是 `0x13`、wasm 无 OS 身份所以固定用 zlib 默认 `0x03`——探针把它归一（它是平台元数据，不是数据），并有定点测试锁 `0x03`；② **未**字面 vendor `lib/zlib.js`：它顶层 `require('internal/zip')`（14 文件 / 4271 行），代价不成比例；本步以 `builtins/zlib.ts`（同一份逻辑的移植）达到可观测等价，字面 vendor 待 `internal/zip` 一并搬时再做。

- [x] **M117 · `perf_hooks` 直方图 → 真 `deps/histogram` 编 wasm（P2）** ✅ 2026-09-23  ← 取代 M100 的纯 JS 方案
  - **真上游 C → wasm**：`native/build.mjs` 新增 `wn_histogram` 模块（支持 C++：`-std=c++20 -fno-exceptions -fno-rtti`）——把 `deps/histogram/src/hdr_histogram.c`（HdrHistogram 官方 C 实现）原封不动编进来，外加 `native/src/wn_histogram.cc`：**逐行移植 `src/histogram.cc` / `histogram-inl.h` 的全部算法**（均值/标准差/偏度/峰度、KS/Welch/Mann-Whitney/Cohen's d/Cliff's δ、均值 CI/分位 CI、EWMA 与 SLO 错误率、CBOR 导出/导入、linear/log/percentile 迭代），只是把 V8/Node 胶水换成给 JS 的 C ABI。产物 **257.7 KB**（libc++ 静态构造，非零 imports → 补了一个最小 WASI 宿主 `wasm/wasi.ts`）。
  - **JS 层**：`bindings/histogram.ts`（薄封装：把 wasm C ABI 包成与 `internalBinding('performance').Histogram` **可观测等价**的 JS 类，接进 `performanceBinding` 的 `Histogram`/`createELDHistogram`）；**vendor 真 `lib/internal/histogram.js`**（161 个 vendored 文件，无 patch）；ELD 直方图用 **unref 过的**定时器/ `setImmediate` 驱动（与 Node 一样不吊住事件循环）。**删掉** M35 时代的 `internal/histogram` shim。
  - **解锁**：`createHistogram()`（含 `lowest`/`highest`/`figures`/`halfLife`/`threshold`）、`importHistogram()`、`monitorEventLoopDelay()`（含 `samplePerIteration`）、`timerify(..., {histogram})`、`histogram.export()` 的 CBOR 与 `Histogram`/`RecordableHistogram` 全量方法（含 `countBigInt`/`percentilesBigInt`/`ccdf` 等）。
  - **验收**：新差分装置 `tools/histogram-probe.cjs`（oracle `tools/histogram-oracle.mjs` → `test/fixtures/histogram.json`）在真 Node v26.9.0 与 web-node 各跑一遍，**逐字段 0 diff**（标量统计、分位、桶表、两样本检验、均值/分位 CI、EWMA、CBOR 导出重导入、错误形状、常量）；`tsc --noEmit` 净 · `vitest run` **1007 passed / 2 skipped（120 文件）** · `npm run build`（`wn_histogram-BIhNpcFt.wasm` **257.74 kB**、`runtime.worker-Cna1pydo.js` **679.75 kB**）；部署后线上资产全 **200**。
  - **两个有意偏离（写进文档）**：① **EWMA 方差的 1 ULP**：`ewma_variance` 递推 `v + α·d·d` 在 arm64 宿主被编译成 **FMA**，而 wasm 无 FMA 指令——最后一次加法不进位，导致 EWMA 导出 CBOR 的 `float64` 最后 1 字节差 1；探针对**统计量**取 10 位有效数字（libm 的 `erfc`/`lgamma`/`exp`/`log` 同理可能差 1 ULP），并对 EWMA 导出只比**非 EWMA 段的字节**（framing/计数逐字节相等）。② `monitorEventLoopDelay` 的**绝对延迟值**天然依赖环境（Node 用 libuv 定时器，这里用 unref 的 JS 定时器），故只锁契约与量级，不进字节差分。

- [x] **M101 · `zlib/iter`（可迭代压缩）——vendor 真 `internal/streams/iter/transform.js`** ✅ 2026-09-23  ← 由阶段 C 移入
  - **vendor 真源**：`lib/internal/streams/iter/transform.js` + `lib/zlib/iter.js`（MANIFEST 161 → 163，零 patch）。前者**裸调 `internalBinding('zlib')`** 造 handle（`new binding.Zlib(mode)`），再逐次 `write`/`writeSync` 驱动，从调用方拥有的 `Uint32Array(2)` 读回 `[availOut, availIn]` 并据此循环——这是 `src/node_zlib.cc` 的 `CompressionStream` 原生表面。
  - **绑定补上 raw handle ABI**：`bindings/zlib.ts` 新增 `RawHandle` 基类 + `ZlibStreamHandle`/`BrotliEncoder`/`BrotliDecoder`/`ZstdCompress`/`ZstdDecompress`（暴露在原生键名下），把已验证的 codec 包成「一次 write ↔ 一次 deflate/inflate」的语义：`init(writeState, processCallback, …)` / 异步 `write` / `writeSync` / `reset` / `params` / `close`，失败经 `onerror(message, errno, code)` 报出（**不**调回调，与 C++ `EmitError` 一致）。原高层 codec 改挂 `*Codec` 键（`builtins/zlib.ts` 改用之）。
  - **常量表归一**：把 `builtins/zlib.ts` 里那张 170 项的 zlib/brotli/zstd 常量表抽成 `zlib-constants.ts`，`internalBinding('constants').zlib` 从空 `{}` 改为它（之前是空表，vendored `transform.js` 读它取 `DEFLATE`/`GZIP`/`Z_BUF_ERROR`… 会全得 `undefined`）。
  - **解锁**：`require('zlib/iter')` 的 16 个变换（`compressGzip`/`compressDeflate`/`compressBrotli`/`compressZstd` 及 `decompress*` 与全部 `*Sync`），可经 `stream/iter` 的 `pull`/`pullSync` 组合；`chunkSize`/`level`/`windowBits`/`params` 等参数全部生效。
  - **验收**：新差分装置 `tools/zlib-iter-probe.cjs`（oracle `tools/zlib-iter-oracle.mjs`，真 Node 需 `--experimental-stream-iter` → `test/fixtures/zlib-iter.json`）真 Node v26.9.0 vs web-node **逐字段 0 diff**（同步/异步往返、压缩字节、`chunkSize` 不变性、参数矩阵、错误形状、链式变换、大输入）；`tsc --noEmit` 净 · `vitest run` **1021 passed / 2 skipped（122 文件）** · `npm run build`（worker **695.82 kB**）。

- [x] **M118 · `brotli` / `zstd` → wasm（P3）** ✅ 2026-09-23
  - **真上游 C → wasm**：`deps/brotli`（上游 **1.2.0**，36 个 `.c`：common + dec + enc）与 `deps/zstd`（上游 **1.5.7**，27 个 `.c`）原封不动编成 wasm；薄封装 `native/src/wn_brotli.c`（`BrotliEncoderContext`/`BrotliDecoderContext` 的调用序列）与 `native/src/wn_zstd.c`（`ZstdCompressContext`/`ZstdDecompressContext`，含 pledged src size 核对）。产物 `wn_brotli.wasm` **847.4 KB**、`wn_zstd.wasm` **484.0 KB**（zstd 不开 `ZSTD_MULTITHREAD`——wasm32-wasip1 无线程）。
  - **JS 层**：`bindings/zlib.ts` 新增 `BrotliCodec` / `ZstdCodec`（与 `ZlibCodec` 同形的 `push(chunk, flush)`；输入/输出缓冲放进 wasm 线性内存，用 `*_avail_in/out` 取剩余量），`builtins/zlib.ts` 新增 `BrotliCompress(Decompress)` / `ZstdCompress(Decompress)` / `createBrotli*` / `createZstd*` 与一次性便利方法；`collectParams`/字典装载/错误码对齐 `lib/zlib.js`。
  - **解锁**：`brotliCompress(Sync)` / `brotliDecompress(Sync)` / `zstdCompress(Sync)` / `zstdDecompress(Sync)`、四个流类、全部 `BROTLI_PARAM_*`/`ZSTD_c_*`/`ZSTD_d_*` 参数、字典、`pledgedSrcSize`、`stream/web` 的 `CompressionStream('brotli')`；仅 zip 存档助手仍响亮抛错。
  - **验收**：差分装置扩到 `tools/zlib-probe.cjs`（+ oracle → `test/fixtures/zlib.json`，**56 个观测键**），真 Node v26.9.0 vs web-node **逐字段 0 diff**（含参数、字典、流式、异步、错误形状、`stream/web` brotli）；`tsc --noEmit` 净 · `vitest run` **1011 passed / 2 skipped（120 文件）** · build（worker **689.29 kB**）。

- [~] **M119 · `crypto` → OpenSSL 子集编 wasm（P4）**  ← 承接 M106 的 crypto 部分 🚧 2026-09-24（**摘要/HMAC ✅ + 对称密码与 KDF ✅；非对称/X509 未迁**）
  - **可行性（已退险）**：真 OpenSSL **3.5.8**（`deps/openssl/openssl`）用 wasi-sdk 编出 `libcrypto.a` 5.75 MB / `libssl.a` 0.85 MB，**0 error**；薄模块 `wn_openssl.wasm` **2.29 MB**，SHA-256/MD5/HMAC-SHA256 与真 Node **逐字节一致**。OpenSSL 没有 WASI target，新增自包含 target `native/openssl/99-wasi.conf`（`no-asm/no-shared/no-threads/no-sock/no-engine/no-legacy/no-secure-memory`）；构建走 OpenSSL 自己的 `Configure`+`make build_libs`，缓存到 `native/.openssl-build`。
  - **已交付增量（摘要路径）**：`native/src/wn_openssl.c` 的通用名 ABI（`EVP_MD_fetch` / 一次性+流式 digest / HMAC / XOF），`bindings/openssl.ts` 薄封装，`wasm/lazy.ts` 惰性加载（**不进启动期 `WASM_MODULES`**，避免 M107 的启动回退——解密后立刻后台拉取），`crypto/hash.ts` 在模块就绪后把全部摘要（md5/sha1/sha2/sha3/keccak/blake2/sm3/ripemd160/md5-sha1/shake）切到 OpenSSL，**未就绪或其他名则回退纯 JS**（两者逐字节相同，切换对调用者不可见）。
  - **剩余**：cipher（AES/ChaCha/DES/Camellia/ARIA/SM4/OCB/SIV/XTS/CCM/CBC-CTS）、KDF（pbkdf2/hkdf/scrypt/argon2）、非对称（RSA/EC/DH/ML-KEM）、X509/SPKAC 仍在纯 JS；后续增量逐个迁。
  - **已交付增量②（对称密码 + KDF）**：`wn_openssl` 扩出密码族 ABI（`wn_cipher_info|new|free` + `set_ivlen|set_data_len|set_key_iv|set_padding|aad|set_tag|set_tag_len|get_tag|update|final`）与 `wn_pbkdf2|wn_hkdf|wn_scrypt`；新增驱动 `crypto/openssl-cipher.ts`（`OpenSslCipher implements SyncCipher`，照搬 `CipherBase::Update`/`Final` 的一次性模式集合、CCM/SIV 认证失败延后、错误分支），`createCipher()` 优先走它、否则原地回退。**难点在错误语义而非算法**：`update()` 因 `MarkPopErrorOnReturn` 会弹掉 OSSL 错误 → 一律落回 Node 文案（无 `code`），只有 `final()` 会报 OSSL 错误；`ERR_OSSL_*` 码要按 Node 的库名清单拼（**无 `PROV`** → `PROV_R_BAD_DECRYPT` 即 `ERR_OSSL_BAD_DECRYPT`）；`setAuthTag` 非幂等。KDF 在 `crypto/hash.ts` 接入（参数校验仍留 JS）。
  - 验收②：差分门禁 `test/crypto-openssl-engine.test.ts`（7 例）用测试开关 `setOpensslEnabled()` 对同一操作跑 **wasm / 纯 JS / `node:crypto`** 三方逐字节比对（14 个模式 + KDF 参数组 + 错误文案）**全绿**；`vitest run` **1028 passed / 2 skipped**，`wn_openssl.wasm` 2298.46 kB 独立资产。
  - **剩余**：非对称（RSA/EC/DH/ML-KEM）、X509/SPKAC、argon2 仍在纯 JS；后续增量逐个迁。

- [ ] **M120 · 同步 syscall：SAB + `Atomics.wait` + FS-worker（P5）**  ← 吸收 M114、承接 M106 的 fs 部分
  - 真·同步 `fs` 在独立 worker 完成、主线程可阻塞等待；前置跨源隔离（COOP/COEP）；与现有 fs 语义差分 0 diff。
  - 验收：无 `Atomics.wait` 死锁；同步 `fs` 逐字节对齐。

- [ ] **M121 · 页内跑通 webpack / rspack 生产构建（P6）**  ← **B1 北极星**，汇合 M108/M111
  - 目标：这个浏览器 Node 环境能跑 **webpack / rspack** 生产构建；本 runtime 构建与宿主构建**产物一致**。
  - 验收：页内产出 bundle；与现有差分装置兼容。

---

## 阶段 E — 启动与加载性能

> **2026-09-23 收敛**：原「性能路线」两条中，**M106（热点 binding → wasm）已拆入阶段 H**（crypto → M119、fs / 同步 syscall → M120），本阶段只保留 **M107**。

- [⤳] **M106 · 热点 binding → wasm**（总纲）→ **已并入阶段 H 的 M119 + M120**
  - 原内容：把热点（buffer/fs/crypto）替换为 wasm 实现；引入 **SharedArrayBuffer + Atomics** 做同步 syscall；前置 COOP/COEP 响应头（子域名隔离路由已就绪 M3.5d）。
  - 承接：crypto → **M119**；fs / 同步 syscall → **M120**。

- [~] **M107 · 启动性能** 🚧 2026-09-23（**基准已立 + 载荷拆分已上线**）
  - 新增只读启动计时（`globalThis.__wnBoot`：`moduleEvalMs`/`workerSpawnMs`/`runtimeReadyMs`/`firstRunMs`）+ 基准工具 `tools/e2e-startup-bench.mjs`（CDP，可打本地或 Pages）。
  - **基线**（本地 preview、冷缓存）：`runtimeReady` **110–155ms**；热点 = worker 脚本（2.5MB，93% 是 vendored 源）的 fetch+compile，而非 JS 初始化（`new NodeRuntime` 仅 ~10ms）。
  - **载荷拆分**：vendored 源不再内联进 worker，改为 emit 为 `assets/vendored-sources.txt`（预加载、body 带内容哈希），worker `fetch`+`JSON.parse` 注入。**worker 2510.84→653.76KB**（gzip ~558→203KB），大载荷 gzip 347KB 且与 worker 引导并行（CDP 实测预加载 543ms < worker 脚本 594ms）；`runtimeReady` 95–154ms（无回退）。门禁 `test/vendored-bundle.test.ts` 锁住 bundle 与 eager glob 一致。
  - **下一步**：要再降只能动 2.3MB 文本本身的体积（按需子集/懒加载，`require` 同步 => 需“ready 后再补”策略）或上 V8 code cache/快照。

---

## 阶段 F — 构建工具链（**用户愿景，拍到最后做**）

> 目标：这个浏览器 Node 环境能跑 **rspack / vite / webpack** 等前端构建工具。现状：**vite 已通**（M5c–M5f，build + dev + HMR）。
> **2026-09-23**：M108 / M111 的验收目标与阶段 H 的 **M121**（北极星）重合，故标 `[⤳]` 并入 M121；本阶段只保留 **M109 / M110 / M112**。

- [⤳] **M108 · 对齐异步 / tick 语义，跑通 webpack build** → **已并入阶段 H 的 M121**（北极星）
  - 已定位阻塞点：webpack 5 能加载、能进 `compiler.run`，卡在 `enhanced-resolve` 的模块解析（回调不推进）。
  - 根因候选：① `fs` 回调的投递时机与真 Node 不一致；② 程序结束前 pending 的 **nextTick / microtask 未排空**；③ `CachedInputFileSystem` 的「缓存命中 → `process.nextTick`」路径在此语义下停摆。
  - 顺手已修：`browser` 字段替换目标的解析基准（`78f8a59`）。
  - 验收（移交 M121）：页内 `webpack` 生产构建产出 bundle。

- [ ] **M109 · webpack loader / plugin 生态**
  - `babel-loader` / `ts-loader` / `css-loader` / `style-loader` / `html-webpack-plugin` / `terser-webpack-plugin`。

- [ ] **M110 · webpack watch / dev-server**

- [⤳] **M111 · rspack（wasm32-wasi + emnapi）** → **已并入阶段 H 的 M121**（wasm 工具链与阶段 H 共用）
  - 现状：核心是 Rust napi 原生插件（`.node`）页面跑不了；但官方有 `@rspack/binding-wasm32-wasi`（2.2.6，基于 `@emnapi/core` + `@napi-rs/wasm-runtime`）。
  - 需要 **WASI 宿主 + 线程（SharedArrayBuffer / COOP-COEP）**。**先做一次性 spike 验证 wasm 能否在页内初始化**，再决定投入。
  - 验收（移交 M121）：页内 rspack 生产构建产出 bundle。

- [ ] **M112 · 其他框架 / 工具链**
  - React（SWC / Babel）、Svelte、TypeScript 项目、Tailwind / PostCSS 管线。

---

## 阶段 G — 预览与路由（借鉴 WebContainer，2026-09-23 调研落地）

> **来源**：`docs/webcontainer-research.md`（StackBlitz WebContainer 实测）。两条同领域已验证的工程手法，作为后续实现任务。
> **与现有条目的关系**：M113 承接已完成的 M3.5d「子域名路由」（dev 侧已有，本条做静态托管补齐 + 每端口 DevServer SW）；**M114（真·同步 `fs`）已并入阶段 H 的 M120**（`[⤳]`），本阶段只保留 M113。

- [ ] **M113 · 预览端口 → 子域名路由（静态托管跟进）**
  - **对标**：WebContainer 把 `listen(8080)` **编进一个唯一子域名**（`<proj>--8080--<hash>.local-credentialless.webcontainer.io`），再在该域名注册一个 **DevServer Service Worker** 拦截所有请求、从内存 FS 供给。
  - **为何优于路径式**：路径式 `/preview/<port>/` 在**站点根相对路径**（`/assets/x.js`）、**cookie 作用域**、**SW scope**、刷新/离线 上都会踩坑；子域名天然避开。
  - **现状**：dev 侧已有 `<port>.localhost` 子域名路由（M3.5d）；静态托管（gh-pages）仍走路径式 `/preview/<port>/`（`src/ui/preview-url.ts` 已有子域名壳 `SUBDOMAIN_SHELL_PATH = '/__webnode__/'` 与 pop-out 分支）。
  - **难点**：静态托管需要**通配 DNS**（当前只有 dev 中间件 `plugins/dev-subdomains.ts` 能供壳），需自定义域 + 每端口 DevServer SW。
  - **验收**：静态托管下预览走子域名；站点根相对路径 / cookie / SW scope 均正确；pop-out 与嵌入两条路都通。

- [⤳] **M114 · 真·同步 `fs` 且不阻塞 UI（SAB + Atomics + FS-worker）** → **已并入阶段 H 的 M120**
  - **对标**：WebContainer 用 **`SharedArrayBuffer` + `Atomics.wait`** 把主线程"接"到另一个 worker 里的内存 FS（实测：14 个 worker 的 `Runtime.evaluate` 全超时，正是主线程卡在 `Atomics.wait`）——于是浏览器里能提供**真·同步 `readFileSync`**。
  - **现状**：web-node 在**同 realm 内**实现（单线程、简单、不阻塞 UI）；一旦要真并发/真同步就绕不开。
  - **前置**：**跨源隔离（COOP/COEP）**→ 才能用 SAB（隔离路由已就绪 M3.5d）。
  - **验收**：fs 同步调用在独立 worker 完成、主线程可阻塞等待；无 `Atomics.wait` 死锁；与现有 fs 语义差分 0 diff。

---

## 资产盘点：既往工作如何衔接 native→WASM（2026-09-23）

> 架构从「JS 重写 native」转向「真上游 C/C++ 编 wasm」前，先盘点已有 ~120 个里程碑的**去留**。结论：**换发动机、留仪表盘**——不是推翻重来。

| 类别 | 内容 | 处置 |
|---|---|---|
| **地基（继续用）** | Realm / loader / `internalBinding` 调度表（`REGISTRY`）、VFS（内存树 + OPFS）、虚拟 TCP + ServiceWorker 预览、子域名路由（M3.5d）、npm client、UI，以及 **M17–M56 那一大批 vendored 真 Node `lib/` 源码** | **原样保留**（与 native 层正交） |
| **验收装置（最值钱）** | `tools/*-probe.cjs` + `*-oracle.mjs` + `test/fixtures/*.json`（M64–M98 + 阶段 A/B 攒下的差分语料，含 crypto 全套、http/net/fs/module…） | **原样保留，直接作为 wasm 的验收闸门**——wasm 版必须过同一套 probe，才能证明「0 diff」 |
| **将被取代的实现（保留作 fallback/oracle）** | 纯 JS 重写的 native 原语：crypto（hash/cipher/kdf/非对称/PQC/ML-KEM）、zlib shim、string_decoder、buffer、v8 serdes … | **不删**：① 当前是 main 上可跑可部署的版本；② wasm 编不出来时的兜底；③ 语义参照 |
| **语义知识** | `DEVLOG` / `MEMORY` 记的坑（SM4-XTS 的 GB 变体、GCM-SIV one-shot 报错、`internal/errors` 码表、libuv 形状错误消息…） | **保留**——正是 wasm 移植最易踩处 |

---

## 已归档阶段（已完成）

> 阶段 A / B / D 属「JS 重写 native」时代的阶段，均已 100% 完成，原样保留（勾选与描述不复写）；**阶段 C 已解散**（条目已按「阶段重规划说明」分流到阶段 H 与本节）。

---

## 阶段 A — crypto 收尾（接续 M87）

> 现状：非对称半边（RSA/EC/Ed25519/ECDH/DH/X509）已在 M83–M87 完成。剩下的都是「还没做的算法/API」。
>
> **本阶段执行顺序**：M88 → M89 → M90.* → **M92 → M93 → M94 → M91**。其中 **M91（PQC KEM）按原说明后置到末尾**（代码量大、依赖向量多，可后置或砍）；2026-09-22 据其「优先级最低」的原始标注调整了排序。

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

- [x] **M90 · `createMac` / `getMacs`**（拆为 M90.1–M90.5）✅ 2026-09-22
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

- [x] **M90.5 · SHA-3 / Keccak / SHAKE / keccak-kmac 注册** ✅ 2026-09-22
  > **拆分原因**：动手做 M90.5 时实测真 Node 的 `getHashes()` 有 **81 个可用名字**（不是原先以为的十来种），包含 SHA-3/Keccak/SHAKE/keccak-kmac/blake2/SM3/RIPEMD-160/SHA-512-t/SHA-256-192/md5-sha1 及大量 RSA-*/…WithRSAEncryption 别名。原估「中低」严重偏低，故拆为 **M90.5–M90.9** 五个子任务（任务数 30 → 34）。
  - `keccak.ts` 导出原始 sponge；`Hash` 支持 XOF 的 `options.outputLength`（缺省 **shake128=16 / shake256=32**）；注册 `sha3-224/256/384/512`、`keccak-224/256/384/512`（pad 0x01）、`shake-128/256`、`keccak-kmac-128/256`（pad 0x04，rate 168/136）及其全部别名。
  - 风险：低。

- [x] **M90.6 · BLAKE2b-512 / BLAKE2s-256 注册** ✅ 2026-09-22
  - 直接用 M90.1/M90.4 的 `blake2b.ts`/`blake2s.ts`（无 key/salt/personal 的普通摘要形式）；注册 `blake2b512`/`blake2b-512`/`blake2s256`/`blake2s-256`。
  - 风险：低。

- [x] **M90.7 · SM3 + RIPEMD-160** ✅ 2026-09-22
  - 新增两个纯 JS 摘要实现（GB/T 32905 与 ISO/IEC 10118-3），并注册 `sm3`/`RSA-SM3`/`sm3WithRSAEncryption`、`ripemd160`/`ripemd`/`ripemd-160`/`rmd160`/`RSA-RIPEMD160`/`ripemd160WithRSA`。
  - 风险：中低（两套轮函数）。

- [x] **M90.8 · 截断变体与复合摘要** ✅ 2026-09-22
  - `sha-512/224`、`sha-512/256`（SHA-512/t，需改 IV）+ `RSA-SHA512/224`/`RSA-SHA512/256`；`sha-256/192`（`sha2-256/192`/`sha256-192`，SHA-256 截断）；`md5-sha1`（复合）；`ssl3-md5`/`ssl3-sha1` 别名。
  - 风险：中低。

- [x] **M90.9 · `getHashes()` 全表对齐（差分门禁）** ✅ 2026-09-22（getHashes 已 **81/81** 与真 Node 一致）
  - 把 `getHashes()` 与真 Node 的 **81 名列表**逐项比对（含排序与所有别名），并加 `createHash(每个名字)` 的差分回归。
  - 风险：低。

- [x] **M91 · 后量子 KEM** ✅ 2026-09-22
  - `encapsulate` / `decapsulate`（ML-KEM / Kyber），以及 `ml-kem-512/768/1024` 密钥类型。
  - 纯 JS 实现 ML-KEM（FIPS 203），建在既有 Keccak（SHA3/SHAKE）之上；NTT 常量由 `ζ = 17` 程序化推导，不手抄。
  - 与真 Node / OpenSSL 逐字节对齐（差分 0 diff）；签名验签/封装/解封类全绿。
  - 风险：高（已控制，实测通过）。

- [x] **M92 · `crypto.diffieHellman` + DH KeyObject** ✅ 2026-09-22
  > **拆分原因**：动手前调查发现 web-node **根本没有 DH 类型的 `KeyObject`**（`AsymType` 只有 `rsa|ec|ed25519`，`generateKeyPairSync('dh')` 会抛错）。而 `crypto.diffieHellman` 既接 DH 也接 EC 的 `KeyObject`，所以要先把 DH KeyObject 补上。原估「低风险」偏低，故拆为 M92.1/M92.2（任务数 34 → 35）。

- [x] **M92.1 · DH `KeyObject`** ✅ 2026-09-22
  - `KeyMaterial` 增 `dh`；`generateKeyPairSync('dh', { group } | { prime, generator })`；`asymmetricKeyType === 'dh'`；导出/解析 PKCS#3（私钥）与 SPKI（公钥，OID `dhKeyAgreement`），PEM 标签 `DH PRIVATE KEY`/`PUBLIC KEY`；`export`/`equals`/`toCryptoKey` 相应支持。
  - 风险：中（DER 编解码 + 参数校验）。

- [x] **M92.2 · `crypto.diffieHellman({ privateKey, publicKey })`** ✅ 2026-09-22
  - DH：`y_b^{x_a} mod p`，按 prime 长度补前导零；EC：`d_a · Q_b` 的 x 坐标，按曲线字节长补齐。
  - 错误面：`options` 非对象 → `ERR_INVALID_ARG_TYPE`；私/公钥缺失 → `The property 'options.privateKey/publicKey' is invalid. Received undefined`；类型不符 → `ERR_CRYPTO_INCOMPATIBLE_KEY`（`Incompatible key types for Diffie-Hellman: dh and rsa`）；跨组 → `ERR_OSSL_MISMATCHING_DOMAIN_PARAMETERS`。
  - 风险：中低。

- [x] **M93 · 更多对称密码**（拆为 M93.1–M93.4）✅ 完成
  > **2026-09-22 拆分原因**：原估「低–中」但覆盖面很大（DES/3DES、ChaCha20、CCM、OCB、SIV、XTS、wrap 系列，以及 Camellia/ARIA/SM4），每个都有各自的模式/参数/向量，混作一个里程碑无法逐项验证。按建议顺序拆为四个子项（任务数 35 → 38）。

- [x] **M93.1 · ChaCha20 / ChaCha20-Poly1305** ✅ 2026-09-22
  - 新增 `src/node-runtime/crypto/chacha20.ts`：ChaCha20 块函数 + 流式 keystream（raw 用 64-bit 计数器、AEAD 用 32-bit），以及 RFC 8439 Poly1305 AEAD（复用 `poly1305.ts`）。
  - `createCipheriv` 接入 `chacha20`（IV 16）与 `chacha20-poly1305`（IV 12）；两套实现共用 `SyncCipher` 接口，`crypto/cipher.ts` 新增 `createCipher` 工厂与 `cipherTagLengthIsValid`。
  - 语义修正（对齐真 Node）：`getCipherInfo` 对 stream 模式不再返回 `blockSize`；`setAuthTag` 改为要求长度**等于** `authTagLength`（GCM 一并修正）；chaCha 解密未 `setAuthTag` 时也按全零 tag 校验并报 `Unsupported state or unable to authenticate data`（无 `code`）。
  - 差分：`tools/crypto-chacha-probe.cjs` → `test/fixtures/crypto-chacha.json`（含 RFC 8439 §2.4.2/§2.8.2 官方向量、截断 tag、AAD、错误面）——**0 diff**；`test/crypto-chacha.test.ts`。
  - 风险：低。

- [x] **M93.2 · DES / 3DES** ✅ 2026-09-22
  - 新增 `src/node-runtime/crypto/des.ts`：纯 JS DES 块密码（FIPS 46-3 全表）+ EDE2/EDE3；`createCipheriv` 接入 `des-ede`/`des-ede-ecb`/`des-ede-cbc`/`des-ede-cfb`/`des-ede-ofb` 与 `des-ede3`/`des-ede3-ecb`/`des-ede3-cbc`/`des-ede3-cfb`/`des-ede3-ofb`/`des3`（ECB/CBC/CFB-128/OFB，8 字节块 + PKCS#7）。
  - 顺带把 CMAC 改成**通用块密码 CMAC**（`cmacCore` + `aesCmac`/`desCmac`），于是 `createMac('cmac', key, { cipher: 'des-ede3-cbc' })` 也能算了（8 字节 tag）——M90.3 记的「非 AES CMAC 报错」偏离因此收窄。
  - **已知偏离**：原先缺的 `des-ede3-cfb1/cfb8`（M93.4e）与 `des3-wrap`/`id-smime-alg-cms3deswrap`（M93.4f）均已落地；DES 族已对齐真 Node（无遗留缺口）。
  - 差分：`tools/crypto-des-probe.cjs` → `test/fixtures/crypto-des.json`（**0 diff**）；`test/crypto-des.test.ts`；CMAC 语料并入 `test/fixtures/crypto-mac.json`。
  - 风险：中低。

- [x] **M93.3 · AES-CCM** ✅ 2026-09-22
  - 新增 `src/node-runtime/crypto/ccm.ts`：SP 800-38C 的 CBC-MAC + 计数器模式 AEAD，含 B0/A0 构造、AAD 长度前缀（<0xff00 用 2 字节，否则 0xfffe/0xffff 变长）、payload 块切分。
  - 把 AES 块密码从 `cipher.ts` 抽到新模块 `src/node-runtime/crypto/aes.ts`（`AesKey` 导出），`cipher.ts` 与 `ccm.ts` 共用，避免循环依赖。
  - `createCipheriv` 接入 `aes-{128,192,256}-ccm` 与其 `id-aes*-ccm` 别名；`authTagLength` **必填**（缺失报 `ERR_CRYPTO_INVALID_AUTH_TAG: authTagLength required for aes-128-ccm`），合法值 `{4,6,8,10,12,14,16}`；nonce 长度限 `[7,13]`，越界报 `ERR_CRYPTO_INVALID_IV: Invalid initialization vector`。
  - 语义对齐真 Node：带 AAD 时 `plaintextLength` 必填（缺失报 `ERR_MISSING_ARGS: options.plaintextLength required for CCM mode with AAD`）；`update` 必须**一次性**给出精确 `plaintextLength` 字节，否则报 `Trying to add data in unsupported state`（无 `code`）；解密 tag 不匹配报 `Unsupported state or unable to authenticate data`。
  - 差分：`tools/crypto-ccm-probe.cjs` → `test/fixtures/crypto-ccm.json`（含 SP 800-38C 附录 C 例 1、16/24/32 密钥、tag 4–16、nonce 7–13、空 payload、全套错误面）——**0 diff**；`test/crypto-ccm.test.ts`。
  - 风险：中低。

- [x] **M93.4 · 其余模式与密码**（拆为 M93.4a–M93.4h）
  > **2026-09-22 拆分原因**：与 M93 同理——覆盖面过大（三种额外块密码 + 四种额外模式/包装），逐项验证无法混在一起。拆为：

  - [x] **M93.4a · Camellia** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/camellia.ts`：纯 JS 实现 RFC 3713（128 位分组、128/192/256 位密钥；BigInt 写密钥编排与 Feistel 数据路径，S 盒 `s2/s3/s4` 由 `s1` 旋转得到）。
    - 把 AES 风格的模式驱动 `Cipheriv` 泛化：新增 `BlockCipher` 接口（`encryptBlock`/`decryptBlock`），构造函数可选传入块密码（默认 `AesKey`），于是 Camellia 直接复用 ECB/CBC/CFB/OFB/CTR 与 PKCS#7。
    - 接入 `camellia-{128,192,256}` 的 ecb/cbc/cfb/ofb/ctr + `camellia128/192/256` 别名；CMAC 现按 cipher 分派（`cmacForCipher` → `aesCmac`/`desCmac`/`camelliaCmac`）。
    - **关键坑**：128 位密钥的 `k1..k18` 并非连续半字对——`k10` 取的是 `KL<<<60` 的**低**半字（RFC 3713 §2.2），初版按 `halves()` 成对生成导致密文错位；改用显式 `hi()/lo()` 后与官方向量一致。
    - 差分：`tools/crypto-camellia-probe.cjs` → `test/fixtures/crypto-camellia.json`（RFC 3713 三条官方向量 + 15 个模式组合 + 流式/padding + CMAC + 错误面）——**0 diff**；`test/crypto-camellia.test.ts`。
    - 风险：中低。
  - [x] **M93.4b · ARIA / SM4** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/aria.ts`（RFC 5794：`FO=A(SL1(D^RK))`/`FE=A(SL2(D^RK))`、三层 Feistel 密钥编排、末轮 SL2 加双密钥；SB3/SB4 由 SB1/SB2 的逆**推导**而非手抄）与 `src/node-runtime/crypto/sm4.ts`（GB/T 32907：32 轮、`tau` + `L`、密钥编排 `L'`）。
    - 两者都是 128 位块，直接复用泛化后的 `Cipheriv`。接入 `aria-{128,192,256}` 与 `sm4` 的 ecb/cbc/cfb/ofb/ctr，加 `aria128/192/256`、`sm4` 别名；CMAC 分派扩展到 aria/sm4。
    - 顺手修掉 M93.4a 遗留的一个隐患：camellia/aria/sm4 用专用的 5 模式表（不再误用含 gcm 的 6 项 `modes` 生成幽灵 `*-gcm` 条目）。
    - 差分：`tools/crypto-aria-sm4-probe.cjs` → `test/fixtures/crypto-aria-sm4.json`（ARIA/SM4 全部 20 个名称的 info + 20 组模式密文/回环 + 流式/无 padding + CMAC + 错误面）——**0 diff**；`test/crypto-aria-sm4.test.ts`。
    - 风险：中低。
  - [x] **M93.4c · AES-OCB 与 key wrap** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/ocb.ts`：按 OpenSSL `ocb128.c` 逐字节实现 RFC 7253（`L_*`/`L_$`/`L_i` 双倍、stretch 取位生成 `Offset_0`、CBC-MAC 式 checksum 与 AAD sum）。**注意 OpenSSL 的 nonce 不标准**：`nonce[0]=((taglen*8)%128)<<1`、IV 靠右、其左一字节置 1——所以密文会随 tag 长度变化，必须按它来。
    - 新增 `src/node-runtime/crypto/wrap.ts`：RFC 3394 `wrap` 与 RFC 5649 `wrap-pad`（含 n=1 的 AIV||P 单块特例）；两者都是**单次 update**（`update` 返回全部输出、`final` 空，二次 update 报 `Trying to add data in unsupported state`）。
    - 接入 `aes-{128,192,256}-ocb`（IV 1..15、`authTagLength` 必填、0..16）与 `aes-{128,192,256}-wrap`/`-wrap-pad`（含 `aes128-wrap`、`id-aes128-wrap` 等拼写，IV 8/4 字节且必填）。
    - 语义细节：OCB 按 OpenSSL provider 那样**缓存尾巴不满块**，末块输出在 `final`；解密 tag 不符在 `final` 报 `Unsupported state or unable to authenticate data`；`getAuthTag` 在 `final` 前报 `ERR_CRYPTO_INVALID_STATE`。
    - **已知偏离**：`aes-*-wrap-inv`/`-wrap-pad-inv`（M93.4f）与 `des3-wrap`/`id-smime-alg-cms3deswrap`（M93.4f）均已落地。
    - 差分：`tools/crypto-ocb-wrap-probe.cjs` → `test/fixtures/crypto-ocb-wrap.json`（RFC 7253 附录 A、tag 8/12/16、IV 8/12/13/15、空/块/长 payload、流式分块、wrap/wrap-pad 的 RFC 3394/5649 向量与回环、全套错误面）——**0 diff**（首次运行）；`test/crypto-ocb-wrap.test.ts`。
    - 风险：中。
  - [x] **M93.4d · AES-SIV / AES-XTS** ✅ 2026-09-22
    - 新增 `src/node-runtime/crypto/siv.ts`：RFC 5297 的 S2V（`d = dbl(d) ^ CMAC(K, aad)`，载荷块 `len>=16` 用 `S||(S_last^d)`、否则 `dbl(d) ^ pad(S)`）+ AES-CTR；密钥为两半（CMAC 半 + CTR 半），tag 即 IV，tag 固定 16 字节。
    - 新增 `src/node-runtime/crypto/xts.ts`：IEEE 1619 的 tweak = AES(k2, iv)、逐块 doubling、尾部不满块按**密文窃取**（CTS）处理；密钥两半不可相同（否则 `ERR_OSSL_XTS_DUPLICATED_KEYS`）。
    - 接入 `aes-{128,192,256}-siv`（无 IV、`ivLength=0`、无 nid）与 `aes-{128,256}-xts`（IV 16、nid 913/914，无 192 变体）；`getCipherInfo` 现在会像 OpenSSL 那样在 nid/ivLength 为 0 时**省略该字段**。
    - **关键坑**：①XTS 的 tweak doubling 是**小端**方向的 GF 倍乘（进位从末字节流向首字节），与 SIV/GCM 的大端方向相反——最初复用了大端的 `dbl` 导致从第 2 块起全错；②`Buffer.prototype.slice` 在本 runtime 里返回**共享内存的视图**，CTR 计数器自增因此改写了存起来的 auth tag 末字节，必须用 `new Uint8Array(x)` 显式拷贝。
    - 语义细节：SIV/XTS 都是**单次 update**（二次 update 与不足一块报 `Trying to add data in unsupported state`）；SIV 未 `update` 就 `final` 报鉴权错误，XTS 报 `Unsupported state`；XTS 的 `setAAD`/`getAuthTag`/`setAuthTag` 报 `ERR_CRYPTO_INVALID_STATE`。
    - 差分：`tools/crypto-siv-xts-probe.cjs` → `test/fixtures/crypto-siv-xts.json`（SIV：128/192/256 密钥、多 AAD、空/16/32/40 字节载荷；XTS：16/20/32/33/48/1000 字节、全块与 CTS、两套 key/iv；全套错误面）——**0 diff**；`test/crypto-siv-xts.test.ts`。
    - 风险：中高。
  - [x] **M93.4e · CFB 反馈位宽（cfb1/cfb8）与 SM4 128 位别名** ✅ 2026-09-23
    - 新增 `src/node-runtime/crypto/cfb.ts`：位粒度通用 CFB（反馈宽度 1/8/128 位），按 OpenSSL `cfb128.c` 的 `cfbr_encrypt_block` 逐位实现——每步 `E(R)`、取高 `s` 位、`R=(R<<s)|(反馈位)`；**加密反馈输出位、解密反馈输入位**（可逆性所在）。
    - AES/ARIA/Camellia 走 `Cipheriv`（16 字节块），DES 走 `DesCipher`（8 字节块），分别接入 `cfb1`/`cfb8`。
    - 新增名称：`aes-{128,192,256}-cfb1/cfb8`、`aria-*-cfb1/cfb8`、`camellia-*-cfb1/cfb8`、`des-ede3-cfb1/cfb8`（20 个）+ `sm4-cfb128`/`sm4-ofb128`（info 名为 `sm4-cfb`/`sm4-ofb` 的别名）——`getCiphers()` 从 **111 → 133**（真 Node 165）。
    - **关键坑**：①位粒度的 keystream 必须**每步从寄存器重新加密**（初版对一个全零缓冲加密，得到 `E(K,0)`）；②`DesEde.encrypt` **返回新数组、不改原数组**，与 AES 的 `encryptBlock`（原地）不同，直接把返回值丢弃会让 DES 的 keystream 永远等于寄存器本身（且 cfb1 与 cfb8 输出巧合地一样）——需 `b.set(this.#ede.encrypt(b))`。
    - 差分：`tools/crypto-cfb-feedback-probe.cjs` → `test/fixtures/crypto-cfb-feedback.json`（22 名称 × 9 种长度（含 0/非整块）× 加解密回环 + 流式分块 + `getCipherInfo` + `getCiphers` 成员）——**0 diff**；`test/crypto-cfb-feedback.test.ts`。
    - 仍缺（后续 M93.4f+）：`aes-*-cbc-cts`、`aes-*-gcm-siv`、`aria-*-ccm/gcm`、`aria/sm4` 的 XTS/CCM/GCM、`aes-*-wrap-inv`/`-wrap-pad-inv`、`des3-wrap`/`id-smime-alg-cms3deswrap`。
  - [x] **M93.4f · 逆 cipher 密钥包装与 DES3-CBC 包装** ✅ 2026-09-23
    - 新增 `wrap.ts` 的**逆 cipher** 支持：`*-wrap-inv`/`*-wrap-pad-inv` 按 SP 800-38F 指定 **AES 逆 cipher**（`AES_decrypt`）作为块函数——加密实例用 `decryptBlock`、解密实例用 `encryptBlock`（实例内单一 designated block，与 OpenSSL `cipher_aes_wrp.c` 的 `use_forward_transform = !enc` 一致）。
    - 新增 `src/node-runtime/crypto/des3-wrap.ts`：RFC 3217 / CMS `des3-wrap`（`id-smime-alg-cms3deswrap`，nid 246）。固定外层 IV `4adda22c79e82105`；内层随机 IV + SHA-1 ICV；整体 reverse 后再 CBC。**加密非确定**（随机 IV），因此差分只比**解密**与**回环**。
    - 新增名称：`aes-{128,192,256}-wrap[-pad]-inv` 与 `aes{128,192,256}-wrap[-pad]-inv`（12，无 nid）+ `des3-wrap`/`id-smime-alg-cms3deswrap`（2）→ **`getCiphers()` 133 → 147**。
    - **关键坑（又一个 Buffer 别名）**：web-node 的 `Buffer.prototype.slice` **返回共享内存的视图**，`unwrapRaw` 里 `a = a.slice()` 实际改写了调用者的密文缓冲区——症状是「先解密再用同一密文」时密文被 XOR 掉一串计数器值（`1fa68b0a8112b447` → `...b44b`）。修正：本模块所有可能来自调用者的 `.slice()` 改为 `new Uint8Array(...)` 显式拷贝。
    - 语义细节：`des3-wrap` 用 **null/空 IV**（非空 IV → `ERR_CRYPTO_INVALID_IV`），空输入 → 空输出，输入非 8 字节倍数 → unsupported state，解密 <24 字节 → unsupported state。
    - 差分：`tools/crypto-wrap-inv-des3-probe.cjs` → `test/fixtures/crypto-wrap-inv-des3.json`（12 个 inv 名称的 info + 加密/回环/与正向模式差异、des3 的录制密文解密 + 随机回环 + 全套错误面）——**0 diff**；`test/crypto-wrap-inv-des3.test.ts`。
    - 仍缺（M93.4g+，18 个）：`aes-*-cbc-cts`、`aes-*-gcm-siv`、`aria-*-ccm`、`aria-*-gcm`、`camellia-*-cbc-cts`、`sm4-ccm`/`sm4-gcm`/`sm4-xts`。
  - [x] **M93.4g · CBC 密文窃取（NIST CTS）** ✅ 2026-09-23
    - 新增 `src/node-runtime/crypto/cbc-cts.ts`：按 OpenSSL 的 **NIST CTS**（`crypto/modes/cts128.c` 的 `CRYPTO_nistcts128_*`）逐块移植。与 RFC 2040/3962 不同：**允许输入为块大小整数倍**且**不交换最后两块**；末段明文与前一密文块异或后再加密，写回位置**偏移 `residue` 字节**（这个重叠写就是“窃取”）。
    - 新增 `aes-{128,192,256}-cbc-cts`、`camellia-{128,192,256}-cbc-cts`（6）→ **`getCiphers()` 147 → 153**。
    - **关键坑**：解密末段重建 C(n-1) 后必须用 **`decryptBlock`**（即 `D(ct_mid)`）而非 `encryptBlock`——加密方向匹配但解密方向会错。症状：密文完全对、明文乱掉。
    - 语义（与真 Node 一致）：**一次性**模式——`update` 至少一个块且只允许一次（第二次 → “Trying to add data in unsupported state”）；`update` 一次性吐出全部输出；`final()` 仅关闭（返回空）；无 `update` 先 `final()` → “Unsupported state”；二次 `final()` → `ERR_CRYPTO_INVALID_STATE`/“Invalid state”；`getAuthTag()` → “Invalid state for operation getAuthTag”。`CMAC` 接受 `cbc-cts`（与普通 cbc 同值，已对齐）。
    - 差分：`tools/crypto-cbc-cts-probe.cjs` → `test/fixtures/crypto-cbc-cts.json`（6 个名称 info；12 种长度含 16/17/18/20/31/32/33/47/48/49/64/1000 的加密+回环；一次性语义；全套错误面）——**0 diff**；`test/crypto-cbc-cts.test.ts`。
    - 仍缺（M93.4h+，12 个）：`aes-*-gcm-siv`(3)、`aria-*-ccm`(3)、`aria-*-gcm`(3)、`sm4-ccm`/`sm4-gcm`/`sm4-xts`(3)。
  - [x] **M93.4h · AES-GCM-SIV、ARIA CCM/GCM、SM4 CCM/GCM/XTS（cipher 全表 165 对齐）** ✅ 2026-09-23
    - 新增 `src/node-runtime/crypto/gcm-siv.ts`：按 OpenSSL `cipher_aes_gcm_siv{,_polyval,_hw}.c` 实现 **RFC 8452 AES-GCM-SIV**。先从 nonce 用 AES-ECB 派生每消息密钥（`msg_auth_key` = `E(K,LE32(0)‖N)[0..8]‖E(K,LE32(1)‖N)[0..8]`、`msg_enc_key` 从 counter 2 起每 8 字节一半）；POLYVAL 用 GHASH 在**字节反转**操作数上算（key 字节反转后乘 x）；tag 再经 AES-ECB 并置 `counter[15] |= 0x80`，CTR32（前 4 字节**小端**计数器）出密文。**解密先跑 CTR 再重算 tag**。
    - `AesCcm` 改为接受任意块密码（新增 `CcmBlockCipher` 接口 + 构造末参 `block?`），ARIA/SM4 的 CCM 走各自 family 的块函数；`AesXts` 改为接受块密码构造器 + 可选 tweak 加倍函数 + 是否查重键。
    - **关键坑（SM4-XTS 与 AES-XTS 不同）**：SM4-XTS 用 OpenSSL 的 **GB 变体**（`crypto/modes/xts128gb.c`，见 `cipher_sm4_xts.c`）——tweak 加倍是**大端右移**、反馈常量 `0xe1` 进**最高字节**；AES-XTS 才是 IEEE 1619（小端左移、`0x87` 进最低字节）。症状：单块对、多块从第二块起全错。故 `xts.ts` 导出 `gbTweakDbl` 并让 sm4 分支传入。另：SM4-XTS **不做**重键检查（AES-XTS 才查）。
    - **关键坑（GCM-SIV one-shot）**：与 CTS/XTS 同为一次性模式，但它是 **AEAD**，`Final()` 在无先导 `update()` 时返回“Unsupported state or unable to authenticate data”（Node `CipherBase::Final` 的 `isGcmSivMode` 检查），而非 CTS/XTS 的“Unsupported state”。
    - 新增名称：`aes-{128,192,256}-gcm-siv`(3)、`aria-{128,192,256}-ccm`(3)、`aria-{128,192,256}-gcm`(3)、`sm4-ccm`/`sm4-gcm`/`sm4-xts`(3) → **`getCiphers()` 153 → 165**，与真 Node **逐名 0 缺 0 余**。
    - 差分：`tools/crypto-gcm-siv-aead-probe.cjs` → `test/fixtures/crypto-gcm-siv-aead.json`（12 名称 info；GCM-SIV 多长度加解密+回环；ARIA/SM4 CCM/GCM 回环；SM4-XTS 5 种长度；GCM-SIV/CCM/XTS 全套错误面）——**0 diff**；`test/crypto-gcm-siv-aead.test.ts`。
    - 连带修正：`test/cipher.test.ts`（原以 `aes-128-gcm-siv` 当“未实现”示例 → 改为断言 `getCiphers().length === 165`）、`test/crypto.test.ts`（移除该例）、`test/crypto-mac.test.ts`（注释更新，aria-ccm 的 CMAC 仍报 invalid mode）。

- [x] **M94 · `crypto.Certificate`** ✅ 2026-09-22
  - Node 已弃用的 `crypto.Certificate` 类（`verifySpkac`/`exportPublicKey`/`exportChallenge`）。由 `src/node-runtime/crypto/spkac.ts` 实现（NETSCAPE_SPKI 解析 + OpenSSL 风格 base64 解码 + 签名校验），在 builtin 里接成「可 new 也可直接调用」的函数 + 原型/静态三方法。
  - 风险：低。

---

## 阶段 B — 语义深度（差分语料继续扩面）

> 已做：`http`(M79) · `net`(M80) · `fs`(M81) · `crypto` 非对称(M83–87)。方法固定为「同一观测程序在真 Node 与 web-node 各跑一遍，JSON 逐字段相等」。

- [x] **M95 · `net` 连接生命周期与超时** ✅ 2026-09-22
  - 连接状态机、`connect`/`timeout`/`error` 事件序、`socket.setTimeout`、半开连接、`allowHalfOpen` 语义的差异对齐。
  - 差分探针 `tools/net-lifecycle-probe.cjs` 在真 Node 与 web-node 各跑一遍，**0 diff**；修了虚拟 TCP 的半开/关闭语义与 `http.Server#close` 空转问题。

- [x] **M96 · `fs` 错误形状补全** ✅ 2026-09-22
  - 把剩余 ENOENT/EACCES/EISDIR/ENOTDIR 等路径的错误码、`syscall`、`path`、`errno` 逐字对齐真 Node（VFS 层）。
  - 差分探针 `tools/fs-errors-probe.cjs`（51 个观测）在真 Node 与 web-node 各跑一遍，**0 diff**；错误对象本身也对齐（`constructor.name` = `Error`/`SystemError`、自有属性集、`name` 在原型上）。

- [x] **M97 · `module` 同步 loader 语义（hooks / SourceMap / findPackageJSON / 内部 loader 面）** ✅ 2026-09-22
  - `registerHooks`（同步 loader hooks：resolve/load 链、`next` 委托、`shortCircuit` 契约、`deregister`）、`SourceMap` 的注册/查找语义（`findSourceMap` + `setSourceMapsSupport`/`getSourceMapsSupport`）、`findPackageJSON`、`_load`/`_findPath`/`_readPackage`/`_stat`/`_preloadModules` 的 loader 面。
  - 差分探针 `tools/module-hooks-probe.cjs`（35 个观测）在真 Node/web-node 各跑一遍，**0 diff**。
  - `stripTypeScriptTypes` 拆到 **M97.1**（需真 TS 解析器）。

- [x] **M97.1 · `stripTypeScriptTypes`（TS strip-only）** ✅ 2026-09-23
  - 路线 = **选项 B（纯 JS strip-only）**：自研 TS 剥离器（`src/node-runtime/ts/strip-types.ts`，~1250 行），不引 amaro/SWC wasm。
  - 类型跨度按位覆写成空白、**按 UTF-8 字节宽度补位**（1→` `、2→U+00A0、3→U+2002、4→`' '+U+FEFF`；`\n`/`\r`/`\t` 保留），从而字节长度与真 amaro 一致。
  - 覆盖 `interface`/`type`/`declare`/`namespace`/`import type`/类型注解/类型参数与实参（含 `<` 比较回退）/`as`/`satisfies`/`!`/可选/参数属性/类字段/抽象成员/索引签名/类型谓词；不支持语法响亮抛 `ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`。
  - 差分探针 `tools/strip-ts-probe.cjs`（170 例）在真 Node v26.9.0 与 web-node 各跑一遍，**0 diff**；全仓库 227 个 `.ts` 扫描同样 **0 diff/0 hang**。
  - 选 B 的依据：实测 WebContainer（StackBlitz）同类场景亦为纯 JS 自实现（详见 `docs/webcontainer-research.md` 第 8 节）；不 vendor `amaro`（会把 worker 从 2.47MB → ~6.3MB）。

- [x] **M98 · `http`/`https` 报文级差分** ✅ 2026-09-22
  - 请求/响应全流程（keep-alive、pipeline、chunked、trailer 已在 M69 部分覆盖）的端到端差分；`https` 无 TLS 加密但语义对齐。
  - 差分探针 `tools/http-wire-probe.cjs`（http 12 + https 8 个请求，观测客户端与服务器两侧）在真 Node 与 web-node 各跑一遍，**0 diff**；修了 4 个真 bug（客户端 write() 分块、HEAD 无体、客户端过早半关、`https.globalAgent` 非 keep-alive）。

---

## 阶段 C — 平台无对应物的补齐（**已解散**，2026-09-23）✅ 2/2

> 这些「真 Node 能、浏览器平台没有对应物」。原策略是**响亮抛错**（正确姿态），确有需求才做。
> **2026-09-23 解散**：M99 / M100 的实现方式由「纯 JS 重写」改为「真上游 C/C++ 编 wasm」，已分别由**阶段 H 的 M116 / M117** 完成（就地打勾）；M101 依赖的 `internalBinding('zlib')` 已随 M116 就绪，**移入阶段 H**。

- [x] **M99 · `zlib` 同步形式 + 编码参数** ✅ 2026-09-23（**经阶段 H 的 M116 完成**）
  - `gzipSync`/`deflateSync`/… 与 `level`/`windowBits`/`memLevel`/`strategy`/`dictionary`/`flush()`。
  - 实现：真 `deps/zlib`（1.3.2.1-motley）编 wasm + `builtins/zlib.ts`（`lib/zlib.js` 的 zlib 半边移植）；差分 **0 diff**（详见 M116）。
  - 工作量：大（已落地）。

- [x] **M100 · `perf_hooks` 直方图** ✅ 2026-09-23（**经阶段 H 的 M117 完成**）
  - `createHistogram`/`importHistogram`/`monitorEventLoopDelay`。
  - 实现：真 `deps/histogram`（HdrHistogram）编 wasm + vendor 真 `lib/internal/histogram.js`；差分 **0 diff**（详见 M117）。
  - 工作量：中–大（已落地）。

- [⤳] **M101 · `stream/iter` 的 `transform`** → **移入阶段 H**
  - `internal/streams/iter/transform.js`（顶层 `internalBinding('zlib')`）——zlib 绑定已随 M116 就绪，可直接 vendor。

---

## 阶段 D — 运行时常量小项收尾

- [x] **M102 · `net.BoundSocket`** ✅ 2026-09-23
  - 无 OS 句柄，但可映射到 **web-node 的虚拟 TCP 层**：构造时就占住端口（冲突同步抛 `EADDRINUSE`），`address()` 返回虚拟地址、`close()` 释放、`isPipe`/`[Symbol.dispose]` 均已实现。
  - `fd()` 返回 **-1**（Node 在无 fd 的平台上也是如此），属已知偏离并写进 DEVLOG；unix-domain/pipe 绑定无虚拟对应物，**响亮抛**。
  - 差分探针 `tools/bound-socket-probe.cjs` → fixture `test/fixtures/bound-socket.json`，门禁 `test/bound-socket.test.ts`（逐字节 0 diff）。
  - 顺带修复 `internal/errors` 的 `ExceptionWithHostPort`/`UVExceptionWithHostPort`：原先 `code = String(err)`/写死 `UNKNOWN`，现按 `uvErrmapGet(err)` 解析（与 Node 同）。

- [x] **M103 · `http.Agent` 的连接方法** ✅ 2026-09-23
  - `Agent#createConnection(...)` 转发到 `net.createConnection`（无 proxy 时的 Node 行为）；`Agent#createSocket(req, options, cb)` 按 `lib/_http_agent.js` 移植：合并 options、`calculateServerName` 算 SNI、写 `_agentKey`/`encoding`、入池 `sockets[name]`、`totalSocketCount`、安装 free/close/timeout/agentRemove 监听。
  - 同时把 `removeSocket`/`keepSocketAlive`/`reuseSocket` 从空实现改为真实移植（含 `agentKeepAliveTimeoutBuffer`）。
  - 测试：`test/http-surface.test.ts` 新增 4 例（转发、池记账、SNI/IP、keep-alive hint）。

- [x] **M104 · `url.fileURLToPath({ windows: true })`** ✅ 2026-09-23
  - 按 `getPathFromURLWin32` 纯字符串实现：盘符 `C:\a\b`、UNC `\\server\share`（IDN 经 `domainToUnicode`）、`%2f`/`%5c` 一律报错、非绝对路径报错。
  - 测试：`test/url.test.ts` 新增一例（期望值逐个取自真 Node v26.9.0）。

- [x] **M105 · `console` / `v8` inspector 面收尾** ✅ 2026-09-23
  - 差分探针 `tools/console-v8-surface-probe.cjs` → fixture `test/fixtures/console-v8-surface.json`，门禁 `test/console-v8-surface.test.ts`：`console` 额外面（`Console`/`context`/`createTask`/`profile`/`profileEnd`/`timeStamp`/`timeLog`）与整个 `v8` 成员表、`createTask().run()`、`serialize` 往返、`cachedDataVersionTag`、`isStringOneByteRepresentation`、`startupSnapshot`、`setFlagsFromString` 全部逐字节对齐。
  - 修复发现的一处真 bug：`mksnapshot` binding 的 `isBuildingSnapshotBuffer` 应为 `Uint8Array([0])`（`[0]` 是数字 `0`，非 `false`），与真 Node 一致。

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
- **crypto 主线**：M34 同步面 · M47 对称密码 · M83 非对称 · M84 RSA 加密 + ECDH · M85 DH · M86 对称密钥生成 + FIPS · M87 X509Certificate 真解析 · M88 素数生成/素性检验 · M89 Argon2 · M90.1 MAC（HMAC + BLAKE2b MAC） · M90.2 KMAC（Keccak/SHA-3/cSHAKE） · M90.3 CMAC/GMAC（AES） · M90.4 BLAKE2s MAC / Poly1305 / SipHash · M90.5 SHA-3/Keccak/SHAKE/keccak-kmac · M90.6 BLAKE2b-512/BLAKE2s-256 · M90.7 SM3/RIPEMD-160 · M90.8 截断变体与复合摘要 · M90.9 getHashes 全表对齐（81/81） · M92.1 DH KeyObject · M92.2 crypto.diffieHellman · M93.1 ChaCha20-Poly1305 · M93.2 DES/3DES · M93.3 AES-CCM · M93.4a Camellia · M93.4b ARIA/SM4 · M93.4c OCB/wrap · M93.4d SIV/XTS · M94 crypto.Certificate（SPKAC） · M91 ML-KEM（FIPS 203）

---

## 怎么用这份文件

1. **开工前**：看「进度总览」知道还剩多少；从当前阶段往下挑第一个 `[ ]`。
2. **开工时**：把该项改成 `[~]`。
3. **完成后**：改成 `[x]`，并在 `docs/DEVLOG.md` 顶部加一条变更记录；刷新本文件「最后更新」的基线提交号与进度总览数字。
4. **新任务**：追加到对应阶段；若是新方向，开一个新阶段。
5. **条目被别的里程碑吸收时**：改标 `[⤳]` 并注明并入对象（不删、不再计数）。
6. **不做了**：移到「已判定不做」并写理由，别删（保留决策痕迹）。
