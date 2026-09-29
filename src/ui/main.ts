import { RuntimeClient } from '../client';
import type { RuntimeInfo } from '../worker/runtime.worker';
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
const runBtn = $<HTMLButtonElement>('run');
const clearBtn = $<HTMLButtonElement>('clear');
const resetBtn = $<HTMLButtonElement>('reset');
const chipsEl = $<HTMLDivElement>('scenario-chips');
const stepsEl = $<HTMLDivElement>('steps');
const nextHintEl = $<HTMLSpanElement>('next-hint');
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

// --- process runner --------------------------------------------------------

/**
 * `node <entry>` with shared terminal/status handling.
 *
 * `awaitExit` distinguishes the two shapes of demo entry: a build that runs to
 * completion (await it, report the elapsed time, mark the step done) vs. a
 * server that binds a port and then stays up (`index.js`, `vite-dev.mjs`,
 * `webpack-dev.mjs`, `vite-react.mjs`). The latter never settles — awaiting it
 * would freeze the button forever — so it is started and the UI moves on; the
 * port watcher picks it up when it comes up.
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

// --- HMR edits -------------------------------------------------------------

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

// --- scenario / step engine ------------------------------------------------

/**
 * The nav bar used to be a flat row of 13 buttons with no ordering, so it was
 * easy to click a tool before its dependencies existed and get a confusing
 * `MODULE_NOT_FOUND`. The UI is now a *scenario stepper*: pick a scenario, and
 * the bar shows its steps in order, with prerequisites gated and the next
 * action highlighted.
 */
type StepId =
  | 'install'
  | 'run'
  | 'build'
  | 'bundle'
  | 'vite'
  | 'vitedev'
  | 'hmred'
  | 'hmrcss'
  | 'vitereact'
  | 'wpdev'
  | 'tsc'
  | 'cluster'
  | 'rspackInstall'
  | 'rspackBuild';

type Requirement = 'none' | 'deps' | 'rspackDeps' | 'viteDev';

interface StepDef {
  label: string;
  /** What must be true before this step can run. */
  needs: Requirement;
  /** A server that binds a port and stays up — never awaited (see `runProcess`). */
  long?: boolean;
  exec: () => Promise<void>;
}

interface ScenarioDef {
  id: string;
  label: string;
  blurp: string;
  steps: StepId[];
}

const STEPS: Record<StepId, StepDef> = {
  install: {
    label: '⬇ Install deps',
    needs: 'none',
    exec: () => installDeps(),
  },
  run: {
    label: '▶ Run',
    needs: 'deps',
    long: true,
    exec: () => runProcess('/project/index.js', 'node /project/index.js', false),
  },
  build: {
    label: '▦ Build',
    needs: 'deps',
    exec: () => runProcess('/project/build.js', 'node /project/build.js', true),
  },
  bundle: {
    label: '⧉ Bundle',
    needs: 'deps',
    exec: () => runProcess('/project/bundle.js', 'node /project/bundle.js', true),
  },
  vite: {
    label: '⚡ Vite build',
    needs: 'deps',
    exec: () => runProcess('/project/vite-build.mjs', 'node /project/vite-build.mjs', true),
  },
  vitedev: {
    label: '🛠 Vite dev',
    needs: 'deps',
    long: true,
    exec: () => runProcess('/project/vite-dev.mjs', 'node /project/vite-dev.mjs', false),
  },
  hmred: { label: '✏️ HMR JS', needs: 'viteDev', exec: () => hmrEdit() },
  hmrcss: { label: '🎨 HMR CSS', needs: 'viteDev', exec: () => hmrCssEdit() },
  vitereact: {
    label: '⚛ Vite React',
    needs: 'deps',
    long: true,
    exec: () => runProcess('/project/vite-react.mjs', 'node /project/vite-react.mjs', false),
  },
  wpdev: {
    label: '📦 Webpack dev',
    needs: 'deps',
    long: true,
    exec: () => runProcess('/project/webpack-dev.mjs', 'node /project/webpack-dev.mjs', false),
  },
  tsc: {
    label: '⌨ tsc build',
    needs: 'deps',
    exec: () => runProcess('/project/tsc-build.js', 'node /project/tsc-build.js', true),
  },
  cluster: {
    label: '🖧 Cluster',
    needs: 'none',
    exec: () => runProcess('/project/cluster-demo.mjs', 'node /project/cluster-demo.mjs', true),
  },
  rspackInstall: {
    label: '⬇ Install rspack deps',
    needs: 'none',
    exec: () => installRspackDeps(),
  },
  rspackBuild: {
    label: '🔷 rspack build',
    needs: 'rspackDeps',
    exec: () => runProcess('/project/rspack/build.cjs', 'node /project/rspack/build.cjs', true),
  },
};

