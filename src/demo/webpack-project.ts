/**
 * The webpack project: webpack watches and bundles it in the tab, and the
 * demo dev server serves the bundle with a full-reload channel.
 *
 * NOTE for maintainers: the embedded sources are TS template literals,
 * so every backtick / ${ / backslash is escaped on the way in. Keep the
 * demo code free of all three (use separate console.log('') calls instead of
 * a newline escape).
 */
export const WEBPACK_PROJECT_FILES: Record<string, string> = {
  '/project/webpack/build.mjs': `// webpack build - a one-shot production build of /project/webpack into dist/.
import fs from 'fs';
import path from 'path';
import config from './webpack.config.mjs';

const ROOT = '/project/webpack';
const NM = path.join(ROOT, 'node_modules');

(async function () {
  console.log('-- webpack build --');
  if (!fs.existsSync(path.join(NM, 'webpack'))) {
    console.log('webpack     : not installed yet - run "Install deps" first');
    return;
  }

  // webpack calls back from its own async work; keep the run alive with a refed
  // timer until it does, or the runtime would report the build finished early.
  const keepAlive = setInterval(function () {}, 1000);
  try {
    const mod = await import('webpack');
    const webpack = mod.default || mod;
    console.log('tool        : webpack v' + webpack.version + ' (running in the tab)');

    const t0 = Date.now();
    const stats = await new Promise(function (resolve, reject) {
      webpack({ ...config, mode: 'production' }, function (err, result) {
        if (err) reject(err);
        else resolve(result);
      });
    });

    if (stats.hasErrors()) {
      console.log('webpack     : build failed');
      console.log(stats.toString({ all: false, errors: true }));
      process.exitCode = 1;
      return;
    }
    let size = 0;
    try { size = fs.statSync(path.join(ROOT, 'dist', 'bundle.js')).size; } catch (e) {}
    console.log('built in    : ' + (Date.now() - t0) + 'ms');
    console.log('written     : /project/webpack/dist/bundle.js (' + size + ' bytes)');
  } finally {
    clearInterval(keepAlive);
  }
})().catch(function (err) {
  console.log('webpack build failed : ' + (err && err.message ? err.message : err));
});
`,
  '/project/webpack/dev.mjs': `// webpack dev server: webpack watches /project/webpack/src and this serves the
// bundle over the virtual TCP layer. A real webpack-dev-server needs express,
// ws and chokidar, none of which a tab has; the full-reload signal instead
// rides the same BroadcastChannel bridge Vite HMR uses (public/sw.js swaps the
// preview's loopback WebSocket for it).
import fs from 'fs';
import path from 'path';
import http from 'http';
import config from './webpack.config.mjs';

const ROOT = '/project/webpack';
const NM = path.join(ROOT, 'node_modules');
const DIST = path.join(ROOT, 'dist');
const PORT = 5174;

function createReloadBridge() {
  const channel = new BroadcastChannel('web-node-hmr:' + PORT);
  const clients = new Set();
  channel.onmessage = function (event) {
    const msg = event.data;
    if (!msg) return;
    if (msg.t === 'open') {
      clients.add(msg.id);
      channel.postMessage({ t: 'open', id: msg.id });
      console.log('client      : preview connected (' + clients.size + ' client/s)');
    } else if (msg.t === 'close') {
      clients.delete(msg.id);
    }
  };
  return {
    get size() { return clients.size; },
    send(payload) {
      const data = JSON.stringify(payload);
      clients.forEach(function (id) { channel.postMessage({ t: 'message', id: id, data: data }); });
    },
    close() { clients.clear(); channel.close(); },
  };
}

// The preview document has no dev client of its own, so inject one: it opens a
// loopback WebSocket (which public/sw.js routes onto the channel above) and
// reloads when told the bundle changed.
function injectReloadClient(html) {
  const client =
    '<script>(function(){try{var live=false;' +
    'var ws=new WebSocket("ws://127.0.0.1:' + PORT + '/__webnode_live__");' +
    'ws.onopen=function(){live=true;};' +
    'ws.onmessage=function(e){try{var m=JSON.parse(e.data);if(m&&m.type==="full-reload")location.reload();}catch(x){}};' +
    'ws.onclose=function(){if(live)setTimeout(function(){location.reload();},400);};' +
    '}catch(e){}})();' + '<' + '/script>';
  return html.includes('</body>') ? html.replace('</body>', client + '</body>') : html + client;
}

function serve(port) {
  return http.createServer(function (req, res) {
    const url = new URL(req.url, 'http://127.0.0.1:' + port);
    if (url.pathname === '/' || url.pathname === '/index.html') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(injectReloadClient(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));
      return;
    }
    if (url.pathname === '/bundle.js') {
      const file = path.join(DIST, 'bundle.js');
      if (!fs.existsSync(file)) {
        res.writeHead(503, { 'content-type': 'text/plain' });
        res.end('building...');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/javascript; charset=utf-8' });
      res.end(fs.readFileSync(file));
      return;
    }
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('not found');
  });
}

(async function () {
  console.log('-- webpack dev --');
  if (!fs.existsSync(path.join(NM, 'webpack'))) {
    console.log('webpack     : not installed yet - run "Install deps" first');
    return;
  }
  const mod = await import('webpack');
  const webpack = mod.default || mod;
  console.log('tool        : webpack v' + webpack.version + ' (watching in the tab)');

  const compiler = webpack({
    ...config,
    mode: 'development',
    // dist/ is this build's own output; without this the write of bundle.js is
    // itself a change event, and webpack rebuilds forever.
    watchOptions: { ignored: /[\\\\/]dist[\\\\/]/ },
  });
  const bridge = createReloadBridge();
  const server = serve(PORT);

  let builds = 0;
  const watching = compiler.watch({ aggregateTimeout: 200 }, function (err, stats) {
    if (err) { console.log('webpack     : ' + err.message); return; }
    if (stats.hasErrors()) {
      console.log('webpack     : build failed');
      console.log(stats.toString({ all: false, errors: true }));
      return;
    }
    builds++;
    let size = 0;
    try { size = fs.statSync(path.join(DIST, 'bundle.js')).size; } catch (e) {}
    console.log('webpack     : ' + (builds === 1 ? 'built' : 'rebuilt') + ' bundle.js (' + size + ' bytes)');
    if (builds > 1) {
      console.log('reload      : full-reload -> ' + bridge.size + ' client/s');
      bridge.send({ type: 'full-reload', path: '*' });
    }
  });

  server.listen(PORT, function () {
    console.log('listening   : http://127.0.0.1:' + PORT);
    console.log('watching    : /project/webpack/src (VFS events -> rebuild -> reload)');
    console.log('preview     : open the Preview tab (:5174), then edit src/message.js');
  });
  server.on('close', function () {
    watching.close(function () {});
    bridge.close();
  });
})().catch(function (err) {
  console.log('webpack dev failed : ' + (err && err.message ? err.message : err));
});
`,
  '/project/webpack/index.html': `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>webpack + React app · web-node</title>
    <style>
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; font: 16px/1.6 ui-monospace, Menlo, monospace; background: #0b0e14; color: #d7dee9; }
      .card { text-align: center; }
      h1 { margin: 0 0 12px; font-size: 24px; color: #7cc4ff; }
      button { font: inherit; padding: 8px 16px; border: 1px solid #7cc4ff; border-radius: 8px; background: #132539; color: #7cc4ff; cursor: pointer; }
      .hint { margin-top: 16px; color: #7b8798; font-size: 13px; }
    </style>
  </head>
  <body>
    <!-- React mounts here; webpack bundles src/ in the tab. Edit src/ and save:
         the dev server rebuilds the bundle and reloads this page. -->
    <div id="root"></div>
    <script src="bundle.js"></script>
  </body>
</html>
`,
  '/project/webpack/package.json': `{
  "name": "webpack-app",
  "private": true,
  "version": "1.0.0",
  "type": "commonjs",
  "scripts": {
    "dev": "node dev.mjs",
    "build": "node build.mjs"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "sucrase": "^3.35.0",
    "webpack": "^5.111.1"
  }
}
`,
  '/project/webpack/src/index.js': `import React from 'react';
import { createRoot } from 'react-dom/client';
import { greet } from './message.js';

// Written as JSX and compiled by the in-tree loader (jsx-loader.cjs, which runs
// sucrase in the tab). JSX is only syntax: it becomes the same
// React.createElement calls, but it reads like the markup it produces.
function App() {
  const [count, setCount] = React.useState(0);
  return (
    <main className="card">
      <h1>{greet('webpack')}</h1>
      <button type="button" onClick={() => setCount(count + 1)}>
        count is {count}
      </button>
      <p className="hint">Bundled by webpack in the browser. Edit src/message.js and save.</p>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<App />);
`,
  '/project/webpack/src/message.js': `export function greet(who) {
  return 'Hello from ' + who + ', bundled in the browser';
}
`,
  '/project/webpack/jsx-loader.cjs': `// A tiny webpack loader: JSX in, React.createElement out, via sucrase (pure
// JavaScript, so it runs in the tab - there is no native toolchain here). The
// demo bundles with webpack and lets this loader do the one job webpack will
// not: turn JSX syntax into ordinary function calls.
const { transform } = require('sucrase');

module.exports = function jsxLoader(source) {
  const result = transform(source, {
    transforms: ['jsx'],
    jsxRuntime: 'classic',
    production: true,
    filePath: this.resourcePath,
  });
  return result.code;
};
`,
  '/project/webpack/webpack.config.mjs': `// The project lives at a fixed path in the demo, so the root is a constant
// rather than __dirname (this file is ESM).
const ROOT = '/project/webpack';

export default {
  mode: 'production',
  context: ROOT,
  entry: './src/index.js',
  output: { path: ROOT + '/dist', filename: 'bundle.js' },
  // .js/.jsx in src/ carry JSX, so they go through the in-tree loader first
  // (sucrase rewrites JSX to React.createElement). node_modules is skipped: its
  // .js is plain. The project's package.json is type: commonjs, so webpack would
  // otherwise parse every .js as CommonJS and reject the demo's import/export;
  // force the flexible type (accepts both), which is what Node itself does.
  module: {
    rules: [
      { test: /[.]jsx?$/, exclude: /node_modules/, use: ROOT + '/jsx-loader.cjs', type: 'javascript/auto' },
      { test: /[.]m?js$/, type: 'javascript/auto' },
    ],
  },
  resolve: { extensions: ['.js', '.jsx'] },
  // No eval: the bundle runs in the preview page, so emit plain source.
  devtool: false,
  infrastructureLogging: { level: 'error' },
};
`,
};
