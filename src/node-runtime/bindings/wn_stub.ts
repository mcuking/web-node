/**
 * `wn_stub` —— native → WASM 接入缝的冒烟 binding（M115）。
 *
 * 它**不实现任何真实 Node binding**，只证明这条链通了：
 *   真 C 源码 → wasi-sdk（wasm32-wasip1）→ 实例化 → `internalBinding('wn_stub')` 取用。
 * 覆盖了导出函数、线性内存、`malloc`/`free` 三件事。M116 起，zlib / histogram /
 * crypto 会以同样方式接进来，只是导出表和包装更厚。
 *
 * 取用方式与真 Node 一致：绑定工厂在 Realm 构造期同步运行，从
 * {@link ../wasm/registry} 里同步取已实例化的模块（worker 启动时已 fetch + 编译好）。
 */
import type { BindingContext } from './context';
import { wasmModule } from '../wasm/registry';

/** 该模块的导出表（未加载则抛，绝不静默返回 undefined）。 */
function exports(): Record<string, unknown> {
  return wasmModule('wn_stub');
}

/** 模块的线性内存。 */
function memory(): WebAssembly.Memory {
  return exports().memory as WebAssembly.Memory;
}

export function wnStubBinding(_ctx: BindingContext): Record<string, unknown> {
  return {
    /** 两数相加：最简「导出函数 → 宿主调用」链。 */
    add(a: number, b: number): number {
      const fn = exports().wn_stub_add as (a: number, b: number) => number;
      return fn(a | 0, b | 0);
    },

    /** 读只读数据段里的静态字符串（数据段 + 指针 → 字符串）。 */
    version(): string {
      const ptr = (exports().wn_stub_version as () => number)();
      const bytes = new Uint8Array(memory().buffer);
      let end = ptr;
      while (bytes[end] !== 0) end++;
      return new TextDecoder().decode(bytes.subarray(ptr, end));
    },

    /**
     * `malloc` → 写入 → 拷回 → `free`：验证内存 ABI。
     * 返回的是**拷贝**（不是视图），所以 `free` 之后依然有效。
     */
    roundTrip(len: number, seed: number): Uint8Array {
      const ex = exports();
      const ptr = (ex.wn_stub_alloc_fill as (n: number, s: number) => number)(len | 0, seed & 0xff);
      if (ptr === 0) throw new Error('wn_stub: allocation failed');
      try {
        return new Uint8Array(memory().buffer, ptr, len).slice();
      } finally {
        (ex.wn_stub_free as (p: number) => void)(ptr);
      }
    },
  };
}