const SCENARIOS: ScenarioDef[] = [
  {
    id: 'run',
    label: '▶ Run app',
    blurp: 'start the demo HTTP server on :3000',
    steps: ['install', 'run'],
  },
  {
    id: 'vite',
    label: '⚡ Vite',
    blurp: 'Vite build + dev server + HMR, all in the tab',
    steps: ['install', 'vite', 'vitedev', 'hmred', 'hmrcss'],
  },
  {
    id: 'webpack',
    label: '📦 Webpack',
    blurp: 'webpack dev server (watch + reload)',
    steps: ['install', 'wpdev'],
  },
  {
    id: 'rspack',
    label: '🔷 rspack',
    blurp: 'Rust bundler via wasm32-wasi + a real Worker thread pool',
    steps: ['rspackInstall', 'rspackBuild'],
  },
  {
    id: 'react',
    label: '⚛ React',
    blurp: 'Vite + JSX + Tailwind/PostCSS',
    steps: ['install', 'vitereact'],
  },
  {
    id: 'esbuild',
    label: '▦ esbuild',
    blurp: 'bundle TypeScript with esbuild-wasm',
    steps: ['install', 'build'],
  },
  {
    id: 'rollup',
    label: '⧉ rollup',
    blurp: 'bundle ES modules with rollup-wasm',
    steps: ['install', 'bundle'],
  },
  {
    id: 'tsc',
    label: '⌨ tsc',
    blurp: 'the real TypeScript compiler: parse → typecheck → emit',
    steps: ['install', 'tsc'],
  },
  {
    id: 'cluster',
    label: '🖧 Cluster',
    blurp: 'two processes sharing one port',
    steps: ['cluster'],
  },
];

let activeScenario = SCENARIOS[0].id;
let busy = false;
let ports: number[] = [];
let depsReady = false;
let rspackDepsReady = false;
let viteDevReady = false;
/** Step ids that have actually run (derived gates are synced in `syncDerived`). */
const completed = new Set<StepId>();

function scenarioById(id: string): ScenarioDef {
  return SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[0];
}

/** Fold observed runtime state into `completed` (so gates survive a reload). */
function syncDerived(): void {
  const sync = (id: StepId, done: boolean): void => {
    if (done) completed.add(id);
    else completed.delete(id);
  };
  sync('install', depsReady);
  sync('rspackInstall', rspackDepsReady);
  sync('vitedev', viteDevReady);
}

function stepEnabled(id: StepId): boolean {
  switch (STEPS[id].needs) {
    case 'deps':
      return depsReady;
    case 'rspackDeps':
      return rspackDepsReady;
    case 'viteDev':
      return viteDevReady;
    default:
      return true;
  }
}

function requirementText(needs: Requirement): string {
  switch (needs) {
    case 'deps':
      return 'needs step 1 — Install deps first';
    case 'rspackDeps':
      return 'needs step 1 — Install rspack deps first';
    case 'viteDev':
      return 'needs the Vite dev server running';
    default:
      return '';
  }
}

function renderChips(): void {
  chipsEl.innerHTML = '';
  for (const scenario of SCENARIOS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.scenario = scenario.id;
    btn.textContent = scenario.label;
    btn.title = scenario.blurp;
    if (scenario.id === activeScenario) btn.classList.add('active');
    btn.addEventListener('click', () => selectScenario(scenario.id));
    chipsEl.appendChild(btn);
  }
}

/**
 * Rebuild the step bar for the active scenario and refresh the "next step"
 * guidance. A step is:
 *   - *done*    (✓) once its effect is observed (deps installed, dev server up)
 *                  or it has run to completion this session;
 *   - *blocked* (grey, disabled) while its prerequisite is unmet;
 *   - *next*    (highlighted) when it is the first runnable, not-yet-done step.
 */
function renderSteps(): void {
  const scenario = scenarioById(activeScenario);
  stepsEl.innerHTML = '';
  let nextId: StepId | null = null;

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
      btn.title = requirementText(def.needs);
    } else {
      btn.title = scenario.blurp;
      btn.disabled = busy;
      btn.addEventListener('click', () => void runStep(id));
    }
    stepsEl.appendChild(btn);
  });

  updateHint(nextId);
  runBtn.disabled = busy || !depsReady;
}

function updateHint(nextId: StepId | null): void {
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
  nextHintEl.textContent = '✓ Scenario complete — try another';
  nextHintEl.className = 'next-hint done';
}

function selectScenario(id: string): void {
  activeScenario = id;
  renderChips();
  renderSteps();
}

