# 对标 WebContainer：web-node 还能优化什么（2026-10-12）

> **起因**：唐工要求「对标 WebContainer，看哪里还能优化」。
> **口径**：research（`docs/webcontainer-research.md` 第九–十一节，活体实测）+ 仓库现有规划（`docs/ROADMAP.md`）**已经落地**的东西不重复立项；本文只找**它们之外**、WebContainer 仍领先或我们仍缺的优化面。
> **已核对**：文中「web-node 现状」一列均**看过代码**（附文件/行），非凭印象。

---

## 0. 一句话结论

「阶段 I（借鉴 WebContainer）」的 5 条可借鉴点**已全部落地**（M113 子域路由 · M120 同步 fs · M122 出网 · M123 多进程 · M124/M127 行为门禁）。本盘点在其之外找出 **3 个值得做（1 个 P0、2 个 P1）+ 3 个明确不做**。**其中 P0（真并行 = M147）与 P1 的 `node:sqlite`（= M148）已于 2026-10-12 落地**；剩余：P1 隔离模型（产品定位决定）+ 2 个 P2（npm 安装加速、浏览器兼容探测）。

---

## 1. 逐维度对照（现状已核代码）

| 维度 | WebContainer（实测） | web-node 现状（已核） | 谁领先 / 机会 |
|---|---|---|---|
| **进程模型 / 真并行** | 1 进程 = 1 **真 Web Worker**，天然多核并行 | `worker_threads` 是「**同事件循环的第二模块注册表** + 真 `MessageChannel`，**无真并行**」（`builtins/worker-threads.ts:14-16`）；`fork`/`cluster` 同理 | **它领先** → 🔴 P0 |
| **启动** | `boot()` **5.1s**；自研 runtime | `runtimeReady` 冷 ~1753ms / **暖 341–349ms**；M107/M126 已把关键载荷压到 ~gzip 418KB | **我们领先**，不必追 |
| **JS 代码缓存 / 快照** | 编译产物 + 快照启动 | 浏览器造不出 V8 code cache：`vm.compileFunction` 的 `cachedData` 明确 `notImplemented('A page cannot consume V8 code cache.')`（`bindings/contextify.ts:279`） | 浏览器能力所限 → ⚫ 不做 |
| **隔离模型** | 每项目 **credentialless iframe + 独立子域 origin** | 运行时跑在**主页面单 origin**（单页沙箱）；COOP/COEP 已由 `sw.js` 补（M134） | **它领先** → 🟠 P1 |
| **预览路由** | `<port>` 编进子域 + 每端口 DevServer SW（可离线） | dev `<port>.localhost` + 静态通配域（M113），路径式兜底 | **已对齐** |
| **出网（egress）** | 宿主源 `Fetcher Worker` + 托管 proxy | `Egress` 走宿主源 worker `fetch` + 可选 proxy（M122） | **已对齐** |
| **TLS** | 边缘终止，不做真握手 | 记录材料不握手 | 共性，不做 |
| **native 覆盖** | **真 Node.js 编 wasm**：icu/nghttp2/sqlite/wasi 在，但 **http2 连接崩、sqlite 原型无方法、sea 是桩** | 精选子集 + 缺失**响亮抛错**；zlib/brotli/zstd/histogram/openssl 已真 C→wasm；crypto 非对称**它反而跑不了** | 各有取舍 → 🟠 P1（sqlite） |
| **文件系统** | **纯内存**（refresh 即干净） | 内存 VFS + **OPFS 持久化**（含 `fsync` 真落盘、FS-worker） | **我们领先** |
| **浏览器支持** | Chrome/Edge/Firefox（已 wasm 化） | 未做兼容矩阵/探测（SAB→COOP/COEP 已就绪） | 🟡 P2（验证即可） |

---

## 2. 优化清单（按优先级）

### 🔴 P0 · `worker_threads` 换成真 Web Worker（真并行）✅ 2026-10-12（M147）
- **现状**：`builtins/worker-threads.ts` / `proc/worker.ts` 是「同事件循环第二注册表」，语义对（消息/`workerData`/退出序都对齐）但**无 CPU 并行**。`cluster` 同理。
- **为什么是最大机会**：WebContainer 靠「1 进程 = 1 worker」拿到**真多核**；我们跑 webpack 时，**terser 压缩经 `jest-worker` 走 `worker_threads` 实际仍在同一线程**（M121 记录「minifier 在 worker 线程里跑起来了」= 跑起来了但没并行）。大项目压缩是**并行度敏感**的。
- **为什么现在可行**：拼图**已齐**——① M125 已证明「用真浏览器 `Worker` 承载子线程」在本仓库能跑通（emnapi 线程池就是真 Worker）；② M120 已有 **SAB + `Atomics.wait` + FS-worker** 的同步 VFS 通道；③ M134 已有 `crossOriginIsolated`（真 Worker 共享内存的前置）。把两者一拼，就是 WebContainer 的「worker-per-process + 共享 FS」。
- **要点/坑**：真 Worker 里**拿不到**父侧内存模块注册表 → 每个 worker 起**自己的 runtime 注册表**（已有 `proc/worker.ts` 的模式）；VFS 客户端走 `sab-rpc` 回环到**唯一写者** `fs.worker`（已是现状）；`SharedArrayBuffer` 要求 `crossOriginIsolated`，非隔离环境如实降级为「同线程」（保持现在行为）。
- **解锁**：webpack/rspack 多核压缩、真 `fork`/`cluster` 并行、任何 `jest-worker`/`piscina` 负载。
- **工作量**：中–大；**风险**：中（生命周期/退出序、stdio 复用 M120 通道）。

