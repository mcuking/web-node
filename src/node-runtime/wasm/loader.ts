/**
 * native → WASM（M115）：把一个 wasm32-wasip1 模块的字节实例化成可调用的导出表。
 *
 * 为什么是**同步**实例化：`internalBinding()` 的绑定表在 Realm 构造期同步建好
 * （Node 内部代码在模块顶层就 `internalBinding(...)` 并解构），所以 wasm 不能在
 * 绑定被读取时才异步加载。编译（`WebAssembly.Module`）本身是同步的，只有
 * **取字节**是异步的——于是流程是「worker 启动时先 fetch + 编译好，再建 Realm」，
 * 绑定工厂随后同步地从 {@link ../wasm/registry} 取用。
 *
 * 模块模型用 **reactor**（`-mexec-model=reactor`，无 `_start`）：它导出一个
 * `_initialize`，跑一次静态构造器（`__wasm_call_ctors`，wasi-libc 的初始化），
 * 之后导出函数即可反复调用。
 */

/** wasm 模块导出表：函数、内存、全局量、表都在这上面。 */
export type WasmExports = Record<string, unknown>;

/**
 * 编译并实例化一个 wasm 模块，调用一次 `_initialize`（如果是 reactor 模型）。
 *
 * @param bytes   模块字节（`ArrayBuffer` / `Uint8Array` / `WebAssembly.Module`）
 * @param imports 导入对象（WASI 宿主、宿主函数等）。纯计算模块通常为空。
 */
export function instantiateWasm(bytes: BufferSource, imports: WebAssembly.Imports = {}): WasmExports {
  const module = new WebAssembly.Module(bytes);
  const instance = new WebAssembly.Instance(module, imports);
  const exports = instance.exports as WasmExports;
  const initialize = exports._initialize;
  if (typeof initialize === 'function') {
    (initialize as () => void)();
  }
  return exports;
}
