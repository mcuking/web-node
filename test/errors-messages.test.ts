import { describe, expect, it } from 'vitest';
import { ERROR_CODES } from '../src/node-runtime/builtins/internal-shims';
import fixture from './fixtures/errors-messages.json';

/**
 * Differential test for the *text* of `internal/errors` messages.
 *
 * `tools/errors-messages-oracle.mjs` (run under a real Node with
 * `--expose-internals`) records the raw template of every code whose message is
 * a placeholder-free plain string. The table is hand-maintained, so sibling
 * codes are easy to transpose — e.g. `ERR_FS_CP_DIR_TO_NON_DIR` once carried
 * `ERR_FS_CP_NON_DIR_TO_DIR`'s wording. This pins every recorded template.
 *
 * Regenerate the fixture with:
 *
 *   node --expose-internals tools/errors-messages-oracle.mjs
 */

const messages = fixture as Record<string, string>;

describe('internal/errors message text (differential vs Node v26.9.0)', () => {
  it('covers a non-trivial number of codes', () => {
    expect(Object.keys(messages).length).toBeGreaterThan(150);
  });

  it('matches Node word for word (for the codes this runtime defines)', () => {
    const drift: string[] = [];
    for (const [code, expected] of Object.entries(messages)) {
      // Codes for modules this runtime does not carry (http2, tls, inspector,
      // napi, …) are absent here; `errors-table.test.ts` is what guarantees every
      // *referenced* code exists.
      if (!(code in (ERROR_CODES as Record<string, string>))) continue;
      const actual = (ERROR_CODES as Record<string, string>)[code];
      if (actual !== expected) drift.push(`${code}\n   node: ${JSON.stringify(expected)}\n   shim: ${JSON.stringify(actual)}`);
    }
    expect(drift).toEqual([]);
  });
});
