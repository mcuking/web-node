import { RuntimeClient } from '../client';
import type { RuntimeInfo } from '../worker/runtime.worker';
import { previewUrl as buildPreviewUrl, prefixPreviewUrl } from './preview-url';

/**
 * Cold-start timing (M107), in milliseconds since navigation start. Exposed
 * read-only on `globalThis.__wnBoot` so `tools/e2e-startup-bench.mjs` can read
 * the breakdown without patching the app.
 */
export interface BootTiming {
  moduleEvalMs: number;
  workerSpawnMs: number;
  runtimeReadyMs: number;
  firstRunMs: number;
}
const bootTiming: BootTiming = {
  moduleEvalMs: performance.now(),
  workerSpawnMs: 0,
  runtimeReadyMs: 0,
  firstRunMs: 0,
};
(globalThis as { __wnBoot?: BootTiming }).__wnBoot = bootTiming;

const client = new RuntimeClient();

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

const treeEl = $<HTMLUListElement>('file-tree');
const editorEl = $<HTMLTextAreaElement>('editor');
const terminalEl = $<HTMLPreElement>('terminal');
const activeFileEl = $<HTMLSpanElement>('active-file');
const dirtyEl = $<HTMLSpanElement>('dirty');
const statusEl = $<HTMLSpanElement>('status');
const bootEl = $<HTMLSpanElement>('boot');
const factsEl = $<HTMLSpanElement>('facts');
const runBtn = $<HTMLButtonElement>('run');
const buildBtn = $<HTMLButtonElement>('build');
const bundleBtn = $<HTMLButtonElement>('bundle');
const viteBtn = $<HTMLButtonElement>('vite');
const viteDevBtn = $<HTMLButtonElement>('vitedev');
const hmrEditBtn = $<HTMLButtonElement>('hmred');
const hmrCssBtn = $<HTMLButtonElement>('hmrcss');
const installBtn = $<HTMLButtonElement>('install');
const clearBtn = $<HTMLButtonElement>('clear');
const resetBtn = $<HTMLButtonElement>('reset');
const portSelect = $<HTMLSelectElement>('port-select');
const refreshBtn = $<HTMLButtonElement>('refresh');
const openTab = $<HTMLAnchorElement>('open-tab');
const previewFrame = $<HTMLIFrameElement>('preview-frame');
const previewEmpty = $<HTMLDivElement>('preview-empty');
const viewOutput = $<HTMLDivElement>('view-output');
const viewPreview = $<HTMLDivElement>('view-preview');

let files: string[] = [];
let activeFile = '';
let info: RuntimeInfo | null = null;
let dirty = false;

