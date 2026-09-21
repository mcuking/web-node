import type { BindingContext, BindingFactory } from './context';

/**
 * The `url`, `url_pattern` and `encoding_binding` bindings.
 *
 * In Node these are mostly native: `url` wraps the Ada URL parser
 * (`src/node_url.cc`), `encoding_binding` exposes ada's IDNA
 * (`src/encoding_binding.cc`), and `url_pattern` exposes URLPattern. A browser
 * tab already has a spec-compliant URL parser and URLPattern as host classes,
 * so these bindings forward to the host instead of reimplementing a parser.
 *
 * Only the surface the vendored `lib/url.js` reaches for is provided:
 *   - `url.format(href, hash, unicode, search, auth)` — the legacy
 *     `url.format(new URL(...))` path. `BindingData::Format` (`src/node_url.cc`)
 *     re-parses the href with Ada, drops the hash/query/auth the flags turn
 *     off, optionally un-encodes the hostname to Unicode, and re-serializes.
 *     The host URL object does all of that: assign `''` to the pieces to drop
 *     and read `.href` back.
 *   - `encoding_binding.toASCII` / `toUnicode` — IDNA. The host URL parser
 *     already applies UTS#46 while normalizing a hostname, so `toASCII` is a
 *     parse round-trip, and `toUnicode` decodes the `xn--` labels back with the
 *     vendored `punycode`.
 *   - `url_pattern.URLPattern` — the host global (Chrome ships it).
 */

interface Punycode {
  toUnicode(input: string): string;
}

/**
 * The vendored `punycode` module can only be resolved through `requireBuiltin`,
 * which is not ready while the bindings are being constructed — so resolve it
 * on first use and cache it.
 */
function lazyPunycode(ctx: BindingContext): () => Punycode {
  let cached: Punycode | null = null;
  return () => (cached ??= (ctx.requireBuiltin?.('punycode') ?? {}) as Punycode);
}

/** `ada::idna::to_ascii`, as far as the host URL parser reproduces it. */
function toASCII(domain: unknown): string {
  const input = `${domain}`;
  if (input === '') return input;
  try {
    // `.hostname` is already the UTS#46 + punycode form the parser produced.
    return new URL(`http://${input}`).hostname;
  } catch {
    // Not a parseable host; Ada would still hand back a best-effort string.
    return input;
  }
}

function toUnicode(punycode: Punycode, domain: unknown): string {
  const input = `${domain}`;
  const labels = input.split('.');
  let changed = false;
  for (let i = 0; i < labels.length; i++) {
    if (labels[i].startsWith('xn--')) {
      try {
        labels[i] = punycode.toUnicode(labels[i]);
        changed = true;
      } catch {
        /* leave the label alone when it is not valid punycode */
      }
    }
  }
  return changed ? labels.join('.') : input;
}

export const urlBinding: BindingFactory = (ctx) => {
  const punycode = lazyPunycode(ctx);
  return {
    /**
     * `BindingData::Format` (`src/node_url.cc`): re-serialize an href, dropping
     * the pieces the legacy `url.format(url, options)` flags switch off.
     */
    format: (href: string, hash: boolean, unicode: boolean, search: boolean, auth: boolean): string => {
      let out: URL;
      try {
        out = new URL(`${href}`);
      } catch {
        // Ada likewise hands the unchanged href back when it cannot re-parse.
        return href;
      }
      if (!hash) out.hash = '';
      if (!search) out.search = '';
      if (!auth) {
        out.username = '';
        out.password = '';
      }
      if (unicode) {
        // Rebuild the host with the Unicode form of each `xn--` label.
        const labels = out.hostname.split('.');
        let changed = false;
        for (let i = 0; i < labels.length; i++) {
          const bare = labels[i].replace(/^\[|\]$/g, '');
          if (bare.startsWith('xn--')) {
            try {
              labels[i] = labels[i].replace(bare, punycode().toUnicode(bare));
              changed = true;
            } catch {
              /* not valid punycode — keep the ASCII label */
            }
          }
        }
        if (changed) {
          const port = out.port ? `:${out.port}` : '';
          out.host = `${labels.join('.')}${port}`;
        }
      }
      return out.href;
    },
  };
};

export const urlPatternBinding: BindingFactory = () => ({
  URLPattern: (globalThis as { URLPattern?: unknown }).URLPattern,
});

export const encodingBinding: BindingFactory = (ctx) => {
  const punycode = lazyPunycode(ctx);
  return {
    toASCII,
    toUnicode: (domain: unknown): string => toUnicode(punycode(), domain),
  };
};
