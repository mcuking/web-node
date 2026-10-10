import { RuntimeClient, type TreeEntry } from '../client';
import { selectBuildOutputs } from './build-outputs';
import type { RuntimeInfo } from '../worker/runtime.worker';
import {
  DEMO_PROJECTS,
  PROJECT_ORDER,
  TEMPLATE_META,
  entryFor,
  loadStoredProjects,
  nextProjectPort,
  projectFromStored,
  projectIdFromName,
  saveStoredProjects,
  type DemoProject,
  type ProjectId,
  type TemplateId,
} from '../projects';
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

/**
 * Session flag guarding the one-time cross-origin-isolation reload (see
 * `boot`). It lives in `sessionStorage` so it survives the reload itself and
 * keeps a host that never isolates from reloading forever.
 */
const COI_RELOAD_FLAG = 'web-node:coi-reloaded';
const openTab = $<HTMLAnchorElement>('open-tab');
const previewFrame = $<HTMLIFrameElement>('preview-frame');
const previewEmpty = $<HTMLDivElement>('preview-empty');
const viewOutput = $<HTMLDivElement>('view-output');
const viewPreview = $<HTMLDivElement>('view-preview');
const newFileBtn = $<HTMLButtonElement>('new-file');
const newFolderBtn = $<HTMLButtonElement>('new-folder');
const addDepBtn = $<HTMLButtonElement>('add-dep');

let tree: TreeEntry[] = [];
let activeFile = '';
let dirty = false;
let activeProject: ProjectId = 'node';
let busy = false;
let ports: number[] = [];
/** Which project each `run()` belongs to, so its output stays with it. */
const runOwner = new Map<number, ProjectId>();

/**
 * Every project the UI can show: the four built-ins plus any the user created.
 * A registry rather than the static `DEMO_PROJECTS` record, because custom
 * projects are registered at runtime, once their sources are scaffolded.
 */
const PROJECTS = new Map<ProjectId, DemoProject>();
function projectById(id: ProjectId): DemoProject {
  return PROJECTS.get(id) ?? DEMO_PROJECTS.node;
}

/**
 * Write one line to the terminal, tagged with the project it came from.
 *
 * Output ownership matters because a project's dev server is a *program*: the
 * runtime can start one but cannot stop it, so a server from a project we have
 * switched away from keeps running and keeps logging. Tagging each line with
 * its project (see `runOwner`) lets the terminal hide that late output instead
 * of letting it appear under whatever project is now on screen.
 */
function writeTerminal(text: string, cls = '', pid: ProjectId = activeProject): void {
  const span = document.createElement('span');
  if (cls) span.className = cls;
  span.textContent = text;
  span.dataset.pid = pid;
  if (pid !== activeProject) span.style.display = 'none';
  terminalEl.appendChild(span);
  terminalEl.scrollTop = terminalEl.scrollHeight;
}

/** The project a run belongs to; runtime-level output (id 0) is the active one. */
function ownerOf(runId: number): ProjectId {
  return runOwner.get(runId) ?? activeProject;
}

function setStatus(text: string, cls = ''): void {
  statusEl.textContent = text;
  statusEl.className = `status ${cls}`;
}

/** Re-read the whole VFS tree (paths + types), without pulling file bodies. */
async function readTree(): Promise<TreeEntry[]> {
  return client.tree();
}

// --- file explorer state ---------------------------------------------------

/** Folders the user collapsed; everything starts expanded. */
const collapsedDirs = new Set<string>();
/** A new file/folder being named in place, keyed by its parent folder. */
let creating: { parent: string; kind: 'file' | 'dir' } | null = null;
/** The path whose name is being edited in place, or null. */
let renaming: string | null = null;

const baseName = (path: string): string => path.slice(path.lastIndexOf('/') + 1);
const parentDir = (path: string): string => path.slice(0, path.lastIndexOf('/'));
const joinPath = (dir: string, name: string): string => dir.replace(/\/+$/, '') + '/' + name;

/**
 * How much of a file name to preselect when renaming: everything up to the last
 * dot (the stem), so the extension is left out of the selection.
 *
 * A name with no dot, or a dotfile like `.gitignore`, has no extension to
 * preserve, so the whole name is selected. `archive.tar.gz` keeps only `.gz`
 * out of the selection, matching common editor behaviour.
 */
function renameSelectionEnd(name: string): number {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? dot : name.length;
}

/**
 * Row-action icons, as inline SVG on a 16px grid.
 *
 * Glyph characters (＋ 📄 ✎ 🗑) render at the mercy of the emoji font — they
 * vary in width and colour, and a coloured emoji cannot inherit the row's
 * colour on hover. A stroked SVG inherits `currentColor` and stays crisp.
 */
