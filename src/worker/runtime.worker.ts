/// <reference lib="webworker" />
import { NodeRuntime, ProcessExit } from '../node-runtime/runtime';
import { MemoryVfs, OpfsPersistence } from '../node-runtime/vfs';
import { VENDORED } from '../node-runtime/vendored';
import { DEMO_FILES } from '../demo-project';

const decoder = new TextDecoder();

/**
 * Runtime worker.
 *
 * Everything Node-flavoured happens here: the realm, the bindings, the VFS and
 * the user's code. The main thread only talks to it over a MessagePort.
 *
 * Why a worker (not the main thread):
 *  - user code can be CPU-heavy; the UI must stay responsive
 *  - OPFS sync access handles are worker-only
 *  - it is the natural home for future SharedArrayBuffer/Atomics syscalls
 */

type Request =
  | { id: number; type: 'init' }
  | { id: number; type: 'mount'; files: Record<string, string> }
  | { id: number; type: 'run'; entry?: string }
  | { id: number; type: 'writeFile'; path: string; contents: string }
  | { id: number; type: 'readFile'; path: string }
  | { id: number; type: 'reset' }
  | { id: number; type: 'describe' }
  | { id: number; type: 'npmInstall'; cwd?: string; includeDev?: boolean }
  | {
      id: number;
      type: 'http';
      port: number;
      method: string;
      path: string;
      headers: Record<string, string>;
      body: ArrayBuffer | null;
    }
  | {
      id: number;
      type: 'httpStream';
      port: number;
      method: string;
      path: string;
      headers: Record<string, string>;
      body: ArrayBuffer | null;
    };

export interface RuntimeInfo {
  persistSupported: boolean;
  restored: boolean;
  files: string[];
  bindings: string[];
  vendoredFiles: string[];
}

type Response =
  | { id: number; type: 'ok'; result?: unknown }
  | { id: number; type: 'error'; message: string }
  | { id: number; type: 'stdout'; data: string }
  | { id: number; type: 'stderr'; data: string }
  | { id: number; type: 'exit'; code: number }
  | { id: number; type: 'httpHead'; status: number; statusMessage: string; headers: Record<string, string | string[]> }
  | { id: number; type: 'httpChunk'; data: Uint8Array }
  | { id: number; type: 'httpEnd' }
  | { id: number; type: 'ready'; info: RuntimeInfo };

const persistence = new OpfsPersistence('web-node-project');
let runtime: NodeRuntime | null = null;
let vfs: MemoryVfs | null = null;

function post(msg: Response): void {
  self.postMessage(msg);
}

function ensureDir(v: MemoryVfs, filePath: string): void {
  const idx = filePath.lastIndexOf('/');
  if (idx > 0) v.mkdir(filePath.slice(0, idx), { recursive: true });
}

function listTree(v: MemoryVfs): string[] {
  return v
    .snapshot()
    .filter((s) => s.type === 'file')
    .map((s) => s.path)
    .sort();
}

function writeAll(v: MemoryVfs, files: Record<string, string>): void {
  for (const [path, contents] of Object.entries(files)) {
    ensureDir(v, path);
    v.writeFile(path, new TextEncoder().encode(contents));
  }
}

interface VirtualHttpResult {
  status: number;
  statusMessage: string;
  headers: Record<string, string | string[]>;
  body: Uint8Array;
}

/**
 * Inbound request from the outside world (the ServiceWorker bridge).
 *
 * This is the *only* way a browser URL reaches a user's `http.createServer`:
 * SW → page → here → virtual network → the server the user bound.
 */
interface HttpStreamModule {
  _stream: (
    port: number,
    init: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Uint8Array },
    handlers: {
      onHead: (h: { status: number; statusMessage: string; headers: Record<string, string | string[]> }) => void;
      onData: (c: Uint8Array) => void;
      onEnd: () => void;
      onError: (e: Error) => void;
    },
  ) => void;
}

async function serveVirtualRequest(
  rt: NodeRuntime,
  req: { port: number; method: string; path: string; headers: Record<string, string>; body: ArrayBuffer | null },
): Promise<VirtualHttpResult & { body: Uint8Array }> {
  const http = rt.realm.require('http') as unknown as {
    _request: (
      port: number,
      init: { method?: string; path?: string; headers?: Record<string, string>; body?: string | Uint8Array },
    ) => Promise<VirtualHttpResult>;
  };
  return http._request(req.port, {
    method: req.method,
    path: req.path,
    headers: req.headers,
    body: req.body ? new Uint8Array(req.body) : undefined,
  });
}

