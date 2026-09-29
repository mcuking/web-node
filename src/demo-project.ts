import { NODE_FILES } from './demo/node-project';
import { VITE_PROJECT_FILES } from './demo/vite-project';
import { WEBPACK_PROJECT_FILES } from './demo/webpack-project';
import { RSPACK_PROJECT_FILES } from './demo/rspack-project';

/**
 * Every file mounted into the VFS on first boot, across all four demo projects
 * (`/project/vite`, `/project/webpack`, `/project/rspack`, `/project/node`).
 * Each project owns its own directory and its own `node_modules`.
 *
 * Where each project lives — and which file the editor opens — is described in
 * `projects.ts`, which the UI imports instead of this module so the page bundle
 * does not have to carry the embedded sources.
 */
export const DEMO_FILES: Record<string, string> = {
  ...NODE_FILES,
  ...VITE_PROJECT_FILES,
  ...WEBPACK_PROJECT_FILES,
  ...RSPACK_PROJECT_FILES,
};
