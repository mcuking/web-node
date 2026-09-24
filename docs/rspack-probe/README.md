# rspack-probe —— `@rspack/binding-wasm32-wasi` 浏览器可行性 spike

**日期**：2026-09-24 · **对应**：M121（rspack 一侧）/ 阶段 F 构建工具链 · **结论**：浏览器可行（见下）。

这是把 `@rspack/binding-wasm32-wasi` 官方浏览器入口放进**跨源隔离页（COOP/COEP）**做的一次退险实测，
用来回答「rspack 的 wasm binding 在纯浏览器里到底能不能跑、哪种 API 能跑」。**不改产品代码**。

## 复现

```bash
# Node v26.9.0（fnm）
mkdir rspack-spike && cd rspack-spike
cp -r <本目录>/src .            # entry.js / worker.js
cp <本目录>/index.html <本目录>/vite.config.js <本目录>/package.json .
npm i                          # 装 vite 6.4.3
# 装 wasm32 binding 必须加 --force --cpu=wasm32（否则 EBADPLATFORM: 机器是 arm64）
npm i --force --cpu=wasm32 @rspack/binding-wasm32-wasi@2.2.7
npx vite --port 8799           # vite.config.js 已注入 COOP/COEP header
# 浏览器开 http://localhost:8799/ ，控制台读 window.__msgs
```

## 实测结论

1. **能在跨源隔离页里加载并实例化**：`crossOriginIsolated=true`、`SharedArrayBuffer` 可用；binding 导出 73 个键，
   `EXPECTED_RSPACK_CORE_VERSION=2.2.7`。它是 napi-rs/emnapi 的 wasm 产物，需要 **2GB 固定共享内存**
   （`initial:32768, maximum:32768, shared:true`）与自带 memfs（`@napi-rs/wasm-runtime/fs`）。
2. **同步 API 可用**：`transformSync('const x: number = 1;', …)` → `var x = 1;`。
3. **同步阻塞型 API 死锁**：`minifySync` 在**主线程**报 `Atomics.wait cannot be called in this context`；
   在 **Worker** 里（默认 `asyncWorkPoolSize:4` 线程池）**永久挂起**（线程子 worker 起来了、无回信）。
4. **异步 API 可用**：`await binding.minify(code, opts)` → 真压缩输出 `const add=(o,c)=>o+c;console.log(3);`；
   `await binding.transform(...)` 同样 OK。→ **rspack 的 production/minify 走的就是 async 路径**，这条能用。
5. **binding 自带 memfs 与 Rust 连通**：导出 `__fs` / `__volume`；JS 侧 `vol.writeFileSync('/proj/index.js', …)`
   写入后 Rust 侧能读到（`binding.loadBrowserslist('/proj','production')` 正常返回，不再抛 `Failed to convert … into rust type String`）。
6. **错误通道**：worker 里要 `globalThis.window = globalThis`（rspack 的错误回调经 `window.dispatchEvent`）。

## 接入 web-node 时真正的两道缝（未做）

- **wasm 资产如何喂进去**：这里用 Vite 的 `?url` 处理 30MB 的 `rspack.wasm32-wasi.wasm`；
  web-node 运行时在 Worker 内，需要有等价的「把 wasm 资产交给 binding」的加载方式。
- **两套 FS 的桥接**：binding 的 Rust 侧只认它自带的 memfs，**看不见 web-node 的 VFS**。
  真正接入时要在「web-node VFS ↔ binding memfs」之间做同步（写进去、读出来），这是关键缝。

## 文件

- `src/entry.js` —— 页面入口：加载 binding、起 worker、收集 `__msgs`。
- `src/worker.js` —— worker 内跑 `transformSync` / `await minify` / `await transform` / memfs 读写 / `loadBrowserslist`。
- `vite.config.js` —— COOP/COEP/ CORP 头 + `optimizeDeps.exclude`。
- `index.html` —— 挂载点。