async function init(id: number): Promise<void> {
  const loaded = await persistence.load();
  const hasRestored = Boolean(loaded && loaded.entries.length > 0);

  const v = hasRestored
    ? MemoryVfs.fromSnapshot(
        loaded!.entries,
        { cwd: '/project' },
        loaded!.version >= 2 ? 'base64' : 'text',
      )
    : new MemoryVfs({ cwd: '/project' });

  if (!hasRestored) writeAll(v, DEMO_FILES);

  vfs = v;
  runtime = new NodeRuntime({
    vfs: v,
    argv: ['/project/index.js'],
    env: { NODE_ENV: 'development', WEB_NODE: '1' },
    installGlobals: true,
    onStdout: (data) => post({ id: 0, type: 'stdout', data }),
    onStderr: (data) => post({ id: 0, type: 'stderr', data }),
  });

  persistence.schedule(v);

  post({
    id,
    type: 'ready',
    info: {
      persistSupported: OpfsPersistence.supported,
      restored: hasRestored,
      files: listTree(v),
      bindings: runtime.realm.bindingIds,
      vendoredFiles: Object.keys(VENDORED).sort(),
    },
  });
}

function run(id: number, entry?: string): void {
  if (!runtime || !vfs) throw new Error('runtime not initialised');
  const target = entry ?? '/project/index.js';
  try {
    runtime.runMain(target);
  } catch (err) {
    if (err instanceof ProcessExit) {
      persistence.schedule(vfs);
      post({ id, type: 'exit', code: err.code });
      return;
    }
    post({ id: 0, type: 'stderr', data: `\n${(err as Error).stack ?? String(err)}\n` });
    post({ id, type: 'error', message: (err as Error).message });
    return;
  }
  persistence.schedule(vfs);
  post({ id, type: 'exit', code: runtime.exitCode ?? 0 });
}

self.onmessage = async (event: MessageEvent<Request>): Promise<void> => {
  const req = event.data;
  try {
    switch (req.type) {
      case 'init':
        await init(req.id);
        return;
      case 'mount':
        if (!vfs) throw new Error('runtime not initialised');
        writeAll(vfs, req.files);
        persistence.schedule(vfs);
        post({ id: req.id, type: 'ok', result: listTree(vfs) });
        return;
      case 'run':
        run(req.id, req.entry);
        return;
      case 'writeFile':
        if (!vfs) throw new Error('runtime not initialised');
        ensureDir(vfs, req.path);
        vfs.writeFile(req.path, new TextEncoder().encode(req.contents));
        persistence.schedule(vfs);
        post({ id: req.id, type: 'ok', result: listTree(vfs) });
        return;
      case 'readFile':
        if (!vfs) throw new Error('runtime not initialised');
        post({ id: req.id, type: 'ok', result: new TextDecoder().decode(vfs.readFile(req.path)) });
        return;
      case 'reset':
        await persistence.clear();
        if (vfs) {
          writeAll(vfs, DEMO_FILES);
          persistence.schedule(vfs);
        }
        post({ id: req.id, type: 'ok', result: vfs ? listTree(vfs) : [] });
        return;
      case 'describe':
        if (!runtime) throw new Error('runtime not initialised');
        post({ id: req.id, type: 'ok', result: runtime.describe() });
        return;
      case 'npmInstall': {
        if (!runtime) throw new Error('runtime not initialised');
        const result = await runtime.installDependencies({
          cwd: req.cwd,
          includeDev: req.includeDev,
          onLog: (message) => post({ id: 0, type: 'stdout', data: message + '\n' }),
          // Lifecycle scripts run inside the install, and their output belongs in
          // the same terminal the install writes to.
          onOutput: (chunk, stream) =>
            post({ id: 0, type: stream === 'stdout' ? 'stdout' : 'stderr', data: decoder.decode(chunk) }),
        });
        if (vfs) persistence.schedule(vfs);
        post({ id: req.id, type: 'ok', result });
        return;
      }
      case 'http': {
        if (!runtime) throw new Error('runtime not initialised');
        const result = await serveVirtualRequest(runtime, req);
        post({ id: req.id, type: 'ok', result });
        return;
      }
      case 'httpStream': {
        if (!runtime) throw new Error('runtime not initialised');
        const http = runtime.realm.require('http') as unknown as HttpStreamModule;
        http._stream(
          req.port,
          {
            method: req.method,
            path: req.path,
            headers: req.headers,
            body: req.body ? new Uint8Array(req.body) : undefined,
          },
          {
            onHead: (h) =>
              post({
                id: req.id,
                type: 'httpHead',
                status: h.status,
                statusMessage: h.statusMessage,
                headers: h.headers,
              }),
            onData: (chunk) => post({ id: req.id, type: 'httpChunk', data: chunk }),
            onEnd: () => post({ id: req.id, type: 'httpEnd' }),
            onError: (err) => post({ id: req.id, type: 'error', message: err.message }),
          },
        );
        return;
      }
    }
  } catch (err) {
    const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    const stack = err instanceof Error && err.stack ? `\n${err.stack}` : '';
    post({ id: 0, type: 'stderr', data: `[worker:${req.type}] ${message}${stack}\n` });
    post({ id: req.id, type: 'error', message });
  }
};
