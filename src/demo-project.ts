/**
 * The demo project mounted into the VFS on first boot.
 * Everything here runs inside the browser worker — no server involved.
 *
 * NOTE for maintainers: the embedded sources are TS template literals, so any
 * backtick / `${` / backslash in them would need escaping. Keep the demo code
 * free of all three (use separate `console.log('')` calls instead of `\n`).
 */
export const DEMO_FILES: Record<string, string> = {
  '/project/package.json': JSON.stringify(
    {
      name: 'web-node-demo',
      version: '1.0.0',
      type: 'commonjs',
      main: 'index.js',
      scripts: { start: 'node index.js' },
    },
    null,
    2,
  ),

  '/project/index.js': `// Runs on Node.js compiled-in-browser. No server. No install.
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');
const { EventEmitter } = require('events');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

console.log('=== web-node demo ===');
console.log('project     :', pkg.name, pkg.version);
console.log('platform    :', process.platform, '/', process.arch);
console.log('node        :', process.version);
console.log('cwd         :', process.cwd());
console.log('');

// --- real vendored Node path.js ---
console.log('-- path (vendored from Node source) --');
console.log('join        :', path.join('/a', 'b', '..', 'c'));
console.log('normalize   :', path.normalize('/a/./b/../c//'));
console.log('extname     :', path.extname('archive.tar.gz'));
console.log('');

// --- Buffer ---
console.log('-- buffer --');
const buf = Buffer.from('hello web-node');
console.log('hex         :', buf.toString('hex'));
console.log('base64      :', buf.toString('base64'));
console.log('slice       :', buf.slice(0, 5).toString());
console.log('');

// --- fs over the virtual file system ---
console.log('-- fs (virtual, persisted to OPFS) --');
const dir = '/project/output';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'report.txt'), 'generated at ' + new Date().toISOString());
console.log('written     :', fs.readFileSync(path.join(dir, 'report.txt'), 'utf8'));
console.log('readdir     :', fs.readdirSync('/project').sort().join(', '));
console.log('stat.size   :', fs.statSync(path.join(dir, 'report.txt')).size, 'bytes');
console.log('');

// --- local module + ESM ---
const { fib } = require('./lib/fib.js');
console.log('-- local require --');
console.log('fib(10)     :', fib(10));
console.log('');

// --- events + timers (async) ---
const emitter = new EventEmitter();
emitter.on('tick', (n) => console.log('event       : tick #' + n));
let n = 0;
const timer = setInterval(() => {
  emitter.emit('tick', ++n);
  if (n === 3) {
    clearInterval(timer);
    console.log('done. platform:', os.platform(), '| uptime:', process.uptime().toFixed(3) + 's');
  }
}, 120);

console.log('scheduled 3 async ticks...');
console.log('');

// --- http server (milestone 3: virtual TCP) ---
// listen(3000) binds a port inside this runtime. The ServiceWorker bridge at
// /preview/3000/ dials it, so this URL is reachable from the browser tab.
function page() {
  const rows = require('./lib/facts.js')()
    .map(function (row) {
      return '<tr><td>' + row[0] + '</td><td>' + row[1] + '</td></tr>';
    })
    .join('');
  return [
    '<!doctype html><html><head><meta charset="utf-8"><title>web-node preview</title>',
    '<style>',
    'body{margin:0;font:14px/1.6 ui-monospace,Menlo,monospace;background:#0b0e14;color:#d7dee9;padding:32px}',
    'h1{font-size:18px;color:#5ef1a5;margin:0 0 4px}',
    '.sub{color:#7b8798;margin-bottom:20px}',
    'table{border-collapse:collapse;width:100%;max-width:560px}',
    'td{padding:7px 10px;border-bottom:1px solid #232a3a}',
    'td:first-child{color:#7b8798;width:40%}',
    'a{color:#5ef1a5}',
    '</style></head><body>',
    '<h1>Hello from your in-browser Node.js server</h1>',
    '<div class="sub">This HTML was rendered inside the runtime worker and piped through a virtual TCP socket.</div>',
    '<table>' + rows + '</table>',
    '<p style="margin-top:24px"><a href="/api/info">GET /api/info</a> &middot; <a href="/api/fib?n=20">GET /api/fib?n=20</a></p>',
    '</body></html>',
  ].join('');
}

const server = http.createServer(function (req, res) {
  const url = new URL(req.url, 'http://localhost:3000');

  if (url.pathname === '/api/info') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      time: new Date().toISOString(),
    }, null, 2));
    return;
  }

  if (url.pathname === '/api/fib') {
    const value = Number(url.searchParams.get('n') || 10);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ n: value, fib: fib(value) }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(page());
});

server.listen(3000, function () {
  console.log('http server  : listening on http://localhost:3000');
  console.log('preview      : open the Preview tab (or /preview/3000/)');
});
`,

  '/project/lib/fib.js': `// A plain CommonJS module resolved out of the virtual file system.
function fib(n) {
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i++) [a, b] = [b, a + b];
  return a;
}

exports.fib = fib;
exports.default = { fib };
`,

  '/project/lib/facts.js': `// Feeds the HTML that the virtual HTTP server renders.
module.exports = function facts() {
  return [
    ['process.version', process.version],
    ['process.platform', process.platform],
    ['process.arch', process.arch],
    ['process.cwd()', process.cwd()],
    ['module resolution', 'CJS from the virtual file system'],
    ['transport', 'virtual TCP (no real socket)'],
  ];
};
`,

  '/project/notes.md': `# web-node demo project

This project is mounted into an in-browser VFS. Edit any file and hit **Run**.

## What works today (milestone 3)

- Real Node.js core source (lib/path.js, lib/querystring.js, primordials) vendored and executed
- internalBinding() backed by TypeScript implementations over a virtual file system
- path / fs / buffer / events / util / console / timers / process / os / string_decoder / assert / querystring
- **net + http over a virtual TCP layer** — http.createServer().listen(3000) is reachable at /preview/3000/
- **ServiceWorker bridge** — a browser URL is routed into the runtime's port table
- CommonJS + a subset of ESM (static import/export)
- In-memory VFS persisted to OPFS (reload the page and your files are still here)

## Not yet

- Subdomain preview routing (3000.localhost) — currently a /preview/<port>/ path prefix
- Chunked transfer-encoding, keep-alive, TLS (https)
- npm client (milestone 4)
- Real build tools (milestone 5)
`,
};
