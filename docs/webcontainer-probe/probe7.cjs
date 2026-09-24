const out = (k, v) => console.log(k, '::', typeof v === 'string' ? v : JSON.stringify(v));

// 内部 binding 表面
let internalBinding;
try { internalBinding = require('internal/test/binding').internalBinding; out('HAVE-internalBinding', typeof internalBinding); }
catch (e) { out('internalBinding-err', e.message); }

if (internalBinding) {
  for (const id of ['http2', 'nghttp2', 'sqlite', 'wasi', 'uvwasi', 'uv', 'fs', 'crypto', 'cares_wrap', 'tcp_wrap', 'tls_wrap', 'os', 'buffer']) {
    try { const b = internalBinding(id); out('IB-OK   ' + id, Object.keys(b).slice(0, 10).join(',')); }
    catch (e) { out('IB-FAIL ' + id, (e && e.message).slice(0, 70)); }
  }
}

// sqlite 细节
try {
  const { DatabaseSync, StatementSync } = require('node:sqlite');
  out('SQLITE-DatabaseSync-proto', Object.getOwnPropertyNames(DatabaseSync.prototype).join(','));
  if (StatementSync) out('SQLITE-StatementSync-proto', Object.getOwnPropertyNames(StatementSync.prototype).join(','));
} catch (e) { out('SQLITE-detail-err', (e && e.code) || e.message); }

// http2 细节
try {
  const h2 = require('http2');
  out('H2-getDefaultSettings-full', JSON.stringify(h2.getDefaultSettings()));
  out('H2-constants-keys', Object.keys(h2.constants).length);
} catch (e) { out('H2-detail-err', e.message); }

// sea 细节
try {
  const sea = require('node:sea');
  out('SEA-isSea-type', typeof sea.isSea() + ' value=' + String(sea.isSea()));
} catch (e) { out('SEA-detail-err', e.message); }
