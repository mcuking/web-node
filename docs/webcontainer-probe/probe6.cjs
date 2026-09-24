const out = (k, v) => console.log(k, '::', typeof v === 'string' ? v : JSON.stringify(v));
const guard = setTimeout(() => { out('DONE', ''); process.exit(0); }, 20000);

// ===== http2 =====
try {
  const h2 = require('http2');
  out('H2-keys', Object.keys(h2).join(','));
  out('H2-constants-sample', 'SETTINGS_TIMEOUT=' + h2.constants.NGHTTP2_SETTINGS_TIMEOUT + ' ERR_CODE_NO_ERROR=' + h2.constants.NGHTTP2_NO_ERROR);
  out('H2-getDefaultSettings', JSON.stringify(h2.getDefaultSettings().headerTableSize));
  // 本地 h2c server + 自连（纯 nghttp2，不经 TLS）
  const srv = h2.createServer();
  srv.on('stream', (stream) => { stream.respond({ ':status': 200 }); stream.end('h2-body'); });
  srv.listen(0, () => {
    const port = srv.address().port;
    const cli = h2.connect('http://localhost:' + port);
    const req = cli.request({ ':path': '/' });
    let body = ''; let status = 0;
    req.on('response', (h) => { status = h[':status']; });
    req.on('data', (d) => { body += d; });
    req.on('end', () => out('H2-LOOPBACK', status + ' ' + body));
    req.on('error', (e) => out('H2-LOOPBACK-err', (e && e.code) || e.message));
    req.end();
    setTimeout(() => { try { cli.close(); srv.close(); } catch {} }, 3000);
  });
} catch (e) { out('H2-throw', (e && e.code) || e.message); }

// ===== node:sqlite =====
try {
  const { DatabaseSync } = require('node:sqlite');
  const db = new DatabaseSync(':memory:');
  db.exec('CREATE TABLE t(a INTEGER, b TEXT)');
  db.prepare('INSERT INTO t(a,b) VALUES(?,?)').run(1, 'hello');
  db.prepare('INSERT INTO t(a,b) VALUES(?,?)').run(2, 'wc');
  const rows = db.prepare('SELECT a,b FROM t ORDER BY a').all();
  out('SQLITE-rows', JSON.stringify(rows));
  out('SQLITE-version', db.prepare('SELECT sqlite_version() v').get().v);
} catch (e) { out('SQLITE-throw', (e && e.code) || e.message); }

// ===== node:wasi =====
try {
  const { WASI } = require('node:wasi');
  const fs = require('fs');
  const wasmBytes = fs.readFileSync('wasi_probe.wasm');
  const wasi = new WASI({ version: 'preview1', args: [], env: { WC_PROBE: 'hello-wc' } });
  WebAssembly.instantiate(wasmBytes, wasi.getImportObject ? wasi.getImportObject() : { wasi_snapshot_preview1: wasi.wasiImport })
    .then(({ instance }) => {
      wasi.initialize(instance);
      out('WASI-add', instance.exports.probe_add(1, 2));
      out('WASI-env-len', instance.exports.wasi_env());
      const r = instance.exports.wasi_hello();
      out('WASI-hello-ret', r);
    })
    .catch((e) => out('WASI-inst-err', (e && e.message)));
} catch (e) { out('WASI-throw', (e && e.code) || e.message); }

// ===== node:sea =====
try {
  const sea = require('node:sea');
  out('SEA-keys', Object.keys(sea).join(','));
  out('SEA-isSea', sea.isSea());
  try { out('SEA-getAssetKeys', JSON.stringify(sea.getAssetKeys())); } catch (e) { out('SEA-getAssetKeys-err', e.message); }
} catch (e) { out('SEA-throw', (e && e.code) || e.message); }