function writeTerminal(text: string, cls = ''): void {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  terminalEl.appendChild(span);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

function setStatus(text: string, cls = ''): void {
  statusEl.textContent = text;
  statusEl.className = `status ${cls}`;
}

function renderTree(): void {
  treeEl.innerHTML = '';
  for (const f of files) {
    if (f.includes('/node_modules/')) continue; // keep the tree readable
    const li = document.createElement('li');
    li.textContent = f.replace('/project/', '');
    li.dataset.path = f;
    if (f === activeFile) li.classList.add('active');
    li.addEventListener('click', () => void openFile(f));
    treeEl.appendChild(li);
  }
}

async function openFile(path: string): Promise<void> {
  if (dirty && activeFile) {
    await client.writeFile(activeFile, editorEl.value);
  }
  activeFile = path;
  const contents = await client.readFile(path);
  editorEl.value = contents;
  activeFileEl.textContent = path.replace('/project/', '');
  dirty = false;
  dirtyEl.textContent = '';
  renderTree();
}

editorEl.addEventListener('input', () => {
  if (!dirty) {
    dirty = true;
    dirtyEl.textContent = '● unsaved';
  }
});

async function save(): Promise<void> {
  if (activeFile && dirty) {
    await client.writeFile(activeFile, editorEl.value);
    dirty = false;
    dirtyEl.textContent = '';
  }
}

async function runProject(): Promise<void> {
  await runEntry('/project/index.js', 'node /project/index.js', runBtn);
}

/**
 * Run any VFS entry (`node <path>`) with the shared busy/status/terminal
 * handling. The Run/Build/Bundle/Vite buttons all go through here.
 */
async function runEntry(entry: string, label: string, button: HTMLButtonElement): Promise<void> {
  await save();
  button.disabled = true;
  runBtn.disabled = true;
  setStatus('running…', 'running');
  // Echo a header so consecutive runs are visually separated.
  writeTerminal(`\n$ ${label}\n`, 'sys');
  const started = performance.now();
  try {
    await client.run(entry);
    const ms = (performance.now() - started).toFixed(0);
    if (!bootTiming.firstRunMs) bootTiming.firstRunMs = Math.round(performance.now());
    setStatus(`done in ${ms}ms`, 'ok');
    writeTerminal(`[exit 0 · ${ms}ms]\n`, 'sys');
  } catch (err) {
    writeTerminal(`[run failed] ${(err as Error).message}\n`, 'err');
    setStatus('error', 'err');
  } finally {
    button.disabled = false;
    runBtn.disabled = false;
    await refreshPorts();
  }
}

async function buildProject(): Promise<void> {
  await runEntry('/project/build.js', 'node /project/build.js', buildBtn);
}

async function bundleProject(): Promise<void> {
  await runEntry('/project/bundle.js', 'node /project/bundle.js', bundleBtn);
}

async function viteBuildProject(): Promise<void> {
  await runEntry('/project/vite-build.mjs', 'node /project/vite-build.mjs', viteBtn);
}

async function viteDevProject(): Promise<void> {
  await runEntry('/project/vite-dev.mjs', 'node /project/vite-dev.mjs', viteDevBtn);
}

// A VFS write is what the dev server watches, so saving a source file makes the
// running preview hot-update. This button does exactly that write, on the file
// the demo app accepts, ready for when no dev server is open to react.
let hmrEdits = 0;
async function hmrEdit(): Promise<void> {
  const path = '/project/site/src/message.js';
  // Continue from the number already in the file so the edit is visibly
  // monotonic even after a page reload (the in-memory counter would reset).
  let n = hmrEdits + 1;
  try {
    const current = await client.readFile(path);
    const match = /hot-updated #(\d+)/.exec(current);
    if (match) n = Number(match[1]) + 1;
  } catch {
    // not written yet
  }
  hmrEdits = n;
  const source = [
    'export function greet(who) {',
    `  return 'Hello from ' + who + ', hot-updated #${n}';`,
    '}',
    '',
  ].join('\n');
  await client.writeFile(path, source);
  writeTerminal(`\n[hmr] wrote site/src/message.js (#${n}) — watch the Preview\n`, 'sys');
  if (activeFile === path) editorEl.value = source;
}

hmrEditBtn.addEventListener('click', () => void hmrEdit());

// CSS HMR takes the other Vite update path: editing the stylesheet produces a
// `css-update`, which Vite applies by swapping the injected `<style>` in place
// (no reload, and JS module state stays put).
const CSS_COLORS = ['#5ef1a5', '#7cc4ff', '#ffd166', '#ff7b72', '#c792ea'];
let hmrCssEdits = 0;
function styleCss(color: string): string {
  return [
    '/* Edited by the HMR CSS button: Vite sends a css-update and the preview',
    '   restyles in place - no reload, no lost page state. */',
    '#app {',
    `  color: ${color};`,
    '  font: 600 22px/1.4 ui-monospace, Menlo, monospace;',
    '}',
    '',
  ].join('\n');
}
async function hmrCssEdit(): Promise<void> {
  const path = '/project/site/src/style.css';
  // Advance past the colour already in the file, so the change is visible even
  // after a reload (the in-memory counter would reset).
  let next = CSS_COLORS[(hmrCssEdits + 1) % CSS_COLORS.length];
  try {
    const current = await client.readFile(path);
    const match = /#([0-9a-f]{6})/i.exec(current);
    const idx = match ? CSS_COLORS.indexOf(match[0].toLowerCase()) : -1;
    next = CSS_COLORS[(idx + 1) % CSS_COLORS.length];
  } catch {
    // stylesheet not written yet
  }
  hmrCssEdits += 1;
  const source = styleCss(next);
  await client.writeFile(path, source);
  writeTerminal(`\n[hmr] wrote site/src/style.css (${next}) — watch the Preview\n`, 'sys');
  if (activeFile === path) editorEl.value = source;
}

hmrCssBtn.addEventListener('click', () => void hmrCssEdit());

// --- preview ---------------------------------------------------------------

async function refreshPorts(): Promise<void> {
  const { ports } = await client.describe();
  knownPorts = ports.join(',');
  const previous = portSelect.value;
  portSelect.innerHTML = '';

  if (ports.length === 0) {
    previewEmpty.classList.remove('hidden');
    previewFrame.classList.add('hidden');
    portSelect.disabled = true;
    return;
  }

  previewEmpty.classList.add('hidden');
  previewFrame.classList.remove('hidden');
  portSelect.disabled = false;
  for (const port of ports) {
    const option = document.createElement('option');
    option.value = String(port);
    option.textContent = ':' + port;
    portSelect.appendChild(option);
  }
  portSelect.value = ports.includes(Number(previous)) ? previous : String(ports[0]);
  loadPreview();
}

/**
 * A server started with `listen()` keeps the entry alive, so `client.run` never
 * resolves and the port list would stay stale until a manual refresh. Poll
 * lightly instead, and reload the preview only when the set actually changes.
 */
let knownPorts = '';
function startPortWatch(): void {
  setInterval(() => {
    void client
      .describe()
      .then(({ ports }) => {
        if (ports.join(',') === knownPorts) return;
        void refreshPorts();
      })
      .catch(() => {});
  }, 1500);
}

function previewEnv() {
  return {
    dev: import.meta.env.DEV,
    base: import.meta.env.BASE_URL,
    origin: location.origin,
    hostname: location.hostname,
    port: location.port,
  };
}

function previewUrl(): string {
  return buildPreviewUrl(portSelect.value, previewEnv());
}

function loadPreview(): void {
  const url = previewUrl();
  // The pop-out link uses the prefix bridge, not the subdomain: a subdomain
  // preview relays through this page, so it cannot stand alone in a new tab.
  openTab.href = prefixPreviewUrl(portSelect.value, previewEnv());
  previewFrame.src = url;
  hmrRelay.follow(Number(portSelect.value) || null);
  writeTerminal(`[preview] ${url}\n`, 'sys');
}

function showTab(name: 'output' | 'preview'): void {
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
    tab.classList.toggle('active', tab.dataset.tab === name);
  }
  viewOutput.classList.toggle('hidden', name !== 'output');
  viewPreview.classList.toggle('hidden', name !== 'preview');
}

