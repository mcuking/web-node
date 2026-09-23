import { describe, expect, it } from 'vitest';
import { MemoryVfs } from '../src/node-runtime/vfs';
import { NodeRuntime } from '../src/node-runtime/runtime';

/**
 * `url` is now Node's own `lib/url.js` — the legacy `Url`/`parse`/`format`/
 * `resolve`/`resolveObject` API plus the WHATWG re-exports. The WHATWG classes
 * and `pathToFileURL`/`fileURLToPath` come from `internal/url`, which bridges to
 * the host's spec-compliant URL parser (a browser tab has one; Node's own is
 * native Ada).
 *
 * Every expectation below was read off a real Node, oracle fnm Node v26.9.0
 * (see docs/DEVLOG.md).
 */
function boot(): { require: (id: string) => any } {
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
  return { require: (id) => runtime.realm.require(id) };
}

describe('url is the vendored Node source', () => {
  it('exposes the module surface', () => {
    const url = boot().require('url');
    expect(Object.keys(url).sort()).toEqual([
      'URL',
      'URLPattern',
      'URLSearchParams',
      'Url',
      'domainToASCII',
      'domainToUnicode',
      'fileURLToPath',
      'fileURLToPathBuffer',
      'format',
      'parse',
      'pathToFileURL',
      'resolve',
      'resolveObject',
      'urlToHttpOptions',
    ]);
    // The WHATWG classes are re-exported from `internal/url` (the host classes).
    expect(url.URL).toBe(URL);
    expect(url.URLSearchParams).toBe(URLSearchParams);
  });

  it('pathToFileURL resolves against the cwd and encodes the unsafe set', () => {
    const url = boot().require('url');
    expect(url.pathToFileURL('/a b/c#d.txt').href).toBe('file:///a%20b/c%23d.txt');
    expect(url.pathToFileURL('/a/b?c').href).toBe('file:///a/b%3Fc');
    expect(url.pathToFileURL('/a/b%c').href).toBe('file:///a/b%25c');
    // Characters outside the RFC-1738 unsafe set pass through.
    expect(url.pathToFileURL('/a(b)~c').href).toBe('file:///a(b)%7Ec');
    // Relative paths resolve against the runtime's (VFS) cwd, not the host's.
    expect(url.pathToFileURL('rel/x').href).toBe('file:///project/rel/x');
  });

  it('fileURLToPath inverts it and rejects bad URLs', () => {
    const url = boot().require('url');
    expect(url.fileURLToPath('file:///a%20b/c%23d.txt')).toBe('/a b/c#d.txt');
    expect(url.fileURLToPath(new URL('file:///project/a.js'))).toBe('/project/a.js');
    expect(() => url.fileURLToPath('http://x/y')).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_URL_SCHEME' }),
    );
    expect(() => url.fileURLToPath('file://host/y')).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_FILE_URL_HOST' }),
    );
    expect(() => url.fileURLToPath('file:///a%2Fb')).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_FILE_URL_PATH' }),
    );
    expect(() => url.fileURLToPath(123 as unknown as string)).toThrowError(
      expect.objectContaining({ code: 'ERR_INVALID_ARG_TYPE' }),
    );
  });

  it('fileURLToPathBuffer returns a Buffer of the path', () => {
    const url = boot().require('url');
    expect(url.fileURLToPathBuffer('file:///project/a.js').toString()).toBe('/project/a.js');
  });

  // Windows form (`getPathFromURLWin32`) — every expectation read off oracle
  // fnm Node v26.9.0 with `fileURLToPath(u, { windows: true })`. Pure string
  // transform, so it works even though the VFS is POSIX-shaped.
  it('fileURLToPath({ windows: true }) mirrors getPathFromURLWin32', () => {
    const url = boot().require('url');
    const win = (s: string) => url.fileURLToPath(new URL(s), { windows: true });
    const throws = (s: string) =>
      expect(() => win(s)).toThrowError(
        expect.objectContaining({ code: 'ERR_INVALID_FILE_URL_PATH', name: 'TypeError' }),
      );

    // Drive-letter paths: leading slash dropped, separators turned into `\`.
    expect(win('file:///C:/a/b.txt')).toBe('C:\\a\\b.txt');
    expect(win('file:///c:/a/b.txt')).toBe('c:\\a\\b.txt');
    expect(win('file:///C:/')).toBe('C:\\');
    expect(win('file:///C:')).toBe('C:');
    // A literal backslash in the path is already a separator.
    expect(win('file:///C:/a/b\\c')).toBe('C:\\a\\b\\c');
    // Percent-encoded path is decoded after separator rewriting.
    expect(win('file:///C:/a%20b/c%23d.txt')).toBe('C:\\a b\\c#d.txt');
    expect(win('file:///C:/%E4%B8%AD/x')).toBe('C:\\中\\x');
    expect(win('file:///C:/déjà.txt')).toBe('C:\\déjà.txt');
    // Query and fragment are not part of the path.
    expect(win('file:///C:/a/b?q=1')).toBe('C:\\a\\b');
    expect(win('file:///C:/a/b#f')).toBe('C:\\a\\b');
    // `localhost` collapses to an empty host, so it is not treated as UNC.
    expect(win('file://localhost/C:/x')).toBe('C:\\x');
    // Any other host is a UNC path; IDN hosts are decoded.
    expect(win('file://server/share/x')).toBe('\\\\server\\share\\x');
    expect(win('file://host/C:/x')).toBe('\\\\host\\C:\\x');
    expect(win('file://xn--n3h/C:/x')).toBe('\\\\☃\\C:\\x');

    // A path with no drive letter is rejected as non-absolute.
    throws('file:///C');
    throws('file:///a/b.txt');
    throws('file:////server/share/x');
    throws('file:///é/C:/x');
    // Encoded separators are forbidden (both `%2f` and `%5c`, either case).
    throws('file:///C:/a/b%2Fc');
    throws('file:///C:/a/b%2fc');
    throws('file:///C:/a/b%5Cc');
    throws('file:///C:/a/b%5cc');
  });

  it('domainToASCII / domainToUnicode', () => {
    const url = boot().require('url');
    expect(url.domainToASCII('münchen.de')).toBe('xn--mnchen-3ya.de');
    expect(url.domainToASCII('EXAMPLE.com')).toBe('example.com');
    expect(url.domainToASCII('')).toBe('');
    expect(url.domainToUnicode('xn--mnchen-3ya.de')).toBe('münchen.de');
  });

  it('urlToHttpOptions lifts a URL into request options', () => {
    const url = boot().require('url');
    expect(url.urlToHttpOptions(new URL('http://user:pw@example.com:8080/p?a=1#h'))).toEqual({
      protocol: 'http:',
      hostname: 'example.com',
      hash: '#h',
      search: '?a=1',
      pathname: '/p',
      path: '/p?a=1',
      href: 'http://user:pw@example.com:8080/p?a=1#h',
      port: 8080,
      auth: 'user:pw',
    });
    // No auth when there is no userinfo; no port when the URL has none.
    expect(url.urlToHttpOptions(new URL('https://example.com/p'))).toEqual({
      protocol: 'https:',
      hostname: 'example.com',
      hash: '',
      search: '',
      pathname: '/p',
      path: '/p',
      href: 'https://example.com/p',
    });
  });

  it('parses the legacy Url shape', () => {
    const url = boot().require('url');
    const p = url.parse('http://u:p@h.com:81/p/q?x=1#f');
    expect({
      protocol: p.protocol,
      slashes: p.slashes,
      auth: p.auth,
      host: p.host,
      port: p.port,
      hostname: p.hostname,
      hash: p.hash,
      search: p.search,
      query: p.query,
      pathname: p.pathname,
      path: p.path,
      href: p.href,
    }).toEqual({
      protocol: 'http:',
      slashes: true,
      auth: 'u:p',
      host: 'h.com:81',
      port: '81',
      hostname: 'h.com',
      hash: '#f',
      search: '?x=1',
      query: 'x=1',
      pathname: '/p/q',
      path: '/p/q?x=1',
      href: 'http://u:p@h.com:81/p/q?x=1#f',
    });
    // With parseQueryString, `query` becomes an object.
    expect(url.parse('http://h.com/p?x=1&y=2', true).query).toEqual({ x: '1', y: '2' });
    // slashesDenoteHost
    const sp = url.parse('//h/p', false, true);
    expect({ host: sp.host, pathname: sp.pathname, slashes: sp.slashes }).toEqual({
      host: 'h',
      pathname: '/p',
      slashes: true,
    });
  });

  it('formats legacy objects and WHATWG URLs', () => {
    const url = boot().require('url');
    expect(url.format({ protocol: 'https:', host: 'h.com', pathname: '/p', query: { a: '1' } })).toBe(
      'https://h.com/p?a=1',
    );
    expect(
      url.format({
        protocol: 'http:',
        slashes: true,
        auth: 'u:p',
        host: 'h.com:81',
        pathname: '/p',
        search: '?a=1',
        hash: '#f',
      }),
    ).toBe('http://u:p@h.com:81/p?a=1#f');
    // A WHATWG URL goes through the native `url.format` binding.
    expect(url.format(new URL('http://u:p@h.com/p?x=1#f'))).toBe('http://u:p@h.com/p?x=1#f');
    expect(
      url.format(new URL('http://u:p@h.com/p?x=1#f'), {
        auth: false,
        search: false,
        fragment: false,
      }),
    ).toBe('http://h.com/p');
  });

  it('resolves relative references', () => {
    const url = boot().require('url');
    expect(url.resolve('http://h.com/a/b', '../c')).toBe('http://h.com/c');
    expect(url.resolveObject('http://h/a/b', '../c')).toEqual({
      protocol: 'http:',
      slashes: true,
      auth: null,
      host: 'h',
      port: null,
      hostname: 'h',
      hash: null,
      search: null,
      query: null,
      pathname: '/c',
      path: '/c',
      href: 'http://h/c',
    });
  });
});
