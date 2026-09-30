/**
 * The demo projects, as seen by the UI.
 *
 * Kept separate from `demo-project.ts` on purpose: the UI only needs *where*
 * each project lives, not the file contents, so importing this module must not
 * drag the (large) embedded sources into the page bundle.
 */

/** The four built-in templates a project can be scaffolded from. */
export type TemplateId = 'vite' | 'webpack' | 'rspack' | 'node';

/**
 * A project id. The four built-ins use their template name; a project the user
 * creates gets a slug id of its own, so the type is open rather than a union.
 */
export type ProjectId = string;

export interface DemoProject {
  id: ProjectId;
  /** The template this project was scaffolded from. */
  template: TemplateId;
  /** Absolute VFS directory that holds the project. */
  root: string;
  /** File opened in the editor when the project is selected. */
  entry: string;
  /**
   * The one port the project's server binds. The runtime can start a program
   * but not stop it, so a server from a project we have left keeps listening;
   * scoping the preview to this port is what stops a switch re-attaching it.
   */
  port: number;
  /** True for a project the user created (it lives only in their browser). */
  custom?: boolean;
}

/** The built-in demo projects, keyed by template id (matches the scenario chips). */
export const DEMO_PROJECTS: Record<TemplateId, DemoProject> = {
  vite: { id: 'vite', template: 'vite', root: '/project/vite', entry: '/project/vite/src/App.vue', port: 5173 },
  webpack: { id: 'webpack', template: 'webpack', root: '/project/webpack', entry: '/project/webpack/src/index.js', port: 5174 },
  rspack: { id: 'rspack', template: 'rspack', root: '/project/rspack', entry: '/project/rspack/src/main.mjs', port: 5175 },
  node: { id: 'node', template: 'node', root: '/project/node', entry: '/project/node/index.js', port: 3000 },
};

/** Every built-in project, in the order the UI shows them. */
export const PROJECT_ORDER: TemplateId[] = ['node', 'vite', 'webpack', 'rspack'];

/** Template metadata: the chip label, the hover blurb, and the editor entry. */
export const TEMPLATE_META: Record<TemplateId, { label: string; blurp: string }> = {
  vite: { label: '⚡ Vite', blurp: 'Vue 3 single-file component — Vite dev server + build, in the tab' },
  webpack: { label: '📦 Webpack', blurp: 'React app — webpack watches and bundles; the preview full-reloads' },
  rspack: { label: '🔷 Rspack', blurp: 'React app — Rust bundler via wasm32-wasi on a real Worker thread pool' },
  node: { label: '🟢 Node.js', blurp: 'the full runtime — fs, http, crypto, streams, workers, child processes' },
};

/** The file the editor opens for a project scaffolded from `template` at `root`. */
export function entryFor(template: TemplateId, root: string): string {
  const builtin = DEMO_PROJECTS[template];
  const suffix = builtin.entry.slice(builtin.root.length);
  return root + suffix;
}

/** A user-created project as it is persisted (everything but the derived parts). */
export interface StoredProject {
  id: string;
  template: TemplateId;
  port: number;
  /** Optional display label; falls back to the id. */
  label?: string;
}

const STORE_KEY = 'web-node:projects';

/**
 * The user's custom projects, read from `localStorage`.
 *
 * They are deliberately *not* in the OPFS snapshot: the snapshot holds file
 * bytes, while this is UI state (which projects exist, their labels and ports).
 * Keeping it in `localStorage` means the chip survives a reload even before the
 * project's files are restored from OPFS.
 */
export function loadStoredProjects(): StoredProject[] {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((p): p is StoredProject => {
      if (!p || typeof p !== 'object') return false;
      const o = p as Record<string, unknown>;
      return typeof o.id === 'string' && typeof o.port === 'number' && typeof o.template === 'string';
    });
  } catch {
    return [];
  }
}

/** Persist the custom-project list (called after create/remove). */
export function saveStoredProjects(list: StoredProject[]): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(list));
  } catch {
    // Storage disabled/full — the project still works for this session.
  }
}

/** Turn a stored project into a live `DemoProject`. */
export function projectFromStored(s: StoredProject): DemoProject {
  const root = `/project/${s.id}`;
  return {
    id: s.id,
    template: s.template,
    root,
    entry: entryFor(s.template, root),
    port: s.port,
    custom: true,
  };
}

/** A filesystem-safe id from a project name (lowercase, dashes). */
export function projectIdFromName(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/^[-.]+|[-.]+$/g, '') || 'project'
  );
}

/** The first port to offer a new project: 5180, 5181, … avoiding taken ports. */
export function nextProjectPort(taken: number[]): number {
  let port = 5180;
  while (taken.includes(port)) port++;
  return port;
}
