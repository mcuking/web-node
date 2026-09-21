import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripVendoredSource, commentSpans } from '../plugins/vendored-source';
import { VENDORED, VENDORED_FILES } from '../src/node-runtime/vendored';

const lines = (s: string): number => s.split('\n').length;

describe('stripVendoredSource', () => {
  it('drops a whole-line comment without moving the lines after it', () => {
    const src = ['const a = 1;', '// a note', 'const b = 2;'].join('\n');
    expect(stripVendoredSource(src)).toBe(['const a = 1;', '', 'const b = 2;'].join('\n'));
  });

  it('drops a trailing comment and keeps the code column', () => {
    const src = 'const a = 1; // why\n';
    // `const a = 1;` starts at column 0 in both.
    expect(stripVendoredSource(src)).toBe('const a = 1;\n');
  });

  it('keeps every newline a block comment contained', () => {
    const src = ['a();', '/* one', '   two', '   three */', 'b();'].join('\n');
    const out = stripVendoredSource(src);
    expect(lines(out)).toBe(lines(src));
    expect(out).toBe(['a();', '', '', '', 'b();'].join('\n'));
  });

  it('never joins the tokens around a newline-free comment', () => {
    expect(stripVendoredSource('a/**/b')).toBe('a b');
    expect(stripVendoredSource('1/*x*/in y')).toBe('1 in y');
  });

  it('leaves comments inside strings, templates and regexes alone', () => {
    const src = [
      "const s = 'http://x';",
      'const t = `/* not a comment */`;',
      'const r = /a\\/\\/b/g;',
      'const u = \\`\\${`// no`}\\`;',
    ].join('\n');
    // `/a\/\/b/g` is a regex: its `//` must survive.
    const out = stripVendoredSource(src);
    expect(out).toContain("'http://x'");
    expect(out).toContain('`/* not a comment */`');
    expect(out).toContain('/a\\/\\/b/g');
  });

  it('reports only comment spans, never data', () => {
    const src = "const re = /\\/\\//; // real comment\nconst s = '/*x*/';\n";
    const spans = commentSpans(src).map(([a, b]) => src.slice(a, b));
    expect(spans).toEqual(['// real comment']);
  });

  it('keeps the leading licence block', () => {
    const src = [
      '// Copyright Joyent, Inc. and other Node contributors.',
      '//',
      '// Permission is hereby granted, free of charge, to any person obtaining a',
      '// copy of this software and associated documentation files (the',
      '// "Software"), to deal in the Software without restriction.',
      '',
      '// an ordinary comment',
      'const a = 1;',
    ].join('\n');
    const out = stripVendoredSource(src);
    expect(out).toContain('Copyright Joyent, Inc.');
    expect(out).toContain('Permission is hereby granted');
    expect(out).not.toContain('an ordinary comment');
    expect(lines(out)).toBe(lines(src));
  });

  it('is a fixed point', () => {
    const src = '// a\nconst a = 1; /* b */\n';
    expect(stripVendoredSource(stripVendoredSource(src))).toBe(stripVendoredSource(src));
  });
});

describe('the vendored bundle', () => {
  it('ships stripped sources with identical line numbers', () => {
    let before = 0;
    let after = 0;
    for (const rel of VENDORED_FILES) {
      const pristine = readFileSync(`vendor/node-lib/${rel}`, 'utf8');
      const shipped = VENDORED[rel];
      // The plugin rewrote it (so the raw text in the bundle is the stripped one).
      expect(shipped).toBe(stripVendoredSource(pristine));
      expect(lines(shipped)).toBe(lines(pristine));
      expect(shipped.length).toBeLessThanOrEqual(pristine.length);
      before += pristine.length;
      after += shipped.length;
    }
    // Comments are ~1/4 of Node's lib; anything close to 0 means the plugin did
    // not run, and anything over ~40% means the tokeniser ate code.
    const saved = 1 - after / before;
    expect(saved).toBeGreaterThan(0.15);
    expect(saved).toBeLessThan(0.35);
  });

  it('still parses every file', () => {
    for (const rel of VENDORED_FILES) {
      const src = VENDORED[rel];
      // Constructing the wrapper parses the body, so a SyntaxError surfaces here.
      expect(() => new Function('exports', 'require', 'module', '__filename', '__dirname', src)).not.toThrow();
    }
  });

  it('covers every file on disk', () => {
    // Derive the expected count from the manifest rather than hard-coding it,
    // so vendoring a new file cannot silently skip the bundle.
    const manifest = JSON.parse(readFileSync('vendor/node-lib/MANIFEST.json', 'utf8')) as {
      files: { path: string }[];
    };
    expect(VENDORED_FILES.length).toBe(manifest.files.length);
    expect(VENDORED_FILES.length).toBeGreaterThan(100);
  });
});
