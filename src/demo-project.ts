/**
 * The demo project mounted into the VFS on first boot.
 * Everything here runs inside the browser worker — no server involved.
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
const { EventEmitter } = require('events');

const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8'));

console.log('=== web-node demo ===');
console.log('project     :', pkg.name, pkg.version);
console.log('platform    :', process.platform, '/', process.arch);
console.log('node        :', process.version);
console.log('cwd         :', process.cwd());

// --- real vendored Node path.js ---
console.log('\\n-- path (vendored from Node source) --');
console.log('join        :', path.join('/a', 'b', '..', 'c'));
console.log('normalize   :', path.normalize('/a/./b/../c//'));
console.log('extname     :', path.extname('archive.tar.gz'));

// --- Buffer ---
console.log('\\n-- buffer --');
const buf = Buffer.from('hello web-node');
console.log('hex         :', buf.toString('hex'));
console.log('base64      :', buf.toString('base64'));
console.log('slice       :', buf.slice(0, 5).toString());

// --- fs over the virtual file system ---
console.log('\\n-- fs (virtual, persisted to OPFS) --');
const dir = '/project/output';
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'report.txt'), 'generated at ' + new Date().toISOString());
console.log('written     :', fs.readFileSync(path.join(dir, 'report.txt'), 'utf8'));
console.log('readdir     :', fs.readdirSync('/project').sort().join(', '));
console.log('stat.size   :', fs.statSync(path.join(dir, 'report.txt')).size, 'bytes');

// --- local module + ESM ---
const { fib } = require('./lib/fib.js');
console.log('\\n-- local require --');
console.log('fib(10)     :', fib(10));

// --- events + timers (async) ---
const emitter = new EventEmitter();
emitter.on('tick', (n) => console.log('event       : tick #' + n));
let n = 0;
const timer = setInterval(() => {
  emitter.emit('tick', ++n);
  if (n === 3) {
    clearInterval(timer);
    console.log('\\ndone. platform:', os.platform(), '| uptime:', process.uptime().toFixed(3) + 's');
  }
}, 120);

console.log('\\nscheduled 3 async ticks...');
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

  '/project/notes.md': `# web-node demo project

This project is mounted into an in-browser VFS. Edit any file and hit **Run**.

## What works today (MVP)

- Real Node.js core source (\`lib/path.js\`, \`lib/querystring.js\`, primordials) vendored and executed
- \`internalBinding()\` backed by TypeScript implementations over a virtual file system
- \`path\` / \`fs\` / \`buffer\` / \`events\` / \`util\` / \`console\` / \`timers\` / \`process\` / \`os\` / \`string_decoder\` / \`assert\` / \`querystring\`
- CommonJS + a subset of ESM (static import/export)
- In-memory VFS persisted to OPFS (reload the page and your files are still here)

## Not yet

- Networking / ServiceWorker virtual TCP (milestone 3)
- npm client (milestone 4)
- Real build tools (milestone 5)
`,
};