for (const tab of document.querySelectorAll<HTMLButtonElement>('.tab')) {
  tab.addEventListener('click', () => {
    const name = tab.dataset.tab === 'preview' ? 'preview' : 'output';
    showTab(name);
    if (name === 'preview' && portSelect.value) loadPreview();
  });
}

portSelect.addEventListener('change', () => loadPreview());
refreshBtn.addEventListener('click', () => loadPreview());

client.on('stdout', (data) => writeTerminal(data));
client.on('stderr', (data) => writeTerminal(data, 'err'));
client.on('exit', (code) => {
  if (code !== 0) writeTerminal(`[exit code ${code}]\n`, 'err');
});

client.on('ready', (runtimeInfo) => {
  info = runtimeInfo;
  bootTiming.runtimeReadyMs = Math.round(performance.now());
  bootEl.textContent = runtimeInfo.restored ? 'runtime ready (restored from OPFS)' : 'runtime ready (fresh project)';
  factsEl.textContent = [
    `${runtimeInfo.bindings.length} bindings`,
    `${runtimeInfo.wasmModules.length} wasm modules`,
    `${runtimeInfo.vendoredFiles.length} vendored node files`,
    runtimeInfo.persistSupported ? 'OPFS: on' : 'OPFS: unavailable',
  ].join('  ·  ');
  writeTerminal('web-node runtime ready.\n', 'ok');
  if (runtimeInfo.wasmModules.length) {
    writeTerminal('native→wasm modules: ' + runtimeInfo.wasmModules.join(', ') + '\n', 'sys');
  }
  if (runtimeInfo.vendoredFiles.length) {
    writeTerminal('vendored from Node source:\n  ' + runtimeInfo.vendoredFiles.join('\n  ') + '\n', 'sys');
  }
  writeTerminal('internalBindings: ' + runtimeInfo.bindings.join(', ') + '\n\n', 'sys');
});
runBtn.addEventListener('click', () => void runProject());
buildBtn.addEventListener('click', () => void buildProject());
bundleBtn.addEventListener('click', () => void bundleProject());
viteBtn.addEventListener('click', () => void viteBuildProject());
viteDevBtn.addEventListener('click', () => void viteDevProject());

async function installDeps(): Promise<void> {
  await save();
  installBtn.disabled = true;
  runBtn.disabled = true;
  setStatus('installing…', 'running');
  writeTerminal('\n$ npm install\n', 'sys');
  const started = performance.now();
  try {
    const result = await client.installDeps({ includeDev: true });
    const ms = (performance.now() - started).toFixed(0);
    for (const warning of result.warnings) writeTerminal(`[npm] ${warning}\n`, 'err');
    for (const pkg of result.installed) writeTerminal(`  ${pkg.name}@${pkg.version}\n`, 'sys');
    if (result.fromLockfile) {
      writeTerminal(`[lock] reused ${result.fromLockfile} package(s) from package-lock.json\n`, 'sys');
    }
    if (result.lifecycle?.length) {
      writeTerminal(`[lifecycle] ran ${result.lifecycle.join(', ')}\n`, 'ok');
    }
    if (result.binLinks?.length) {
      writeTerminal(`[bin] node_modules/.bin: ${result.binLinks.join(', ')}\n`, 'ok');
    }
    writeTerminal(`[installed ${result.packages} package(s) in ${ms}ms — now press ▶ Run]\n`, 'ok');
    setStatus(`installed ${result.packages}`, 'ok');
    // A fresh install writes node_modules (and the lockfile) behind the UI's
    // back, so re-read the tree to show them.
    files = (await client.mount({})).filter((f) => !f.endsWith('/'));
    renderTree();
  } catch (err) {
    writeTerminal(`[npm install failed] ${(err as Error).message}\n`, 'err');
    setStatus('error', 'err');
  } finally {
    installBtn.disabled = false;
    runBtn.disabled = false;
  }
}

