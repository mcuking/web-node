import { DEMO_FILES } from '../demo-project';
import { DEMO_PROJECTS, type TemplateId } from '../projects';

/**
 * The files a new project should start with, keyed by their destination path.
 *
 * Copies one built-in template's *sources* (from the embedded `DEMO_FILES`)
 * into a new project directory, rewriting the `/project/<template>/` prefix to
 * `target`. Only the demo sources are copied — never `node_modules` — because
 * the new project installs its own dependencies as step 1.
 *
 * The demo sources are self-contained (relative imports throughout) with two
 * exceptions, both of which name something absolute and so must be relocated:
 *
 *  - each script names its own root as a literal (`const ROOT =
 *    '/project/vite'`) and derives everything else from it, because a script run
 *    by the runtime has no reliable `import.meta.url`/`__dirname`;
 *  - each dev script names its listen port as a literal (`const PORT = 5173`).
 *
 * Both are rewritten. The port matters because the runtime can start a server
 * but never stop it, so a second project on the same template must not bind the
 * same port as the first — each project gets its own.
 */
export function scaffoldFiles(
  template: TemplateId | string,
  target: string,
  port?: number,
  files: Record<string, string> = DEMO_FILES,
): Record<string, string> {
  const prefix = `/project/${template}/`;
  const root = target.replace(/\/+$/, '');
  const escaped = template.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rootRef = new RegExp(`/project/${escaped}(?![A-Za-z0-9._-])`, 'g');
  const fromPort = (DEMO_PROJECTS as Record<string, { port: number } | undefined>)[template]?.port;
  const portRef = fromPort != null && port != null && port !== fromPort ? new RegExp(`\\b${fromPort}\\b`, 'g') : null;
  const out: Record<string, string> = {};
  for (const [path, contents] of Object.entries(files)) {
    if (!path.startsWith(prefix)) continue;
    let next = contents.replace(rootRef, root);
    if (portRef) next = next.replace(portRef, String(port));
    out[root + '/' + path.slice(prefix.length)] = next;
  }
  return out;
}