const ICON = {
  newFile:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M9 1.6H4.6A1.6 1.6 0 0 0 3 3.2v9.6A1.6 1.6 0 0 0 4.6 14.4h6.8A1.6 1.6 0 0 0 13 12.8V5.6z"/><path d="M9 1.6v4h4"/><path d="M8 8.2v3.2M6.4 9.8h3.2"/></svg>',
  newDir:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M1.6 4.4A1.6 1.6 0 0 1 3.2 2.8h2.6l1.5 1.6h5.5A1.6 1.6 0 0 1 14.4 6v6a1.6 1.6 0 0 1-1.6 1.6H3.2A1.6 1.6 0 0 1 1.6 11.9z"/><path d="M8 7.4v3.2M6.4 9h3.2"/></svg>',
  rename:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M10.6 2.6a1.4 1.4 0 0 1 2 2L5.4 11.8l-2.6.8.8-2.6z"/><path d="M9.6 3.6l2 2"/></svg>',
  delete:
    '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true"><path d="M2.6 4h10.8"/><path d="M5.6 4V2.9a1 1 0 0 1 1-1h2.8a1 1 0 0 1 1 1V4"/><path d="M4.1 4l.6 8.9a1 1 0 0 0 1 .9h4.6a1 1 0 0 0 1-.9L12 4"/><path d="M6.7 6.9v4.2M9.3 6.9v4.2"/></svg>',
};

/**
 * The file tree renders *only the active project*, as a nested explorer (the
 * way a desktop IDE does): folders collapse, `node_modules` is hidden (it would
 * swamp the list and every project has one), and each row carries the actions
 * that apply to it — new file / new folder / rename / delete for a folder,
 * rename / delete for a file. New entries and renames happen in an inline input,
 * so nothing leaves the tree.
 */
function renderTree(): void {
  const { root } = projectById(activeProject);
  const prefix = root + '/';
  filesRootEl.textContent = root;
  treeEl.innerHTML = '';

  const entries = tree
    .filter((e) => e.path.startsWith(prefix))
    .filter((e) => e.path !== prefix + 'node_modules' && !e.path.startsWith(prefix + 'node_modules/'));

  // Group the flat path list by parent directory, then sort each bucket
  // folders-first and by name — the order a tree view reads in.
  const childrenOf = new Map<string, TreeEntry[]>();
  for (const entry of entries) {
    const parent = parentDir(entry.path);
    const bucket = childrenOf.get(parent);
    if (bucket) bucket.push(entry);
    else childrenOf.set(parent, [entry]);
  }
  for (const bucket of childrenOf.values()) {
    bucket.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return baseName(a.path).localeCompare(baseName(b.path));
    });
  }

  const renderDir = (dir: string, depth: number): void => {
    if (!collapsedDirs.has(dir)) {
      for (const entry of childrenOf.get(dir) ?? []) {
        treeEl.appendChild(makeRow(entry, depth));
        if (entry.type === 'dir') renderDir(entry.path, depth + 1);
      }
    }
    if (creating && creating.parent === dir) treeEl.appendChild(makeCreateRow(depth));
  };

  renderDir(root, 0);
}

