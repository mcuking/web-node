import * as binding from '@rspack/binding-wasm32-wasi';
globalThis.__rspackKeys = Object.keys(binding).length;
globalThis.__msgs = [];
globalThis.__winErrs = [];
addEventListener('error', (e) => globalThis.__winErrs.push(['error', e.message]));
addEventListener('unhandledrejection', (e) => globalThis.__winErrs.push(['rejection', String(e.reason)]));
new Promise((res) => {
  const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
  w.onmessage = (e) => globalThis.__msgs.push(e.data);
  w.onerror = (e) => globalThis.__msgs.push([['worker-error', 'ERR', e.message]]);
  setTimeout(res, 22000);
});
console.log('BINDING-KEYS ::', Object.keys(binding).length);