### 🟠 P1 · `node:sqlite` → 真上游 `sqlite3.c` 编 wasm ✅ 2026-10-12（M148）
- **现状**：`sqlite` 在 `UNSUPPORTED_BINDINGS`（`require` 得类型化错）。WebContainer 里 `DatabaseSync` **类在、原型无方法**（`db.exec is not a function`）——**谁都没真做**。
- **做法**：**完全复刻 `wn_zlib`/`wn_brotli`/`wn_zstd` 的既有模式**——`native/build.mjs` 登记 `wn_sqlite`（上游 `sqlite3.c` amalgamation → wasi-sdk → wasm），`bindings/sqlite.ts` 包成 `DatabaseSync`/`StatementSync` 表面，VFS 用内存（或 OPFS）。
- **为什么值**：把对手的「半成品」做成真可用是**差异化**；解锁带本地 DB 的 demo（Drizzle/Prisma 类）。
- **工作量**：中；**风险**：低–中（SQLite 自带 VFS 接口，内存 VFS 现成）。

### 🟠 P1 · 隔离模型：运行时/预览进 credentialless iframe + 独立 origin
- **现状**：运行时在主页面单 origin；预览已有子域（M113）。
- **对标**：WebContainer 每个项目是 **`w-credentialless` 子域的 iframe**，`COEP: credentialless` 同时满足「SAB 可用」与「能加载第三方资源」。
- **收益/代价**：跑**不可信用户代码**时的安全性显著提升（凭据不随 iframe 带出、跨站数据隔离）；代价是**架构级改动**（消息桥、SW scope、预览转发全要走 iframe）。
- **判断**：**产品定位决定要不要做**——若这个 demo 明确要「执行别人的代码」，值得；若只是自家 demo，可缓。

### 🟡 P2 · npm install 加速（可选服务端 proxy）
- WebContainer 走「托管 proxy + server-side 加速」。我们全客户端解析。可优化：registry 元数据**缓存进 OPFS**、tarball **并行取**、可选受控 proxy（`VITE_WEB_NODE_EGRESS_PROXY` 已存在）。**收益中等、非瓶颈**，视安装耗时再定。

### 🟡 P2 · 浏览器兼容矩阵 / 探测
- WebContainer 已支持 Firefox（wasm 化）。我们**未做**兼容性探测与降级提示（非隔离环境已如实降级，但没有「能力探测 + 用户可见说明」）。**低成本**：加一个能力探测（SAB / `crossOriginIsolated` / OPFS）并在不支持时给明确提示。

### ⚫ 明确不做
- **V8 code cache / 启动快照**：浏览器侧**造不出** code cache（见 §1 代码证据），且我们启动**已经比它快**（暖 341ms vs boot 5.1s）。
- **出网真 TLS 握手**：两边都**边缘终止/不做**，是这类架构共性，不做。
- **`http2` / `ffi` / `quic`**：WebContainer 的 `http2` **加载 OK 一用就崩**；我们「响亮抛错」更诚实。真做得上真 nghttp2（同 C→wasm 模式），但**需求极低**，不排期。

---

## 3. 建议的下一步

1. ~~**先做 P0（真并行）**~~ ✅ 2026-10-12（M147）——真 Web Worker 并行已落地（四阶段：同步 VFS 桥 / 真线程运行时 / 跨 realm 端口转移 / 并发上限）。
2. ~~**再做 P1 的 `node:sqlite`**~~ ✅ 2026-10-12（M148）——真上游 SQLite amalgamation 编 wasm，同步 API 真可用。
3. **剩余候选**：P1 隔离模型（等产品定位：要不要跑不可信代码）；P2 npm 安装加速（OPFS 缓存 / 并行 tarball / 可选 proxy）；P2 浏览器兼容探测（SAB / `crossOriginIsolated` / OPFS 能力探测 + 降级提示）。
