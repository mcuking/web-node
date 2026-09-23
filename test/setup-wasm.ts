/**
 * Test setup: instantiate the native→WASM modules from the committed artifacts
 * (M115/M116) before any test runs.
 *
 * In the browser the worker fetches each `artifacts/*.wasm` as a content-hashed
 * asset; tests run in Node with no URL loader, so here they are read off disk.
 * The compiled modules are plain `WebAssembly.Module`s, so this is the same
 * instantiation path (`instantiateWasm`) the worker uses.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { instantiateWasm } from '../src/node-runtime/wasm/loader';
import { installWasm } from '../src/node-runtime/wasm/registry';

const DIR = 'src/node-runtime/wasm/artifacts';

for (const entry of readdirSync(DIR, { withFileTypes: true })) {
  if (entry.isDirectory() || !entry.name.endsWith('.wasm')) continue;
  const name = entry.name.slice(0, -'.wasm'.length);
  installWasm(name, instantiateWasm(readFileSync(`${DIR}/${entry.name}`) as unknown as BufferSource));
}
