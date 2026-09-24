globalThis.window = globalThis;
const post = (a) => { try { self.postMessage(a); } catch {} };
const mod = await import('@rspack/binding-wasm32-wasi');
const binding = mod.default || mod;
const fs = mod.__fs, vol = mod.__volume;
post([['memfs', 'OK', 'fs=' + typeof fs + ' vol=' + typeof vol + ' keys=' + Object.keys(mod).filter(k=>k.startsWith('__')).join(',')]]);
try {
  vol.mkdirSync('/proj', { recursive: true });
  vol.writeFileSync('/proj/package.json', JSON.stringify({ name: 'demo', version: '1.0.0', browserslist: ['ie 11'] }));
  vol.writeFileSync('/proj/index.js', 'const a = 1; export default a;\n');
  vol.writeFileSync('/proj/.browserslistrc', 'ie 11\n');
  vol.writeFileSync('/proj/package.json', JSON.stringify({ name: 'demo', version: '1.0.0', browserslist: ['chrome 50'] }));
  post([['write', 'OK', 'wrote 2 files; readback=' + String(vol.readFileSync('/proj/index.js')).slice(0,40)]]);
} catch (e) { post([['write', 'ERR', String(e && e.message)]]); }
// Rust 读 memfs：loadBrowserslist 会读 package.json 的 browserslist
try {
  const r = binding.loadBrowserslist('/proj', 'production');
  post([['loadBrowserslist', 'OK', JSON.stringify(r).slice(0, 300)]]);
} catch (e) { post([['loadBrowserslist', 'ERR', String(e && e.message).slice(0,300)]]); }
post([['done', 'OK', '']]);
