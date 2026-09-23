/**
 * native → WASM（M115）：已实例化 wasm 模块的注册表。
 *
 * 绑定工厂（`bindings/*.ts`）在 Realm 构造期**同步**运行，而 wasm 的字节要
 * **异步**取。两者靠这张表解耦：宿主（worker 启动、或测试）先把模块实例化好
 * 装进来，绑定再同步取用。取不到就是编程错误——响亮抛，绝不静默返回 undefined
 * （那会让调用点以 "is not a function" 在某个罕至路径上炸开）。
 */
import type { WasmExports } from './loader';

const installed = new Map<string, WasmExports>();

/** 装入一个已实例化的模块（同名覆盖，便于热重载/测试重置）。 */
export function installWasm(name: string, exports: WasmExports): void {
  installed.set(name, exports);
}

/** 取一个模块的导出表；未加载则抛。 */
export function wasmModule(name: string): WasmExports {
  const exports = installed.get(name);
  if (exports === undefined) {
    throw new Error(`wasm module "${name}" is not loaded`);
  }
  return exports;
}

/** 该模块是否已加载。 */
export function wasmLoaded(name: string): boolean {
  return installed.has(name);
}

/** 已加载的模块名（排序）。 */
export function wasmModuleNames(): string[] {
  return [...installed.keys()].sort();
}
