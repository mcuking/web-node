# native/ — 把 Node 的 native 层编成 WASM（M115）

这里是 native → WASM 迁移的**编译入口**。目标是让 `internalBinding()` 背后那层，
从「TS 手写 shim / 平台 API 适配」换成「**真上游 C/C++ 源码编出的 wasm 模块**」
（即 StackBlitz WebContainer 的形态：JS 层用 Node 自己的 `lib/`，native 层是编译产物）。

- 设计文档：[`../docs/superpowers/specs/2026-09-23-native-to-wasm-design.md`](../docs/superpowers/specs/2026-09-23-native-to-wasm-design.md)
- 路线图：[`../docs/ROADMAP.md`](../docs/ROADMAP.md) 阶段 H

## 工具链

[wasi-sdk](https://github.com/WebAssembly/wasi-sdk)（自包含：clang + wasi-libc + wasm-ld）。
本机装在 `~/wasi-sdk-34.0`（也可用 `WASI_SDK_PATH` 指定）。

## 构建

```sh
npm run build:native              # 编 native/src/*.c
npm run build:native -- --inspect # 编完打印每个模块的 imports/exports
```

产物写到 `src/node-runtime/wasm/artifacts/`（**提交进仓库**：于是部署/CI 不需要工具链），
并由 `Vite` 按 `?url` 以内容哈希发到 `assets/`。worker 启动时 `fetch` + 实例化，
**不**内联进 worker bundle（M107 的教训）。

## 加一个模块

1. `native/src/<name>.c`：用 `__attribute__((export_name("..."), used))` 精确声明导出
   （这样不必给 `wasm-ld` 传 `--export-all`，libc 内部符号不会泄进导出表）。
2. `npm run build:native`。
3. 在 `src/node-runtime/wasm/index.ts` 的 `WASM_MODULES` 里登记资产。
4. 在 `src/node-runtime/bindings/<name>.ts` 里把导出包装成 binding，并注册进
   `src/node-runtime/bindings/index.ts` 的 `REGISTRY`。

## 编译参数约定

```
--target=wasm32-wasip1   # wasi-sdk 34 / LLVM 23 的目标名（wasm32-wasi 已弃用）
-mexec-model=reactor     # 无 _start；导出 _initialize，跑一次静态构造器
-O2 -Wall
-Wl,--no-entry
```

## M115 的桩

`src/wn_stub.c` 不实现任何真实 Node binding，只验证接入缝：导出函数、线性内存、
`malloc`/`free`。M116 起，真实模块（zlib、histogram、crypto…）会替换掉它。