/** One explorer row: indent, caret, icon, name, and the row's actions. */
function makeRow(entry: TreeEntry, depth: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'row-item' + (entry.type === 'dir' ? ' dir' : '');
  li.dataset.path = entry.path;
  li.dataset.type = entry.type;
  li.style.paddingLeft = 4 + depth * 14 + 'px';
  if (entry.path === activeFile) li.classList.add('active');

  const caret = document.createElement('span');
  caret.className = 'caret';
  caret.textContent = entry.type === 'dir' ? (collapsedDirs.has(entry.path) ? '▸' : '▾') : '';
  li.appendChild(caret);

  const icon = document.createElement('span');
  icon.className = 'ftype';
  icon.textContent = entry.type === 'dir' ? '📁' : '📄';
  li.appendChild(icon);

  // Renaming this row: swap the name for an input in place.
  if (renaming === entry.path) {
    const input = document.createElement('input');
    input.className = 'tree-input';
    input.value = baseName(entry.path);
    input.spellcheck = false;
    li.appendChild(input);
    queueMicrotask(() => {
      input.focus();
      // Select the stem only, so typing replaces "App" in "App.vue" while the
      // extension stays put - matching a WebContainer-style explorer. A leading
      // dot is part of the name (dotfiles), not an extension.
      input.setSelectionRange(0, renameSelectionEnd(input.value));
    });
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        e.preventDefault();
        void commitRename(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        renaming = null;
        renderTree();
      }
    });
    input.addEventListener('blur', () => {
      if (renaming === entry.path) void commitRename(input.value);
    });
    return li;
  }

  const name = document.createElement('span');
  name.className = 'fname';
  name.textContent = baseName(entry.path);
  li.appendChild(name);

  const actions = document.createElement('span');
  actions.className = 'row-actions';
  const addAct = (cls: string, title: string, icon: string, onClick: () => void): void => {
    const button = document.createElement('button');
    button.className = 'act ' + cls;
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = icon;
    button.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    actions.appendChild(button);
  };
  if (entry.type === 'dir') {
    addAct('new-file', 'New file in this folder', ICON.newFile, () => startCreate(entry.path, 'file'));
    addAct('new-dir', 'New folder in this folder', ICON.newDir, () => startCreate(entry.path, 'dir'));
  }
  addAct('rename', 'Rename', ICON.rename, () => {
    renaming = entry.path;
    renderTree();
  });
  addAct('delete', 'Delete', ICON.delete, () => void deleteEntry(entry.path, entry.type));
  li.appendChild(actions);

  // A folder toggles open/closed; a file opens in the editor.
  li.addEventListener('click', () => {
    if (entry.type === 'dir') {
      if (collapsedDirs.has(entry.path)) collapsedDirs.delete(entry.path);
      else collapsedDirs.add(entry.path);
      renderTree();
    } else {
      void openFile(entry.path);
    }
  });
  return li;
}

/** The inline "new file/folder" input row shown inside the target folder. */
function makeCreateRow(depth: number): HTMLLIElement {
  const li = document.createElement('li');
  li.className = 'row-item creating';
  li.style.paddingLeft = 4 + depth * 14 + 'px';

  const icon = document.createElement('span');
  icon.className = 'ftype';
  icon.textContent = creating?.kind === 'dir' ? '📁' : '📄';
  li.appendChild(icon);

  const input = document.createElement('input');
  input.className = 'tree-input';
  input.placeholder = creating?.kind === 'dir' ? 'new folder name' : 'new file name';
  input.spellcheck = false;
  li.appendChild(input);
  queueMicrotask(() => input.focus());
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      e.preventDefault();
      void commitCreate(input.value);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      creating = null;
      renderTree();
    }
  });
  input.addEventListener('blur', () => {
    if (creating) void commitCreate(input.value);
  });
  return li;
}

