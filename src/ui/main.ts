import { RuntimeClient } from '../client';
import type { RuntimeInfo } from '../worker/runtime.worker';

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
  await save();
  runBtn.disabled = true;
  setStatus('running…', 'running');
  // Echo a header so consecutive runs are visually separated.
  writeTerminal(`\n$ node /project/index.js\n`, 'sys');
  const started = performance.now();
  try {
    await client.run('/project/index.js');
    const ms = (performance.now() - started).toFixed(0);
    setStatus(`done in ${ms}ms`, 'ok');
    writeTerminal(`[exit 0 · ${ms}ms]\n`, 'sys');
  } catch (err) {
    writeTerminal(`[run failed] ${(err as Error).message}\n`, 'err');
    setStatus('error', 'err');
  } finally {
    runBtn.disabled = false;
    await refreshPorts();
  }
}

// --- preview ---------------------------------------------------------------

async function refreshPorts(): Promise<void> {
  const { ports } = await client.describe();
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

function previewUrl(): string {
  const port = portSelect.value;
  return `${location.origin}/preview/${port}/`;
}

function loadPreview(): void {
  const url = previewUrl();
  openTab.href = url;
  previewFrame.src = url;
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
  bootEl.textContent = runtimeInfo.restored ? 'runtime ready (restored from OPFS)' : 'runtime ready (fresh project)';
  factsEl.textContent = [
    `${runtimeInfo.bindings.length} bindings`,
    `${runtimeInfo.vendoredFiles.length} vendored node files`,
    runtimeInfo.persistSupported ? 'OPFS: on' : 'OPFS: unavailable',
  ].join('  ·  ');
  writeTerminal('web-node runtime ready.\n', 'ok');
  if (runtimeInfo.vendoredFiles.length) {
    writeTerminal('vendored from Node source:\n  ' + runtimeInfo.vendoredFiles.join('\n  ') + '\n', 'sys');
  }
  writeTerminal('internalBindings: ' + runtimeInfo.bindings.join(', ') + '\n\n', 'sys');
});
runBtn.addEventListener('click', () => void runProject());
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
