// M115 冒烟：native → WASM 接入缝。
//
// 这是 `test/_*.test.ts`（tsconfig 排除）：它用 `node:fs` 读真磁盘上的 wasm
// 产物，而 `types: []` 不提供 `node:fs` 的类型。vitest 仍会跑它。
// 产物缺失时（没跑过 `npm run build:native`）整体 skip，而不是报模块解析错。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { instantiateWasm } from '../src/node-runtime/wasm/loader';
import { installWasm, wasmLoaded, wasmModule } from '../src/node-runtime/wasm/registry';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

const here = dirname(fileURLToPath(import.meta.url));
const artifact = join(here, '..', 'src', 'node-runtime', 'wasm', 'artifacts', 'wn_stub.wasm');
const hasArtifact = existsSync(artifact);

// wasm32-wasip1 的反应堆模块：导出这些名字。
const EXPECTED_EXPORTS = [
  'memory',
  '_initialize',
  'wn_stub_add',
  'wn_stub_alloc_fill',
  'wn_stub_free',
  'wn_stub_version',
];

function boot(): NodeRuntime {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  return new NodeRuntime({ vfs, argv: ['/project/index.js'], installGlobals: false, onStdout: () => {}, onStderr: () => {} });
}

describe.skipIf(!hasArtifact)('native -> WASM seam (M115)', () => {
  // 装入真产物（模拟 worker 启动期 fetch + 编译的结果）。
  installWasm('wn_stub', instantiateWasm(readFileSync(artifact)));

  it('instantiates the compiled wasm and exposes exactly its declared exports', () => {
    const exports = wasmModule('wn_stub');
    expect(wasmLoaded('wn_stub')).toBe(true);
    const present = Object.keys(exports).filter((k) => EXPECTED_EXPORTS.includes(k)).sort();
    expect(present).toEqual([...EXPECTED_EXPORTS].sort());
    expect(exports.memory).toBeInstanceOf(WebAssembly.Memory);
    // 只精确导出（`export_name`），libc 内部符号不泄出。
    expect('malloc' in exports).toBe(false);
    expect('free' in exports).toBe(false);
  });

  it('calls an exported function through internalBinding', () => {
    const rt = boot();
    const stub = rt.realm.internalBinding('wn_stub') as { add: (a: number, b: number) => number };
    expect(stub.add(2, 40)).toBe(42);
    expect(stub.add(-5, 5)).toBe(0);
  });

  it('reads a static string out of the linear memory', () => {
    const rt = boot();
    const stub = rt.realm.internalBinding('wn_stub') as { version: () => string };
    expect(stub.version()).toBe('web-node wasm stub 1');
  });

  it('round-trips bytes through malloc/free in the module memory', () => {
    const rt = boot();
    const stub = rt.realm.internalBinding('wn_stub') as { roundTrip: (len: number, seed: number) => Uint8Array };
    const out = stub.roundTrip(8, 250);
    expect([...out]).toEqual([250, 251, 252, 253, 254, 255, 0, 1]);
  });
});