async function openFile(path: string): Promise<void> {
  if (dirty && activeFile) {
    await client.writeFile(activeFile, editorEl.value);
  }
  activeFile = path;
  const contents = await client.readFile(path);
  editorEl.value = contents;
  const { root } = projectById(activeProject);
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
  const { id: runId, done } = client.run(entry, { oneShot: awaitExit });
  runOwner.set(runId, activeProject);
  if (!awaitExit) {
    done.catch((err: unknown) => {
      writeTerminal(`[run failed] ${(err as Error).message}\n`, 'err');
      setStatus('error', 'err');
    });
    return;
  }
  try {
    await done;
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

/**
 * Run a one-shot build in a dedicated, throwaway runtime worker (M139).
 *
 * A build is the single heaviest thing the tab does: it compiles hundreds of
 * webpack modules, and V8 keeps that compiled module graph live long after the
 * build exits — ~25 MB that the *shared* worker would then carry for the rest of
 * the session. Running the build in its own worker and terminating it afterwards
 * returns that memory to the browser, leaving the shared worker (which hosts the
 * dev servers and the visible tree) at its ~10 MB baseline.
 *
 * The build worker restores the project from the store read-only and never
 * mirrors back; the page pulls its outputs (the project's `dist`, plus any new
 * files) and mounts them into the shared worker, which owns the visible tree.
 * If it cannot start, the build falls back to the shared worker so the step
 * always works.
 */
async function runBuildIsolated(entry: string, label: string, root: string): Promise<void> {
  await save();
  setStatus('running…', 'running');
  const started = performance.now();
  const owner = activeProject;
  // The build worker reads the store, so the current (possibly edited) tree has
  // to be durable before it starts — otherwise it builds a debounced old copy.
  await client.flush();

  const buildClient = new RuntimeClient({ name: 'web-node-build' });
  buildClient.on('stdout', (data) => writeTerminal(data, '', owner));
  buildClient.on('stderr', (data) => writeTerminal(data, 'err', owner));

  try {
    await buildClient.init();
  } catch (err) {
    buildClient.terminate();
    writeTerminal(`[isolated build unavailable: ${(err as Error).message} — using the shared worker]\n`, 'sys');
    await runProcess(entry, label, true);
    return;
  }

  writeTerminal(`\n$ ${label}\n`, 'sys');
  try {
    const { done } = buildClient.run(entry, { oneShot: true });
    await done;

    // Adopt the build's outputs so the shared worker's tree reflects them.
    const buildTree = await buildClient.tree();
    const outputs = selectBuildOutputs(buildTree, tree.map((e) => e.path), `${root}/dist`);
    if (outputs.length) {
      const files: Record<string, string> = {};
      for (const path of outputs) files[path] = await buildClient.readFile(path);
      await client.mount(files);
      tree = await readTree();
      renderTree();
    }

    const ms = (performance.now() - started).toFixed(0);
    if (!bootTiming.firstRunMs) bootTiming.firstRunMs = Math.round(performance.now());
    setStatus(`done in ${ms}ms`, 'ok');
    writeTerminal(`[exit 0 · ${ms}ms]\n`, 'sys');
  } catch (err) {
    writeTerminal(`[run failed] ${(err as Error).message}\n`, 'err');
    setStatus('error', 'err');
    throw err;
  } finally {
    // The whole point: the compiled module graph dies with the worker.
    buildClient.terminate();
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
const SCENARIOS: ScenarioDef[] = [];
/** The port each project's dev server (or the Node playground) listens on. */
const DEV_PORT: Record<string, number> = {};

/**
 * Wire a project into the step bar and the chip row.
 *
 * Called once per built-in at load, and once per custom project when the user
 * creates one (or when a stored one is restored), so a project is defined in a
 * single place regardless of where it came from. The step set depends on the
 * *template*, not the id: a `node` project runs its entry directly, a bundler
 * project gets a dev server and a build.
 */
function registerProject(project: DemoProject, label: string, blurp: string): void {
  const id = project.id;
  PROJECTS.set(id, project);
  STEPS[`${id}/install`] = { label: '↓ Install deps', needs: 'none', exec: () => installDeps(project) };
  let steps: string[];
  if (project.template === 'node') {
    STEPS[`${id}/run`] = {
      label: '▶ Run',
      needs: 'deps',
      long: true,
      exec: () => runProcess(`${project.root}/index.js`, `node ${project.root}/index.js`, false),
    };
    steps = [`${id}/install`, `${id}/run`];
  } else if (project.template === 'uni') {
    // uni H5 can both serve a dev server and emit a static site; a mini-program
    // target emits WeChat's wxml/wxss, which nothing in a browser can run, so
    // only the H5 path is offered.
    STEPS[`${id}/dev`] = {
      label: '▶ Run dev',
      needs: 'deps',
      long: true,
      exec: () => runProcess(`${project.root}/dev.mjs`, `node ${project.root}/dev.mjs`, false),
    };
    STEPS[`${id}/build`] = {
      label: '⚙ Build H5',
      needs: 'deps',
      exec: () => runBuildIsolated(`${project.root}/build.mjs`, `node ${project.root}/build.mjs`, project.root),
    };
    steps = [`${id}/install`, `${id}/dev`, `${id}/build`];
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
      exec: () => runBuildIsolated(`${project.root}/build.mjs`, `node ${project.root}/build.mjs`, project.root),
    };
    steps = [`${id}/install`, `${id}/dev`, `${id}/build`];
  }
  DEV_PORT[id] = project.port;
  SCENARIOS.push({ id, label, blurp, steps });
}

for (const template of PROJECT_ORDER) {
  const project = DEMO_PROJECTS[template];
  registerProject(project, TEMPLATE_META[template].label, TEMPLATE_META[template].blurp);
}

interface ScenarioDef {
  id: ProjectId;
  label: string;
  blurp: string;
  steps: string[];
}

/** Step ids that are observably complete (deps on disk / a port listening). */
const completed = new Set<string>();

function projectDeps(id: ProjectId): boolean {
  const modules = projectById(id).root + '/node_modules';
  return tree.some((e) => e.type === 'dir' && e.path === modules);
}

function stepEnabled(id: string): boolean {
  return STEPS[id].needs === 'deps' ? projectDeps(activeProject) : true;
}

/** Fold observed runtime state into `completed`, so gates survive a reload. */
function syncDerived(): void {
  for (const id of PROJECTS.keys()) {
    const install = `${id}/install`;
    if (projectDeps(id)) completed.add(install);
    else completed.delete(install);
    const runStepId = projectById(id).template === 'node' ? `${id}/run` : `${id}/dev`;
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
    const project = projectById(scenario.id);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chip';
    btn.dataset.project = scenario.id;
    btn.title = scenario.blurp;
    const label = document.createElement('span');
    label.textContent = scenario.label;
    btn.appendChild(label);
    if (scenario.id === activeProject) btn.classList.add('active');
    btn.addEventListener('click', () => void selectProject(scenario.id));
    // A project the user created gets a small × to remove it. Removing is a
    // context switch too, so it is blocked while a step is running.
    if (project.custom) {
      const x = document.createElement('span');
      x.className = 'chip-x';
      x.textContent = '×';
      x.title = 'Remove this project';
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        void removeProject(scenario.id);
      });
      btn.appendChild(x);
    }
    projectChipsEl.appendChild(btn);
  }
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'chip chip-add';
  add.id = 'new-project';
  add.textContent = '+ New project';
  add.title = 'Scaffold a new project from a built-in template';
  add.addEventListener('click', () => void createProject());
  projectChipsEl.appendChild(add);
}

/**
 * Scaffold a new project from a template and switch to it.
 *
 * The dialog is plain prompts (the app has no modal system): a name, then a
 * template. The name becomes both the id (slugged) and the `/project/<id>`
 * directory; the template's files are copied there by the runtime, so the new
 * project is a working Vite/webpack/rspack/Node setup from the first step.
 */
async function createProject(): Promise<void> {
  if (busy) return;
  const name = window.prompt('New project name:', 'my-app');
  if (name === null) return;
  const id = projectIdFromName(name);
  if (PROJECTS.has(id)) {
    window.alert(`A project named “${id}” already exists.`);
    return;
  }
  const template = (window.prompt('Template? One of: node | vite | webpack | rspack | uni', 'vite') || '')
    .trim()
    .toLowerCase();
  if (!(template in DEMO_PROJECTS)) {
    window.alert(`Unknown template “${template}”. Pick node, vite, webpack, rspack or uni.`);
    return;
  }
  const taken = [...PROJECTS.values()].map((p) => p.port);
  const port = nextProjectPort(taken);
  const project: DemoProject = {
    id,
    template: template as TemplateId,
    root: `/project/${id}`,
    entry: entryFor(template as TemplateId, `/project/${id}`),
    port,
    custom: true,
  };
  busy = true;
  setStatus('creating project…', 'running');
  try {
    tree = await client.scaffold(template, project.root, port);
  } catch (err) {
    writeTerminal(`\n[create project failed] ${(err as Error).message}\n`, 'err');
    setStatus('error', 'err');
    busy = false;
    renderSteps();
    return;
  }
  busy = false;
  registerProject(project, `📁 ${name.trim() || id}`, `${template} project · ${project.root} · port ${port}`);
  saveStoredProjects([...loadStoredProjects(), { id, template: template as TemplateId, port, label: name.trim() || id }]);
  renderChips();
  renderTree();
  await selectProject(id);
  writeTerminal(
    `\n[created project] ${project.root} from “${template}” template — pick a step above\n`,
    'ok',
    id,
  );
  syncDerived();
  renderSteps();
}

/** Remove a project the user created (its files stay on disk until reset). */
async function removeProject(id: ProjectId): Promise<void> {
  if (busy) return;
  const project = projectById(id);
  if (!project.custom) return;
  if (!window.confirm(`Remove “${id}” from the list? Its “${project.root}” files stay in the workspace.`)) return;
  PROJECTS.delete(id);
  const index = SCENARIOS.findIndex((s) => s.id === id);
  if (index >= 0) SCENARIOS.splice(index, 1);
  saveStoredProjects(loadStoredProjects().filter((p) => p.id !== id));
  if (activeProject === id) {
    activeProject = 'node';
    clearOutput();
    clearPreview();
    await openFile(DEMO_PROJECTS.node.entry);
    await refreshPorts();
  }
  renderChips();
  renderTree();
  syncDerived();
  renderSteps();
}

/** Register the projects the user created in a previous session. */
function restoreStoredProjects(): void {
  for (const stored of loadStoredProjects()) {
    if (PROJECTS.has(stored.id)) continue;
    const project = projectFromStored(stored);
    registerProject(project, `📁 ${stored.label ?? stored.id}`, `${stored.template} project · ${project.root} · port ${project.port}`);
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
  if (busy || id === activeProject) return;
  const previous = activeProject;
  activeProject = id;
  // A project switch is a context switch: the previous project's output, its
  // live preview and its file bodies all belong to a container we are leaving.
  clearOutput();
  clearPreview();
  // Free the previous project's memory in the background. Eviction flushes
  // first (so nothing written but not yet durable is lost), and that flush can
  // take a moment over a large `node_modules` — the switch must not wait on it.
  void client.evict(projectById(previous).root).catch(() => undefined);
  renderChips();
  renderTree();
  renderSteps();
  await openFile(projectById(id).entry);
}

/** Empty the output pane (a project switch must not carry the old logs over). */
function clearOutput(): void {
  terminalEl.innerHTML = '';
  setStatus('');
}

/** Detach the preview: no port selected, no old document left framed. */
function clearPreview(): void {
  ports = [];
  portSelect.innerHTML = '';
  portSelect.disabled = true;
  previewFrame.src = 'about:blank';
  previewFrame.classList.add('hidden');
  previewEmpty.classList.remove('hidden');
  openTab.href = '#';
  hmrRelay.follow(null);
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
    // A build (or a dev server's first compile) writes new files — dist/, a
    // bundle, assets — behind the UI's back, so re-read the tree to show them.
    tree = await readTree();
    renderTree();
    await refreshPorts();
    syncDerived();
    renderSteps();
  }
}

// --- preview ---------------------------------------------------------------

async function refreshPorts(): Promise<void> {
  const described = await client.describe();
  // A project owns exactly one port, and a dev server from a project we have
  // left keeps listening (the runtime cannot stop a program), so scope the
  // preview to the active project's port — otherwise a switch would re-attach
  // the previous project's server and show its preview again.
  const expected = projectById(activeProject).port;
  ports = described.ports.filter((port) => port === expected);
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
        const expected = projectById(activeProject).port;
        if (next.filter((port) => port === expected).join(',') === ports.join(',')) return;
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

client.on('stdout', (data, runId) => writeTerminal(data, '', ownerOf(runId)));
client.on('stderr', (data, runId) => writeTerminal(data, 'err', ownerOf(runId)));
client.on('exit', (code, runId) => {
  if (code !== 0) writeTerminal(`[exit code ${code}]\n`, 'err', ownerOf(runId));
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
    tree = await readTree();
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
  await client.reset();
  tree = await readTree();
  renderTree();
  // Reset restores the built-in demo sources only, so a custom project's entry
  // may no longer exist — fall back to the Node playground rather than raise.
  const entry = projectById(activeProject).entry;
  await openFile(tree.some((e) => e.path === entry) ? entry : DEMO_PROJECTS.node.entry).catch(
    () => undefined,
  );
  await refreshPorts();
  syncDerived();
  renderSteps();
  writeTerminal('\n[projects reset to demo files]\n', 'sys');
});

newFileBtn.addEventListener('click', () => startCreate(projectById(activeProject).root, 'file'));
newFolderBtn.addEventListener('click', () => startCreate(projectById(activeProject).root, 'dir'));
addDepBtn.addEventListener('click', () => void addDependency());

/** Begin naming a new file/folder inside `parent` (inline input in the tree). */
function startCreate(parent: string, kind: 'file' | 'dir'): void {
  creating = { parent, kind };
  renaming = null;
  collapsedDirs.delete(parent);
  renderTree();
}

/**
 * Commit the inline "new file/folder" input. The name is a single segment (the
 * folder is the row it was opened from), so paths stay valid by construction;
 * an empty name simply cancels.
 */
async function commitCreate(raw: string): Promise<void> {
  const state = creating;
  creating = null;
  if (!state) return;
  const name = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!name) {
    renderTree();
    return;
  }
  const abs = joinPath(state.parent, name);
  try {
    if (state.kind === 'dir') {
      tree = await client.mkdir(abs);
      writeTerminal('\n[created folder] ' + abs + '\n', 'sys');
    } else {
      tree = await client.writeFile(abs, '');
      writeTerminal('\n[created file] ' + abs + '\n', 'sys');
    }
  } catch (err) {
    writeTerminal('\n[create failed] ' + (err as Error).message + '\n', 'err');
    renderTree();
    return;
  }
  renderTree();
  if (state.kind === 'file') await openFile(abs);
}

/** Rename `renaming` to a single-segment name in the same folder. */
async function commitRename(raw: string): Promise<void> {
  const from = renaming;
  renaming = null;
  if (!from) return;
  const name = raw.trim().replace(/^\/+|\/+$/g, '');
  if (!name || name.includes('/')) {
    renderTree();
    return;
  }
  const to = joinPath(parentDir(from), name);
  if (to === from) {
    renderTree();
    return;
  }
  try {
    tree = await client.rename(from, to);
    writeTerminal('\n[renamed] ' + from + ' -> ' + to + '\n', 'sys');
  } catch (err) {
    writeTerminal('\n[rename failed] ' + (err as Error).message + '\n', 'err');
    renderTree();
    return;
  }
  // Keep the editor and the active-row marker pointing at the moved file, and
  // follow a folder rename through any file that lived under it.
  if (activeFile === from) activeFile = to;
  else if (activeFile.startsWith(from + '/')) activeFile = to + activeFile.slice(from.length);
  renderTree();
}

/**
 * A small in-app confirmation dialog, used in place of `window.confirm`.
 *
 * The native dialog is unstyled, blocks the whole tab, and cannot show our
 * colours or say *which* file is about to go. This one matches the app, traps
 * Enter/Escape, and resolves to a boolean so the caller reads the same either
 * way.
 */
function confirmDialog(opts: {
  title: string;
  message: string;
  confirmLabel: string;
  danger?: boolean;
}): Promise<boolean> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');

    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = opts.title;
    const message = document.createElement('div');
    message.className = 'modal-message';
    message.textContent = opts.message;

    const row = document.createElement('div');
    row.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'modal-cancel';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.className = 'modal-confirm' + (opts.danger ? ' danger' : '');
    confirm.textContent = opts.confirmLabel;
    row.append(cancel, confirm);
    modal.append(title, message, row);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    queueMicrotask(() => confirm.focus());

    const close = (value: boolean): void => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(value);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        close(true);
      }
    };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => close(false));
    confirm.addEventListener('click', () => close(true));
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(false);
    });
  });
}