async function runStep(id: StepId): Promise<void> {
  if (busy || !stepEnabled(id)) return;
  busy = true;
  renderSteps();
  try {
    await STEPS[id].exec();
    if (!STEPS[id].long) completed.add(id);
  } catch {
    // `runProcess` already reported the failure in the terminal.
  } finally {
    busy = false;
    await refreshPorts();
    syncDerived();
    renderSteps();
  }
}

runBtn.addEventListener('click', () => void runStep('run'));

// --- preview ---------------------------------------------------------------

async function refreshPorts(): Promise<void> {
  const described = await client.describe();
  ports = described.ports;
  viteDevReady = ports.includes(5173);
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
  info = runtimeInfo;
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

async function installDeps(): Promise<void> {
  await save();
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
    writeTerminal(`[installed ${result.packages} package(s) in ${ms}ms — now pick a scenario step]\n`, 'ok');
    setStatus(`installed ${result.packages}`, 'ok');
    // A fresh install writes node_modules (and the lockfile) behind the UI's
    // back, so re-read the tree to show them.
    files = (await client.mount({})).filter((f) => !f.endsWith('/'));
    renderTree();
    depsReady = depsInstalledFromFiles();
  } catch (err) {
    writeTerminal(`[npm install failed] ${(err as Error).message}\n`, 'err');
    setStatus('error', 'err');
    throw err;
  }
}

/**
 * rspack's dependency tree is heavy (143 packages / ~80s / a 30 MB wasm), so it
 * is installed *separately* under `/project/rspack` and only when the rspack
 * scenario asks for it — the default `Install deps` stays fast.
 */
async function installRspackDeps(): Promise<void> {
  await save();
  setStatus('installing rspack…', 'running');
  writeTerminal('\n$ npm install  # in /project/rspack\n', 'sys');
  writeTerminal('[rspack] installing @rspack/core + binding-wasm32-wasi (~143 pkgs)…\n', 'sys');
  const started = performance.now();
  try {
    const result = await client.installDeps({ cwd: '/project/rspack', includeDev: false });
    const ms = (performance.now() - started).toFixed(0);
    for (const warning of result.warnings) writeTerminal(`[npm] ${warning}\n`, 'err');
    if (result.fromLockfile) {
      writeTerminal(`[lock] reused ${result.fromLockfile} package(s) from package-lock.json\n`, 'sys');
    }
    writeTerminal(`[rspack] installed ${result.packages} package(s) in ${ms}ms\n`, 'ok');
    setStatus(`rspack deps: ${result.packages}`, 'ok');
    files = (await client.mount({})).filter((f) => !f.endsWith('/'));
    renderTree();
    rspackDepsReady = rspackDepsInstalledFromFiles();
  } catch (err) {
    writeTerminal(`[rspack install failed] ${(err as Error).message}\n`, 'err');
    setStatus('error', 'err');
    throw err;
  }
}

function depsInstalledFromFiles(): boolean {
  return files.some((f) => f.startsWith('/project/node_modules/'));
}

function rspackDepsInstalledFromFiles(): boolean {
  return files.some((f) => f.startsWith('/project/rspack/node_modules/'));
}

clearBtn.addEventListener('click', () => {
  terminalEl.innerHTML = '';
  setStatus('');
});
resetBtn.addEventListener('click', async () => {
  files = await client.reset();
  renderTree();
  await openFile('/project/index.js');
  depsReady = depsInstalledFromFiles();
  rspackDepsReady = rspackDepsInstalledFromFiles();
  await refreshPorts();
  syncDerived();
  renderSteps();
  writeTerminal('\n[project reset to demo files]\n', 'sys');
});

window.addEventListener('keydown', (e) => {
  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
    e.preventDefault();
    void runStep('run');
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    void save();
  }
});

async function boot(): Promise<void> {
  renderChips();
  renderSteps();
  const bridged = await client.installServiceWorkerBridge();
  installHmrRelay();
  startPortWatch();
  await client.init();
  // The ready payload populated `files` via the 'ready' handler; a no-op mount
  // re-reads the current tree so ordering is deterministic.
  const list = await client.mount({});
  files = list.filter((f) => !f.endsWith('/'));
  renderTree();
  depsReady = depsInstalledFromFiles();
  rspackDepsReady = rspackDepsInstalledFromFiles();
  const entry = files.find((f) => f.endsWith('index.js')) ?? files[0];
  if (entry) await openFile(entry);
  writeTerminal(
    bridged
      ? 'service worker bridge ready — /preview/<port>/ routes into the virtual network.\n'
      : 'service worker unavailable — preview routing disabled.\n',
    bridged ? 'sys' : 'err',
  );
  writeTerminal('\nPick a scenario above, then follow the numbered steps.\n\n', 'sys');
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
