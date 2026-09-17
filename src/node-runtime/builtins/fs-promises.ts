import type { BuiltinSpec } from './types';

/**
 * `fs/promises` — Node exposes this as its own module id, and a lot of real
 * tooling imports it directly (`require('node:fs/promises')`). We simply hand
 * back the promise view already built inside the `fs` builtin, so there is a
 * single implementation.
 */
export const fsPromisesSpec: BuiltinSpec = {
  id: 'fs/promises',
  aliases: ['node:fs/promises'],
  origin: 'web-node',
  deps: ['fs'],
  init: (ctx) => {
    const fs = ctx.require('fs') as { promises?: Record<string, unknown> };
    if (!fs.promises) {
      throw new Error('web-node: fs builtin did not expose a promises API');
    }
    return fs.promises;
  },
};
