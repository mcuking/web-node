const out = (k, v) => console.log(k, '::', typeof v === 'string' ? v : JSON.stringify(v));

// A) CORS 假设：headless fetch 出站是否受浏览器 CORS 限制
(async () => {
  const urls = [
    'https://api.github.com/',
    'https://httpbin.org/get',
    'https://registry.npmjs.org/ms',
    'https://example.com/',
    'https://cdn.jsdelivr.net/npm/ms@2.1.3/package.json',
  ];
  for (const u of urls) {
    try {
      const r = await fetch(u);
      out('FETCH ' + u, r.status + ' acao=' + r.headers.get('access-control-allow-origin'));
    } catch (e) { out('FETCH-ERR ' + u, (e && e.message) || String(e)); }
  }
})();

// B) DNS：一批域名分别解析成什么
const dns = require('dns');
for (const h of ['example.com', 'registry.npmjs.org', 'api.github.com', 'httpbin.org', 'google.com']) {
  dns.lookup(h, (e, a) => out('DNS ' + h, e ? 'ERR ' + e.code : a));

}

// C) TLS 证书是不是真的（https 模块）
const https = require('https');
const req = https.get('https://registry.npmjs.org/ms', (res) => {
  out('HTTPS-status', res.statusCode);
  try {
    const c = res.socket.getPeerCertificate();
    out('CERT subject', JSON.stringify(c.subject));
    out('CERT issuer', JSON.stringify(c.issuer));
    out('CERT valid_to', c.valid_to);
    out('TLS auth', res.socket.authorized + ' proto=' + res.socket.getProtocol());
  } catch (e) { out('CERT-err', e.message); }
  res.resume();
});
req.on('error', (e) => out('HTTPS-err', (e && e.code) || (e && e.message)));

// D) raw tls.connect 到哨兵 IP，看能否握手 + 证书
const tls = require('tls');
setTimeout(() => {
  const t = tls.connect({ host: '1.0.0.2', servername: 'example.com', port: 443 }, () => {
    out('TLS-authorized', t.authorized);
    try { const c = t.getPeerCertificate(); out('TLS subject', JSON.stringify(c.subject)); out('TLS issuerCN', c.issuer && c.issuer.CN); } catch (e) { out('TLS-cert-err', e.message); }
    t.end();
  });
  t.on('error', (e) => out('TLS-err', (e && e.code) || (e && e.message)));
}, 1500);

setTimeout(() => { out('DONE', ''); process.exit(0); }, 11000);
