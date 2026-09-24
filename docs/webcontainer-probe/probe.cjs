// WebContainer 能力探针 —— 在容器内 node 里跑
const out = (k, v) => console.log(k, '::', typeof v === 'string' ? v : JSON.stringify(v));
const J = (x) => { try { return JSON.stringify(x); } catch { return String(x); } };

out('WEB-EYE', 'wc=' + (process.versions.webcontainer || 'n/a'));
out('ARCH', process.arch + '/' + process.platform + ' node=' + process.version);

// 1) 模块可用性
const mods = ['http2','node:sqlite','tls','https','net','dgram','dns','crypto','worker_threads',
  'node:test','inspector','v8','node:sea','node:wasi','node:quic','node:ffi','zlib',
  'perf_hooks','node:vm','node:async_hooks','node:cluster','node:repl','node:readline'];
for (const m of mods) {
  try { require(m); out('MOD-OK   ' + m, ''); }
  catch (e) { out('MOD-FAIL ' + m, (e && e.code) || (e && e.message)); }
}

// 2) 老式 binding 表面（probe 常见 id）
for (const b of ['fs','tcp_wrap','tls_wrap','udp_wrap','http_parser','pipe_wrap','uv','crypto',
  'cares_wrap','zlib','http2','sqlite','napi','wasi','ffi','sea','quic','os','buffer','util']) {
  try { const r = process.binding(b); out('BIND-OK   ' + b, Object.keys(r).slice(0, 6).join(',')); }
  catch (e) { out('BIND-FAIL ' + b, (e && e.code) || (e && e.message).slice(0, 60)); }
}

// 3) keepalive guard
const guard = setTimeout(() => { out('DONE', ''); process.exit(0); }, 12000);

// 4) 出站 fetch
(async () => {
  for (const u of ['https://registry.npmjs.org/ms', 'https://example.com/']) {
    try { const r = await fetch(u); out('FETCH ' + u, r.status); }
    catch (e) { out('FETCH-ERR ' + u, (e && e.message) || String(e)); }
  }
})();

// 5) net.connect 外网
try {
  const net = require('net');
  const s = net.connect(443, '93.184.216.34');
  s.on('connect', () => out('NET-connect-ext', 'ok'));
  s.on('error', (e) => out('NET-err-ext', (e && e.code) || (e && e.message)));
  setTimeout(() => s.destroy(), 5000);
} catch (e) { out('NET-throw', (e && e.message)); }

// 6) https GET 外网（TLS）
try {
  const https = require('https');
  const r = https.get('https://example.com/', (res) => { out('HTTPS-status', res.statusCode); res.resume(); });
  r.on('error', (e) => out('HTTPS-err', (e && e.code) || (e && e.message)));
} catch (e) { out('HTTPS-throw', (e && e.message)); }

// 7) DNS
try {
  const dns = require('dns');
  dns.lookup('example.com', (err, addr) => out('DNS-lookup', err ? 'ERR ' + ((err && err.code) || err.message) : addr));
} catch (e) { out('DNS-throw', (e && e.message)); }

// 8) 入站：起 http server + 自连
try {
  const http = require('http');
  const srv = http.createServer((req, res) => res.end('hello-from-wc'));
  srv.listen(0, () => {
    const port = srv.address().port;
    out('LISTEN-port', port);
    fetch('http://localhost:' + port + '/').then((r) => r.text())
      .then((t) => out('LOOPBODY', t)).catch((e) => out('LOOP-ERR', e.message))
      .finally(() => srv.close());
  });
} catch (e) { out('LISTEN-throw', (e && e.message)); }

// 9) dlopen .node（伪造 ELF 头）
try {
  const fs = require('fs');
  fs.writeFileSync('/tmp/x.node', Buffer.from([127,69,76,70,1,1,1,0,0,0,0,0,0,0,0,0]));
  require('/tmp/x.node');
} catch (e) { out('DLOPEN', (e && e.code) || (e && e.message)); }

// 10) worker_threads 真起一个
try {
  const { Worker, isMainThread } = require('worker_threads');
  if (isMainThread) {
    const w = new Worker("const {parentPort}=require('worker_threads');parentPort.postMessage('w-ok');", { eval: true });
    w.on('message', (m) => out('WORKER', m));
    w.on('error', (e) => out('WORKER-err', (e && e.message)));
  }
} catch (e) { out('WORKER-throw', (e && e.message)); }
