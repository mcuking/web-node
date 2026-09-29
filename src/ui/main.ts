import { RuntimeClient } from '../client';
import type { RuntimeInfo } from '../worker/runtime.worker';
import { DEMO_PROJECTS, PROJECT_ORDER, type DemoProject, type ProjectId } from '../projects';
import { previewUrl as buildPreviewUrl, previewPortFromHost, prefixPreviewUrl } from './preview-url';

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
  /** Breakdown of the worker's work, all ms (M107). */
  vendoredMs: number;
  wasmMs: number;
  realmMs: number;
  /** Worker-clock ms when the deferred WASM codecs landed (after `ready`). */
  deferredMs: number;
  /** Worker-clock ms when the lazy vendored-source tier landed (after `ready`, M126). */
  vendoredDeferredMs: number;
}
const bootTiming: BootTiming = {
  moduleEvalMs: performance.now(),
  workerSpawnMs: 0,
  runtimeReadyMs: 0,
  firstRunMs: 0,
  vendoredMs: 0,
  wasmMs: 0,
  realmMs: 0,
  deferredMs: 0,
  vendoredDeferredMs: 0,
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
const clearBtn = $<HTMLButtonElement>('clear');
const resetBtn = $<HTMLButtonElement>('reset');
const projectChipsEl = $<HTMLDivElement>('project-chips');
const stepsEl = $<HTMLDivElement>('steps');
const nextHintEl = $<HTMLSpanElement>('next-hint');
const filesRootEl = $<HTMLSpanElement>('files-root');
const portSelect = $<HTMLSelectElement>('port-select');
const refreshBtn = $<HTMLButtonElement>('refresh');
const openTab = $<HTMLAnchorElement>('open-tab');
const previewFrame = $<HTMLIFrameElement>('preview-frame');
const previewEmpty = $<HTMLDivElement>('preview-empty');
const viewOutput = $<HTMLDivElement>('view-output');
const viewPreview = $<HTMLDivElement>('view-preview');

let files: string[] = [];
let activeFile = '';
let dirty = false;
let activeProject: ProjectId = 'vite';
let busy = false;
let ports: number[] = [];

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

/** Re-read the whole VFS file list (the worker's `mount` with no files is a no-op write). */
async function readTree(): Promise<string[]> {
  const list = await client.mount({});
  return list.filter((f) => !f.endsWith('/'));
}

/**
 * The file tree shows *only the active project*: a project is a self-contained
 * directory (`/project/vite`, `/project/webpack`, `/project/rspack`,
 * `/project/node`), so which files you see tells you which project you are in.
 * `node_modules` is hidden to keep the list readable.
 */
function renderTree(): void {
  const { root } = DEMO_PROJECTS[activeProject];
  const prefix = root + '/';
  filesRootEl.textContent = root;
  treeEl.innerHTML = '';
  for (const f of files) {
    if (!f.startsWith(prefix)) continue;
    if (f.includes('/node_modules/')) continue;
    const li = document.createElement('li');
    li.textContent = f.slice(prefix.length);
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
  const { root } = DEMO_PROJECTS[activeProject];
  activeFileEl.textContent = path.startsWith(root + '/') ? path.slice(root.length + 1) : path;
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

// --- process runner --------------------------------------------------------

/**
 * `node <entry>` with shared terminal/status handling.
 *
 * `awaitExit` distinguishes the two shapes of demo entry: a build that runs to
 * completion (await it, report the elapsed time, mark the step done) vs. a
 * server that binds a port and then stays up (`dev.mjs`, `index.js`). The
 * latter never settles — awaiting it would freeze the button forever — so it is
 * started and the UI moves on; the port watcher picks it up when it comes up.
 */
async function runProcess(entry: string, label: string, awaitExit: boolean): Promise<void> {
  await save();
  setStatus('running…', 'running');
  writeTerminal(`\n$ ${label}\n`, 'sys');
  const started = performance.now();
  const promise = client.run(entry);
  if (!awaitExit) {
    promise.catch((err: unknown) => {
      writeTerminal(`[run failed] ${(err as Error).message}\n`, 'err');
      setStatus('error', 'err');
    });
    return;
  }
  try {
    await promise;
    const ms = (performance.now() - started).toFixed(0);
    if (!bootTiming.firstRunMs) bootTiming.firstRunMs = Math.round(performance.now());
    setStatus(`done in ${ms}ms`, 'ok');
    writeTerminal(`[exit 0 · ${ms}ms]\n`, 'sys');
  } catch (err) {
    writeTerminal(`[run failed] ${(err as Error).message}\n`, 'err');
    setStatus('error', 'err');
    throw err;
  }
}

// --- project / step engine -------------------------------------------------

/**
 * The nav bar used to be a flat row of buttons mixing *tools* (esbuild, rollup,
 * tsc) with *projects* (Vite, webpack), so it was easy to click a tool before
 * its dependencies existed and get a confusing `MODULE_NOT_FOUND`.
 *
 * It is now a *project stepper*: pick one of the four projects and the bar
 * shows its steps in order, with prerequisites gated and the next action
 * highlighted. Every project has the same first step (Install deps) and then a
 * dev/build (or, for the Node.js playground, a single Run).
 */
type Requirement = 'none' | 'deps';

interface StepDef {
  label: string;
  /** What must be true before this step can run (deps of the active project). */
  needs: Requirement;
  /** A server that binds a port and stays up — never awaited (see `runProcess`). */
  long?: boolean;
  exec: () => Promise<void>;
}

const STEPS: Record<string, StepDef> = {};
for (const id of PROJECT_ORDER) {
  const project = DEMO_PROJECTS[id];
  STEPS[`${id}/install`] = { label: '↓ Install deps', needs: 'none', exec: () => installDeps(project) };
  if (id === 'node') {
    STEPS[`${id}/run`] = {
      label: '▶ Run',
      needs: 'deps',
      long: true,
      exec: () => runProcess(`${project.root}/index.js`, `node ${project.root}/index.js`, false),
    };
  } else {
    STEPS[`${id}/dev`] = {
      label: '▶ Run dev',
      needs: 'deps',
      long: true,
      exec: () => runProcess(`${project.root}/dev.mjs`, `node ${project.root}/dev.mjs`, false),
    };
    STEPS[`${id}/build`] = {
      label: '⚙ Run build',
      needs: 'deps',
      exec: () => runProcess(`${project.root}/build.mjs`, `node ${project.root}/build.mjs`, true),
    };
  }
}

interface ScenarioDef {
  id: ProjectId;
  label: string;
  blurp: string;
  steps: string[];
}

const META: Record<ProjectId, { label: string; blurp: string }> = {
  vite: { label: '⚡ Vite', blurp: 'Vue 3 single-file component — Vite dev server + build, in the tab' },
  webpack: { label: '📦 Webpack', blurp: 'webpack watches and bundles; the preview full-reloads' },
  rspack: { label: '🔷 rspack', blurp: 'Rust bundler via wasm32-wasi on a real Worker thread pool' },
  node: { label: '🟢 Node.js', blurp: 'the full runtime — fs, http, crypto, streams, workers, child processes' },
};

const SCENARIOS: ScenarioDef[] = PROJECT_ORDER.map((id) => ({
  id,
  ...META[id],
  steps: id === 'node' ? [`${id}/install`, `${id}/run`] : [`${id}/install`, `${id}/dev`, `${id}/build`],
}));

/** The port each project's dev server (or the Node playground) listens on. */
const DEV_PORT: Record<ProjectId, number> = { vite: 5173, webpack: 5174, rspack: 5175, node: 3000 };

/** Step ids that are observably complete (deps on disk / a port listening). */
const completed = new Set<string>();

function projectDeps(id: ProjectId): boolean {
  return files.some((f) => f.startsWith(DEMO_PROJECTS[id].root + '/node_modules/'));
}

function stepEnabled(id: string): boolean {
  return STEPS[id].needs === 'deps' ? projectDeps(activeProject) : true;
}

/** Fold observed runtime state into `completed`, so gates survive a reload. */
function syncDerived(): void {
  for (const id of PROJECT_ORDER) {
    const install = `${id}/install`;
    if (projectDeps(id)) completed.add(install);
    else completed.delete(install);
    const runStepId = id === 'node' ? `${id}/run` : `${id}/dev`;
    if (ports.includes(DEV_PORT[id])) completed.add(runStepId);
    else completed.delete(runStepId);
  }
}

function scenarioById(id: ProjectId): ScenarioDef {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

/** The id of the first runnable, not-yet-done step of the active project. */
function nextStepId(): string | null {
  for (const id of scenarioById(activeProject).steps) {
    if (stepEnabled(id) && !completed.has(id)) return id;
  }
  return null;
}

function renderChips(): void {
  projectChipsEl.innerHTML = '';
  for (const scenario of SCENARIOS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.project = scenario.id;
    btn.textContent = scenario.label;
    btn.title = scenario.blurp;
    if (scenario.id === activeProject) btn.classList.add('active');
    btn.addEventListener('click', () => void selectProject(scenario.id));
    projectChipsEl.appendChild(btn);
  }
}

/**
 * Rebuild the step bar for the active project and refresh the "next step"
 * guidance. A step is:
 *   - *done*    (✓) once its effect is observed (deps installed, port listening)
 *                  or it has run to completion this session;
 *   - *blocked* (grey, disabled) while its prerequisite is unmet;
 *   - *next*    (highlighted) when it is the first runnable, not-yet-done step.
 */
function renderSteps(): void {
  const scenario = scenarioById(activeProject);
  stepsEl.innerHTML = '';
  let nextId: string | null = null;

  scenario.steps.forEach((id, index) => {
    const def = STEPS[id];
    const enabled = stepEnabled(id);
    const done = completed.has(id);
    const isNext = nextId === null && enabled && !done;
    if (isNext) nextId = id;

    if (index > 0) {
      const arrow = document.createElement('span');
      arrow.className = 'step-arrow';
      arrow.textContent = '→';
      stepsEl.appendChild(arrow);
    }

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'step';
    btn.dataset.step = id;
    const num = document.createElement('span');
    num.className = 'step-num';
    num.textContent = done ? '✓' : String(index + 1);
    const text = document.createElement('span');
    text.className = 'step-text';
    text.textContent = def.label;
    btn.append(num, text);
    if (done) btn.classList.add('done');
    if (isNext) btn.classList.add('next');
    if (!enabled) {
      btn.classList.add('blocked');
      btn.disabled = true;
      btn.title = 'needs step 1 — Install deps first';
    } else {
      btn.title = scenario.blurp;
      btn.disabled = busy;
      btn.addEventListener('click', () => void runStep(id));
    }
    stepsEl.appendChild(btn);
  });

  updateHint(nextId);
}

function updateHint(nextId: string | null): void {
  if (busy) {
    nextHintEl.textContent = 'running…';
    nextHintEl.className = 'next-hint running';
    return;
  }
  if (nextId) {
    nextHintEl.textContent = `Next: click ${STEPS[nextId].label}`;
    nextHintEl.className = 'next-hint action';
    return;
  }
  nextHintEl.textContent = '✓ Project complete — try another';
  nextHintEl.className = 'next-hint done';
}

async function selectProject(id: ProjectId): Promise<void> {
  if (busy) return;
  activeProject = id;
  renderChips();
  renderTree();
  renderSteps();
  await openFile(DEMO_PROJECTS[id].entry);
}

async function runStep(id: string): Promise<void> {
  if (busy || !stepEnabled(id)) return;
  busy = true;
  renderSteps();
  try {
    await STEPS[id].exec();
    if (!STEPS[id].long) completed.add(id);
  } catch {
    // `runProcess` / `installDeps` already reported the failure in the terminal.
  } finally {
    busy = false;
    await refreshPorts();
    syncDerived();
    renderSteps();
  }
}

// --- preview ---------------------------------------------------------------

async function refreshPorts(): Promise<void> {
  const described = await client.describe();
  ports = described.ports;
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
function startPortWatch(): void {
  setInterval(() => {
    void client
      .describe()
      .then(({ ports: next }) => {
        if (next.join(',') === ports.join(',')) return;
        void refreshPorts().then(() => {
          syncDerived();
          renderSteps();
        });
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
    // When the host serves `*.<domain>` from this app, previews get real
    // subdomain origins here too (M113) — the static-hosting counterpart of the
    // dev server's `*.localhost`.
    previewDomain: import.meta.env.VITE_WEB_NODE_PREVIEW_DOMAIN,
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

client.on('deferredReady', (ms) => {
  bootTiming.deferredMs = ms;
});

client.on('vendoredReady', (ms) => {
  bootTiming.vendoredDeferredMs = ms;
});

client.on('ready', (runtimeInfo) => {
  bootTiming.runtimeReadyMs = Math.round(performance.now());
  if (runtimeInfo.timing) {
    bootTiming.vendoredMs = runtimeInfo.timing.vendoredMs;
    bootTiming.wasmMs = runtimeInfo.timing.wasmMs;
    bootTiming.realmMs = runtimeInfo.timing.realmMs;
  }
  bootEl.textContent = runtimeInfo.restored ? 'runtime ready (restored from OPFS)' : 'runtime ready (fresh project)';
  factsEl.textContent = [
    `${runtimeInfo.bindings.length} bindings`,
    `${runtimeInfo.wasmModules.length + (runtimeInfo.deferredWasmModules?.length ?? 0)} wasm modules`,
    `${runtimeInfo.vendoredFiles.length} vendored node files`,
    runtimeInfo.persistSupported ? 'OPFS: on' : 'OPFS: unavailable',
    runtimeInfo.persistence === 'fs-worker' ? 'sync fs: durable' : 'sync fs: async',
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

async function installDeps(project: DemoProject): Promise<void> {
  await save();
  setStatus('installing…', 'running');
  writeTerminal(`\n$ npm install  # ${project.root}\n`, 'sys');
  const started = performance.now();
  try {
    const result = await client.installDeps({ cwd: project.root });
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
    writeTerminal(`[installed ${result.packages} package(s) in ${ms}ms — now run a step above]\n`, 'ok');
    setStatus(`installed ${result.packages}`, 'ok');
    // A fresh install writes node_modules (and the lockfile) behind the UI's
    // back, so re-read the tree to show them.
    files = await readTree();
    renderTree();
  } catch (err) {
    writeTerminal(`[npm install failed] ${(err as Error).message}\n`, 'err');
    setStatus('error', 'err');
    throw err;
  }
}

clearBtn.addEventListener('click', () => {
  terminalEl.innerHTML = '';
  setStatus('');
});
resetBtn.addEventListener('click', async () => {
  files = (await client.reset()).filter((f) => !f.endsWith('/'));
  renderTree();
  await openFile(DEMO_PROJECTS[activeProject].entry);
  await refreshPorts();
  syncDerived();
  renderSteps();
  writeTerminal('\n[projects reset to demo files]\n', 'sys');
});

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    const id = nextStepId();
    if (id) void runStep(id);
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    void save();
  }
});

async function boot(): Promise<void> {
  renderChips();
  renderTree();
  renderSteps();
  const bridged = await client.installServiceWorkerBridge();
  installHmrRelay();
  startPortWatch();
  await client.init();
  // The ready payload populated the VFS; re-read the tree so ordering is
  // deterministic and the gates see any restored `node_modules`.
  files = await readTree();
  renderTree();
  await openFile(DEMO_PROJECTS[activeProject].entry);
  writeTerminal(
    bridged
      ? 'service worker bridge ready — /preview/<port>/ routes into the virtual network.\n'
      : 'service worker unavailable — preview routing disabled.\n',
    bridged ? 'sys' : 'err',
  );
  writeTerminal('\nPick a project above, then follow the numbered steps.\n\n', 'sys');
  await refreshPorts();
  syncDerived();
  renderSteps();
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
 * There is one channel per dev-server port (`web-node-hmr:<port>`), so two dev
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
    if (!data || data.__wnHmr === undefined || typeof data.port !== 'number') return;
    // Only a real preview origin may push HMR frames at us.
    const host = (() => {
      try {
        return new URL(event.origin).hostname;
      } catch {
        return '';
      }
    })();
    if (previewPortFromHost(host, import.meta.env.VITE_WEB_NODE_PREVIEW_DOMAIN) === null) return;
    channelFor(data.port).postMessage(data.__wnHmr);
  });

  hmrRelay = {
    follow: (port) => {
      shownPort = port;
      // Subscribe eagerly so the runtime's first reply is not missed.
      if (port !== null) channelFor(port);
    },
  };
}
