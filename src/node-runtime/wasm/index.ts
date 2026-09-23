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

/** 模块名 → 资产 URL。名字即 `internalBinding(...)` 将来取用的键。 */
export const WASM_MODULES: Record<string, string> = {
  wn_stub: wnStubUrl,
  wn_zlib: wnZlibUrl,
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
export async function loadWasmModules(options: LoadWasmOptions = {}): Promise<void> {
  const modules = options.modules ?? WASM_MODULES;
  const fetchImpl = options.fetch ?? fetch;
  await Promise.all(
    Object.entries(modules).map(async ([name, url]): Promise<void> => {
      if (wasmLoaded(name)) return;
      const res = await fetchImpl(absolute(url));
      if (!res.ok) throw new Error(`wasm module "${name}": HTTP ${res.status} for ${url}`);
      const exports: WasmExports = instantiateWasm(await res.arrayBuffer(), options.imports?.(name) ?? {});
      installWasm(name, exports);
    }),
  );
}

export { instantiateWasm } from './loader';
export { installWasm, wasmLoaded, wasmModule, wasmModuleNames } from './registry';
export type { WasmExports } from './loader';
