import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `icu.getStringWidth` is the column-width measure `util.inspect`,
 * `console.table` and readline share. Node computes it in ICU
 * (`src/node_i18n.cc`); here it is a JS re-implementation over the same
 * East_Asian_Width ranges, Unicode property escapes and emoji rules. Every
 * expected number below was read off a real Node v26.9.0 first
 * (`node --expose-internals`, `internalBinding('icu').getStringWidth`).
 */
function boot() {
  const vfs = new MemoryVfs({ cwd: '/project' });
  vfs.mkdir('/project', { recursive: true });
  vfs.writeFile('/project/index.js', new TextEncoder().encode(''));
  const runtime = new NodeRuntime({
    vfs,
    argv: ['/project/index.js'],
    installGlobals: false,
    onStdout: () => {},
    onStderr: () => {},
  });
  const realm = runtime.realm as any;
  const icu = realm.internalBinding('icu') as {
    getStringWidth: (s: string, ambiguous?: boolean, expand?: boolean) => number;
  };
  return icu;
}

describe('icu: getStringWidth', () => {
  it('counts wide, narrow, zero-width and emoji columns like ICU', () => {
    const icu = boot();
    const cases: [string, number][] = [
      ['abc', 3],
      ['中文', 4],
      ['a中b', 4],
      ['한글', 4],
      ['ＡＢ', 4], // fullwidth Latin
      ['😀', 2], // emoji presentation
      ['🦀', 2],
      ['❤️', 1], // U+2764 is not emoji-presentation on its own
      ['a\u200bb', 2], // ZWSP is zero width
      ['a\u00adb', 3], // SOFT HYPHEN is a format char but one column
      ['e\u0301', 1], // combining acute accent
      ['a\u0001b', 2], // C0 control code
    ];
    for (const [input, width] of cases) {
      expect([input, icu.getStringWidth(input)]).toEqual([input, width]);
    }
  });

  it('folds an emoji ZWJ sequence unless asked to expand it', () => {
    const icu = boot();
    // A family emoji is three emoji joined by ZWJ; ICU counts each of them by
    // default (6 columns) but folds the ZWJ-followers when asked not to expand.
    expect(icu.getStringWidth('👨‍👩‍👧')).toBe(6);
    expect(icu.getStringWidth('👨‍👩‍👧', false, true)).toBe(6);
    expect(icu.getStringWidth('👨‍👩‍👧', false, false)).toBe(2);
  });

  it('throws rather than silently ignoring ambiguousAsFullWidth', () => {
    const icu = boot();
    expect(() => icu.getStringWidth('a', true)).toThrow(/ambiguousAsFullWidth/);
  });
});
