/**
 * The demo projects, as seen by the UI.
 *
 * Kept separate from `demo-project.ts` on purpose: the UI only needs *where*
 * each project lives, not the file contents, so importing this module must not
 * drag the (large) embedded sources into the page bundle.
 */
export type ProjectId = 'vite' | 'webpack' | 'rspack' | 'node';

export interface DemoProject {
  id: ProjectId;
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
}

/** The demo projects, keyed by id (matches the scenario chips). */
export const DEMO_PROJECTS: Record<ProjectId, DemoProject> = {
  vite: { id: 'vite', root: '/project/vite', entry: '/project/vite/src/App.vue', port: 5173 },
  webpack: { id: 'webpack', root: '/project/webpack', entry: '/project/webpack/src/index.js', port: 5174 },
  rspack: { id: 'rspack', root: '/project/rspack', entry: '/project/rspack/src/main.mjs', port: 5175 },
  node: { id: 'node', root: '/project/node', entry: '/project/node/index.js', port: 3000 },
};

/** Every project, in the order the UI shows them. */
export const PROJECT_ORDER: ProjectId[] = ['node', 'vite', 'webpack', 'rspack'];