/** A single-line text prompt (the app has no modal system; mirrors confirmDialog). */
function promptDialog(opts: {
  title: string;
  message: string;
  placeholder?: string;
  confirmLabel: string;
}): Promise<string | null> {
  return new Promise((resolve) => {
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    const title = document.createElement('div');
    title.className = 'modal-title';
    title.textContent = opts.title;
    const message = document.createElement('div');
    message.className = 'modal-message';
    message.textContent = opts.message;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'modal-input';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    const row = document.createElement('div');
    row.className = 'modal-actions';
    const cancel = document.createElement('button');
    cancel.className = 'modal-cancel';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.className = 'modal-confirm';
    confirm.textContent = opts.confirmLabel;
    row.append(cancel, confirm);
    modal.append(title, message, input, row);
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    queueMicrotask(() => input.focus());
    const close = (value: string | null): void => {
      document.removeEventListener('keydown', onKey, true);
      backdrop.remove();
      resolve(value);
    };
    const submit = (): void => close(input.value.trim() === '' ? null : input.value.trim());
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        close(null);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    };
    document.addEventListener('keydown', onKey, true);
    cancel.addEventListener('click', () => close(null));
    confirm.addEventListener('click', submit);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close(null);
    });
  });
}

/**
 * `npm install <spec>` for the active project: prompt for one or more specs
 * (space- or comma-separated), install them on top of the current tree and
 * write the resolved versions back into package.json.
 */
