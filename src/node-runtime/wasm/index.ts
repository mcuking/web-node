/**
 * native → WASM（M115）：模块清单 + 启动期加载。
 *
 * 每个模块作为**独立静态资产**随构建产出（`?url` 导入 → Vite 按内容哈希发到
 * `assets/`），worker 启动时 `fetch` + 实例化，之后绑定同步取用。**不内联进
 * worker bundle**：那是 M107 的教训（大载荷内联会撑大 worker 并拖慢冷启动）。
 *
 * 新增一个 wasm 模块 = ① `native/src/<name>.c` 里用
 * `__attribute__((export_name(...)))` 声明导出；② `node native/build.mjs`；
 * ③ 在下面的 {@link WASM_MODULES} 里登记它的资产。
 */
import wnStubUrl from './artifacts/wn_stub.wasm?url';
import wnZlibUrl from './artifacts/wn_zlib.wasm?url';
import wnHistogramUrl from './artifacts/wn_histogram.wasm?url';
import wnBrotliUrl from './artifacts/wn_brotli.wasm?url';
import wnZstdUrl from './artifacts/wn_zstd.wasm?url';
import { instantiateWasm, type WasmExports } from './loader';
import { installWasm, wasmLoaded } from './registry';

/**
 * 模块名 → 资产 URL。名字即 `internalBinding(...)` 将来取用的键。
 *
 * 这里的模块在**建 Realm 之前**取回并实例化（`loadWasmModules`），因为绑定表是
 * 同步构建的、且 `internalBinding('zlib')` 之类在建 Realm 时就要能用。
 */
export const WASM_MODULES: Record<string, string> = {
  wn_stub: wnStubUrl,
  wn_zlib: wnZlibUrl,
};

/**
 * 启动**可选**的大模块（M107）：brotli / zstd / hdr_histogram。
 *
 * 它们只在**真正用到**时才被取用（`zlib.brotliCompress*`、`zlib.zstdCompress*`、
 * `perf_hooks.monitorEventLoopDelay` / `perf_hooks.Histogram`），建 Realm 与绑定表
 * 完全不碰（`ex()` 只在 codec / 直方图的构造器与方法里调用）。
 *
 * 所以它们**不必**卡在启动关键路径上：启动期只发起后台加载（低优先级，不抢关键
 * 载荷的带宽），Realm 立刻构建，`ready` 立刻上报；而**任何会执行用户代码的请求**
 * 都会先 await 这批模块（见 worker），所以同步 API 绝不会在模块缺席时被调用。
 * 三者 gzip 合计 ~563 KB（brotli 331 + zstd 132 + histogram 100），是启动期最大的一
 * 块可移动载荷。
 */
export const DEFERRED_WASM_MODULES: Record<string, string> = {
  wn_histogram: wnHistogramUrl,
  wn_brotli: wnBrotliUrl,
  wn_zstd: wnZstdUrl,
};

export interface LoadWasmOptions {
  /** 覆盖模块清单（测试用）。 */
  modules?: Record<string, string>;
  /** 覆盖 fetch（测试用）。 */
  fetch?: typeof fetch;
  /** 每个模块的导入对象（WASI 宿主等）。默认空。 */
  imports?: (name: string) => WebAssembly.Imports | undefined;
}

/** 把 URL 解析成绝对地址（worker/page 里相对 `location` 处理 base 前缀）。 */
function absolute(url: string): string {
  const href = (globalThis as { location?: { href?: string } }).location?.href;
  if (!href) return url;
  try {
    return new URL(url, href).href;
  } catch {
    return url;
  }
}

/**
 * 取回并实例化清单里的所有模块（已在注册表里的跳过）。
 *
 * 必须在建 Realm **之前** await 完：`require` 与绑定表都是同步的。
 */
async function loadModules(
  modules: Record<string, string>,
  options: LoadWasmOptions,
  priority: 'low' | 'high',
): Promise<void> {
  const fetchImpl = options.fetch ?? fetch;
  await Promise.all(
    Object.entries(modules).map(async ([name, url]): Promise<void> => {
      if (wasmLoaded(name)) return;
      const res = await fetchImpl(absolute(url), { priority } as RequestInit & { priority: string });
      if (!res.ok) throw new Error(`wasm module "${name}": HTTP ${res.status} for ${url}`);
      const exports: WasmExports = instantiateWasm(await res.arrayBuffer(), options.imports?.(name) ?? {});
      installWasm(name, exports);
    }),
  );
}

/**
 * 取回并实例化清单里的所有模块（已在注册表里的跳过）。
 *
 * 必须在建 Realm **之前** await 完：`require` 与绑定表都是同步的。
 */
export async function loadWasmModules(options: LoadWasmOptions = {}): Promise<void> {
  return loadModules(options.modules ?? WASM_MODULES, options, 'high');
}

/**
 * 后台取回并实例化「启动可选」的大模块（M107）。
 *
 * 不必在启动关键路径上等待，但**必须在执行任何用户代码前完成**（调用方负责 await
 * 本 Promise）。任何一个失败都抛——这些模块没有纯 JS 回退，静默缺席会让 API 在罕至
 * 路径上以 “is not a function” 炸开，而不是诚实地报错。
 */
export async function loadDeferredWasmModules(options: LoadWasmOptions = {}): Promise<void> {
  return loadModules(options.modules ?? DEFERRED_WASM_MODULES, options, 'low');
}

export { instantiateWasm } from './loader';
export { installWasm, wasmLoaded, wasmModule, wasmModuleNames } from './registry';
export type { WasmExports } from './loader';