installBtn.addEventListener('click', () => void installDeps());
clearBtn.addEventListener('click', () => {
  terminalEl.innerHTML = '';
  setStatus('');
});
resetBtn.addEventListener('click', async () => {
  files = await client.reset();
  renderTree();
  await openFile('/project/index.js');
  await refreshPorts();
  writeTerminal('\n[project reset to demo files]\n', 'sys');
});

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    void runProject();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    void save();
  }
});

async function boot(): Promise<void> {
  const bridged = await client.installServiceWorkerBridge();
  installHmrRelay();
  startPortWatch();
  await client.init();
  // The ready payload populated `files` via the 'ready' handler; a no-op mount
  // re-reads the current tree so ordering is deterministic.
  const list = await client.mount({});
  files = list.filter((f) => !f.endsWith('/'));
  renderTree();
  const entry = files.find((f) => f.endsWith('index.js')) ?? files[0];
  if (entry) await openFile(entry);
  writeTerminal(
    bridged
      ? 'service worker bridge ready — /preview/<port>/ routes into the virtual network.\n'
      : 'service worker unavailable — preview routing disabled.\n',
    bridged ? 'sys' : 'err',
  );
  writeTerminal('\nPress ▶ Run (or ⌘/Ctrl+Enter).\n\n', 'sys');
  await refreshPorts();
}

void boot().catch((err: unknown) => {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  bootEl.textContent = `boot failed — ${message}`;
  writeTerminal(`\n[boot failed] ${message}\n`, 'err');
});

window.addEventListener('error', (e) => writeTerminal(`\n[window error] ${e.message}\n`, 'err'));
window.addEventListener('unhandledrejection', (e) =>
  writeTerminal(`\n[unhandled rejection] ${String((e as PromiseRejectionEvent).reason)}\n`, 'err'),
);

/**
 * Route Vite HMR frames to a preview that lives on its own subdomain.
 *
 * HMR frames travel on a same-origin `BroadcastChannel` (see `public/sw.js`).
 * A `<port>.localhost` preview is a different origin, so it cannot hear that
 * channel; its WebSocket shim posts frames to this page instead, and this page
 * — which does share the runtime's origin — relays them both ways.
 */
type HmrRelay = { follow: (port: number | null) => void };
let hmrRelay: HmrRelay = { follow: () => {} };

/**
 * Route Vite HMR frames to a preview that lives on its own subdomain.
 *
 * HMR frames travel on a same-origin `BroadcastChannel` (see `public/sw.js`).
 * A `<port>.localhost` preview is a different origin, so it cannot hear that
 * channel; its WebSocket shim posts frames to this page instead, and this page
 * — which does share the runtime's origin — relays them both ways.
 *
 * There is one channel per preview port (`web-node-hmr:<port>`), so two dev
 * servers on different ports never see each other's clients. The shim tags each
 * frame with its port, and we only push the runtime's replies to the iframe
 * currently showing that port.
 */
function installHmrRelay(): void {
  const channels = new Map<number, BroadcastChannel>();
  let shownPort: number | null = null;

  const channelFor = (port: number): BroadcastChannel => {
    let channel = channels.get(port);
    if (!channel) {
      channel = new BroadcastChannel(`web-node-hmr:${port}`);
      channel.onmessage = (event) => {
        if (shownPort === port) previewFrame.contentWindow?.postMessage({ __wnHmr: event.data, port }, '*');
      };
      channels.set(port, channel);
    }
    return channel;
  };

  window.addEventListener('message', (event) => {
    const data = event.data as { __wnHmr?: unknown; port?: number } | null;
    if (data && data.__wnHmr !== undefined && typeof data.port === 'number') {
      channelFor(data.port).postMessage(data.__wnHmr);
    }
  });

  hmrRelay = {
    follow: (port) => {
      shownPort = port;
      // Subscribe eagerly so the runtime's first reply is not missed.
      if (port !== null) channelFor(port);
    },
  };
}