async function addDependency(): Promise<void> {
  const project = projectById(activeProject);
  const raw = await promptDialog({
    title: 'Add dependency',
    message: `Install into ${project.root} and save to package.json (e.g. lodash, left-pad@1.3.0, vue@^3)`,
    placeholder: 'lodash',
    confirmLabel: 'Install',
  });
  if (!raw) return;
  const specs = raw.split(/[\s,]+/).filter(Boolean);
  if (specs.length === 0) return;

  await save();
  setStatus('installing…', 'running');
  writeTerminal(`\n$ npm install ${specs.join(' ')}\n`, 'sys');
  const started = performance.now();
  try {
    const result = await client.installDeps({ cwd: project.root, add: specs });
    const ms = (performance.now() - started).toFixed(0);
    for (const warning of result.warnings) writeTerminal(`[npm] ${warning}\n`, 'err');
    const addedNames = new Set((result.added ?? []).map((a) => a.name));
    for (const pkg of result.installed) {
      if (addedNames.has(pkg.name)) continue;
      writeTerminal(`  ${pkg.name}@${pkg.version}\n`, 'sys');
    }
    for (const a of result.added ?? []) {
      writeTerminal(
        a.savedAs
          ? `+ ${a.name}@${a.version}  (saved to package.json: "${a.savedAs}")\n`
          : `+ ${a.name}@${a.version}\n`,
        'ok',
      );
    }
    if (result.lifecycle?.length) {
      writeTerminal(`[lifecycle] ran ${result.lifecycle.join(', ')}\n`, 'ok');
    }
    writeTerminal(`[added ${specs.length} spec(s), ${result.packages} package(s) present in ${ms}ms]\n`, 'ok');
    setStatus(`added ${specs.length}`, 'ok');
    tree = await readTree();
    renderTree();
    if (tree.some((e) => e.path === project.entry)) await openFile(project.entry).catch(() => undefined);
  } catch (err) {
    writeTerminal(`[npm install failed] ${(err as Error).message}\n`, 'err');
    setStatus('error', 'err');
  }
}

