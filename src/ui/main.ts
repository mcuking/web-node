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
  const started = performance.now();
  try {
    await client.run('/project/index.js');
  } catch (err) {
    writeTerminal(`\n[run failed] ${(err as Error).message}\n`, 'err');
    setStatus('error', 'err');
  } finally {
    runBtn.disabled = false;
    const ms = (performance.now() - started).toFixed(0);
    if (!statusEl.classList.contains('err')) {
      setStatus(`done in ${ms}ms`, 'ok');
      writeTerminal(`\n[process exited ${ms}ms]\n`, 'sys');
    }
  }
}

client.on('stdout', (data) => writeTerminal(data));
client.on('stderr', (data) => writeTerminal(data, 'err'));
client.on('exit', (code) => {
  if (code !== 0) writeTerminal(`\n[exit code ${code}]\n`, 'err');
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
  await client.init();
  // The ready payload populated `files` via the 'ready' handler; a no-op mount
  // re-reads the current tree so ordering is deterministic.
  const list = await client.mount({});
  files = list.filter((f) => !f.endsWith('/'));
  renderTree();
  const entry = files.find((f) => f.endsWith('index.js')) ?? files[0];
  if (entry) await openFile(entry);
  writeTerminal('\nPress ▶ Run (or ⌘/Ctrl+Enter).\n\n', 'sys');
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
