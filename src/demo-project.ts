import { NODE_FILES } from './demo/node-project';
import { VITE_PROJECT_FILES } from './demo/vite-project';
import { WEBPACK_PROJECT_FILES } from './demo/webpack-project';
import { RSPACK_PROJECT_FILES } from './demo/rspack-project';
import { UNI_PROJECT_FILES } from './demo/uni-project';

/**
 * Every file mounted into the VFS on first boot, across all five demo projects
 * (`/project/vite`, `/project/webpack`, `/project/rspack`, `/project/node`,
 * `/project/uni`). Each project owns its own directory and its own
 * `node_modules`.
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
  ...UNI_PROJECT_FILES,
};

/**
 * Bumped whenever a demo source file changes *in place* (not merely a new file
 * added — boot already fills missing paths on its own).
 *
 * A returning visitor restores their previous VFS from OPFS, and boot only adds
 * paths that are absent, so a rewritten demo file would otherwise never reach
 * them: they would open the tab and still see last release's `src/index.js`. A
 * change to this value tells boot the demo sources on disk are stale and should
 * be rewritten once (files the user created are untouched — boot writes the
 * embedded demo paths only).
 */
export const DEMO_VERSION = 6;
