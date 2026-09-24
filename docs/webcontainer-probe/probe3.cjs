const out = (k, v) => console.log(k, '::', typeof v === 'string' ? v : JSON.stringify(v));
const fs = require('fs');

// 虚拟 DNS / hosts 机制
for (const p of ['/etc/hosts', '/etc/resolv.conf', '/etc/nsswitch.conf', '/etc/networks']) {
  try { out('FILE ' + p, JSON.stringify(fs.readFileSync(p, 'utf8').slice(0, 400))); }
  catch (e) { out('FILE-ERR ' + p, e.code); }
}
try { out('dns.getServers', JSON.stringify(require('dns').getServers())); } catch (e) { out('dns.err', e.message); }
try { out('netifs', JSON.stringify(require('os').networkInterfaces())); } catch (e) { out('netifs.err', e.message); }
out('HOSTNAME', require('os').hostname());

// 代理环境变量？
const env = process.env;
const keys = Object.keys(env).filter((k) => /proxy|npm_config_registry|REGISTRY/i.test(k));
out('proxy-env-keys', JSON.stringify(keys));
out('registry-env', env.npm_config_registry || env.NPM_CONFIG_REGISTRY || 'n/a');

// 直连哨兵 IP 发裸 HTTP 请求，看返回与对端
const net = require('net');
const s = net.connect(80, '1.0.0.2');
s.on('connect', () => {
  out('RAW-connect-peer', s.remoteAddress + ':' + s.remotePort);
  s.write('GET / HTTP/1.0\r\nHost: example.com\r\n\r\n');
});
let buf = '';
s.on('data', (d) => { buf += d.toString('utf8', 0, 200); if (buf.length > 300) s.destroy(); });
s.on('close', () => out('RAW-resp-head', JSON.stringify(buf.slice(0, 200))));
s.on('error', (e) => out('RAW-err', (e && e.code) || (e && e.message)));

setTimeout(() => { out('DONE', ''); process.exit(0); }, 8000);
