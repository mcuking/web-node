import { describe, expect, it } from 'vitest';
import {
  collectVendoredSources,
  splitVendoredSources,
  vendoredBundleText,
  vendoredCoreText,
  vendoredRestText,
} from '../plugins/vendored-source';
import { VENDORED } from '../src/node-runtime/vendored';

/**
 * The vendored sources reach the runtime two different ways (M107):
 *
 *  - tests (Node) use the eager `?raw` glob in `vendored-sources.ts`
 *  - the browser fetches the emitted `vendored-sources.txt` bundle and calls
 *    `installVendored()`
 *
 * Both must describe the *same* files with the *same* text, or browser runs
 * would quietly diverge from everything verified against real Node under vitest.
 * This test pins that equivalence.
 */
describe('vendored bundle matches the eager glob', () => {
  const emitted = collectVendoredSources();

  it('covers exactly the same files', () => {
    expect(Object.keys(emitted).sort()).toEqual(Object.keys(VENDORED).sort());
    expect(Object.keys(emitted).length).toBeGreaterThan(150);
  });

  it('carries byte-identical source for every file', () => {
    for (const [rel, src] of Object.entries(emitted)) {
      expect(VENDORED[rel], rel).toBe(src);
    }
  });

  it('serialises to a JSON object', () => {
    const text = vendoredBundleText();
    const parsed = JSON.parse(text) as Record<string, string>;
    expect(Object.keys(parsed).length).toBe(Object.keys(emitted).length);
  });

  it('ships the same bytes across the two tiers (M126)', () => {
    const { core, rest } = splitVendoredSources();
    const fromCore = JSON.parse(vendoredCoreText()) as Record<string, string>;
    const fromRest = JSON.parse(vendoredRestText()) as Record<string, string>;
    expect({ ...fromCore, ...fromRest }).toEqual(emitted);
    // and both agree with the eager glob the tests read from
    for (const [rel, src] of Object.entries({ ...fromCore, ...fromRest })) {
      expect(VENDORED[rel], rel).toBe(src);
      expect(core[rel] ?? rest[rel]).toBe(src);
    }
  });
});
