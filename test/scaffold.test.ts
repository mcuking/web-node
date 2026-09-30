import { describe, expect, it } from 'vitest';
import {
  entryFor,
  loadStoredProjects,
  nextProjectPort,
  projectFromStored,
  projectIdFromName,
  saveStoredProjects,
} from '../src/projects';
import { scaffoldFiles } from '../src/worker/scaffold';

/**
 * Creating a project (M134).
 *
 * A new project is a *copy of a template's sources* into `/project/<id>`, with
 * the template's directory prefix rewritten. The copy must be complete for that
 * template and must not leak another project's files (each template is a
 * self-contained project with its own `package.json`).
 */
describe('scaffoldFiles', () => {
  const files = {
    '/project/vite/package.json': '{"name":"vite"}',
    '/project/vite/index.html': '<div id="app"></div>',
    '/project/vite/src/App.vue': '<template><h1>hi</h1></template>',
    '/project/vite/dev.mjs': "const ROOT = '/project/vite';\nconst PORT = 5173;\nconsole.log('/project/vite/src');",
    '/project/webpack/package.json': '{"name":"webpack"}',
    '/project/webpack/src/index.js': 'console.log(1)',
    '/project/node/index.js': 'console.log("node")',
    '/project/node/tool.sh': 'ls /project/node_modules',
  };

  it('rewrites the template prefix onto the target root', () => {
    const out = scaffoldFiles('vite', '/project/my-app', undefined, files);
    expect(Object.keys(out).sort()).toEqual([
      '/project/my-app/dev.mjs',
      '/project/my-app/index.html',
      '/project/my-app/package.json',
      '/project/my-app/src/App.vue',
    ]);
    expect(out['/project/my-app/src/App.vue']).toBe('<template><h1>hi</h1></template>');
  });

  it('relocates the hard-coded root literal, but not a look-alike path', () => {
    const out = scaffoldFiles('vite', '/project/my-app', undefined, files);
    expect(out['/project/my-app/dev.mjs']).toBe("const ROOT = '/project/my-app';\nconst PORT = 5173;\nconsole.log('/project/my-app/src');");
    // `/project/node_modules` merely starts with the template name `node`.
    const node = scaffoldFiles('node', '/project/lab', undefined, files);
    expect(node['/project/lab/tool.sh']).toBe('ls /project/node_modules');
  });

  it('rewrites the dev port onto the project’s own port', () => {
    const out = scaffoldFiles('vite', '/project/my-app', 5180, files);
    expect(out['/project/my-app/dev.mjs']).toContain('const PORT = 5180;');
    // Without an explicit port the template default is kept.
    const same = scaffoldFiles('vite', '/project/my-app', undefined, files);
    expect(same['/project/my-app/dev.mjs']).toContain('const PORT = 5173;');
  });

  it('copies only the chosen template, never another project', () => {
    const out = scaffoldFiles('webpack', '/project/other', undefined, files);
    expect(Object.keys(out).sort()).toEqual(['/project/other/package.json', '/project/other/src/index.js']);
    expect(Object.keys(out).some((p) => p.includes('/node/'))).toBe(false);
  });
  it('tolerates a trailing slash on the target and returns nothing for an unknown template', () => {
    const out = scaffoldFiles('vite', '/project/with-slash/', undefined, files);
    expect(out['/project/with-slash/index.html']).toBeDefined();
    expect(scaffoldFiles('nope', '/project/x', undefined, files)).toEqual({});
  });
});

/**
 * The pure helpers the UI uses to create, list and remove projects.
 */
describe('project helpers', () => {
  it('slugs a display name into a filesystem-safe id', () => {
    expect(projectIdFromName('My App!')).toBe('my-app');
    expect(projectIdFromName('  Vite Demo 2  ')).toBe('vite-demo-2');
    expect(projectIdFromName('###')).toBe('project');
  });

  it('offers the first free port from 5180 up', () => {
    expect(nextProjectPort([])).toBe(5180);
    expect(nextProjectPort([5173, 5180, 5181])).toBe(5182);
  });

  it('derives the entry the same way the built-in project does', () => {
    expect(entryFor('vite', '/project/a')).toBe('/project/a/src/App.vue');
    expect(entryFor('node', '/project/b')).toBe('/project/b/index.js');
    expect(entryFor('rspack', '/project/c')).toBe('/project/c/src/main.mjs');
  });

  it('round-trips a stored project through projectFromStored', () => {
    const p = projectFromStored({ id: 'my-app', template: 'webpack', port: 5180, label: 'My App' });
    expect(p).toMatchObject({
      id: 'my-app',
      template: 'webpack',
      root: '/project/my-app',
      entry: '/project/my-app/src/index.js',
      port: 5180,
      custom: true,
    });
  });

  it('persists and restores the project list', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    expect(loadStoredProjects()).toEqual([]);
    saveStoredProjects([{ id: 'a', template: 'vite', port: 5180 }]);
    expect(loadStoredProjects()).toEqual([{ id: 'a', template: 'vite', port: 5180 }]);
    store.set('web-node:projects', 'not json');
    expect(loadStoredProjects()).toEqual([]);
    store.set('web-node:projects', '[{"id":1}]');
    expect(loadStoredProjects()).toEqual([]);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
