import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.cjs': 'text/javascript; charset=utf-8' };

createServer(async (req, res) => {
  const path = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  try {
    const body = await readFile(new URL('.' + path, import.meta.url));
    res.writeHead(200, {
      'content-type': TYPES[extname(path)] || 'application/octet-stream',
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'credentialless',
      'cross-origin-resource-policy': 'cross-origin',
    });
    res.end(body);
  } catch {
    res.writeHead(404); res.end('nf');
  }
}).listen(8788, () => console.log('wc-probe on http://localhost:8788'));