/** Delete a file, or a folder and everything under it, after a confirmation. */
async function deleteEntry(path: string, kind: 'file' | 'dir'): Promise<void> {
  const what = kind === 'dir' ? 'folder' : 'file';
  const name = baseName(path);
  const ok = await confirmDialog({
    title: 'Delete ' + what,
    message:
      kind === 'dir'
        ? 'Delete "' + name + '" and everything inside it? This cannot be undone.'
        : 'Delete "' + name + '"? This cannot be undone.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    tree = await client.remove(path);
    writeTerminal('\n[deleted ' + what + '] ' + path + '\n', 'sys');
  } catch (err) {
    writeTerminal('\n[delete failed] ' + (err as Error).message + '\n', 'err');
    return;
  }
  if (activeFile === path || activeFile.startsWith(path + '/')) {
    activeFile = '';
    editorEl.value = '';
    activeFileEl.textContent = '—';
    dirty = false;
    dirtyEl.textContent = '';
  }
  renderTree();
}

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
  // Restore the user's custom projects before the first chip render, so they
  // appear alongside the built-ins from the very first paint.
  restoreStoredProjects();
  renderChips();
  renderTree();
  renderSteps();
  const bridged = await client.installServiceWorkerBridge();

  // A static host cannot send COOP/COEP, so the service worker adds them to the
  // app-shell document and its subresources (see `public/sw.js`). A worker
  // only shapes responses *after* it controls the page, so the first load of a
  // fresh registration is not isolated: the service worker registers, then
  // claims this client, but the document it is showing already came from the
  // network. Without isolation the runtime worker cannot allocate the
  // SharedArrayBuffer the wasm toolchain needs, and rspack's build wedges on the
  // failed transfer of that shared memory (page or worker realm alike).
  //
  // So reload until the document is actually isolated. A single reload is not
  // enough: `controller` can become non-null via `clients.claim()` *without* the
  // current navigation having been served by the worker, so one reload can still
  // land unisolated. Cap the attempts so a host that can never isolate (e.g. the
  // worker cannot register) degrades to "no isolation" rather than a reload
  // loop.
  //
  // The wait before reloading must be on the *latest* worker being active and
  // controlling — not merely on `controller` becoming non-null. On a CDN a new
  // build ships a new `sw.js`; when it is still installing, `ready` already
  // resolves against the *previous* active worker and `controller` is non-null
  // (pointing at that stale worker). Reloading then is served by the stale
  // worker, which predates the isolation headers, so the page stays unisolated
  // and several instant retries can burn out before the new worker takes over.
  // So require `registration.installing`/`waiting` to be cleared as well, and
  // give the browser a tick to commit the new controller.
  if (bridged && !window.crossOriginIsolated) {
    const tries = Number(sessionStorage.getItem(COI_RELOAD_FLAG) ?? '0');
    if (tries < 6) {
      sessionStorage.setItem(COI_RELOAD_FLAG, String(tries + 1));
      bootEl.textContent = 'enabling cross-origin isolation…';
      const deadline = Date.now() + 8000;
      try {
        const reg = await navigator.serviceWorker.getRegistration();
        // Force a fresh update check. The `register()` above can be served from
        // the HTTP cache (browsers throttle SW update checks), so a newly
        // deployed `sw.js` might not install on its own — and then we would keep
        // reloading into the stale worker that never had the isolation headers.
        // `update()` bypasses the HTTP cache.
        if (reg?.active) {
          try {
            await reg.update();
          } catch {
            // Network hiccup; the wait below still gives any pending install a
            // chance to finish before we reload.
          }
        }
        while (Date.now() < deadline) {
          const settled =
            !!reg && !reg.installing && !reg.waiting && !!reg.active && !!navigator.serviceWorker.controller;
          if (settled) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
      } catch {
        // No registration to inspect; fall through and reload anyway (bounded).
      }
      // A brief settle so the browser commits the new controller before the
      // navigation, otherwise the reload can still be served by the old one.
      await new Promise((resolve) => setTimeout(resolve, 300));
      location.reload();
      return;
    }
  } else if (bridged) {
    // Isolated: clear the counter so a later fresh registration can isolate again.
    sessionStorage.removeItem(COI_RELOAD_FLAG);
  }

  installHmrRelay();
  startPortWatch();
  await client.init();
  // The ready payload populated the VFS; re-read the tree so ordering is
  // deterministic and the gates see any restored `node_modules`.
  tree = await readTree();
  renderTree();
  await openFile(projectById(activeProject).entry);
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
