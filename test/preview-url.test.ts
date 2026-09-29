import { describe, expect, it } from 'vitest';
import { previewPortFromHost, previewSubdomainHost, previewUrl, type PreviewEnv } from '../src/ui/preview-url';

const dev: PreviewEnv = {
  dev: true,
  base: '/',
  origin: 'http://localhost:5199',
  hostname: 'localhost',
  port: '5199',
};

const pages: PreviewEnv = {
  dev: false,
  base: '/web-node/',
  origin: 'https://mcuking.github.io',
  hostname: 'mcuking.github.io',
  port: '',
};

describe('previewUrl', () => {
  it('uses a real subdomain origin in dev', () => {
    // The bootstrap shell lives at its own path so the worker can let it through.
    expect(previewUrl(3000, dev)).toBe('http://3000.localhost:5199/__webnode__/');
    expect(previewUrl('5173', dev)).toBe('http://5173.localhost:5199/__webnode__/');
  });

  it('omits the port when the dev server runs on the default one', () => {
    expect(previewUrl(3000, { ...dev, port: '', origin: 'http://localhost' })).toBe(
      'http://3000.localhost/__webnode__/',
    );
  });

  it('keeps the path prefix when served from a sub-path (GitHub Pages)', () => {
    expect(previewUrl(3000, pages)).toBe('https://mcuking.github.io/web-node/preview/3000/');
  });

  it('keeps the path prefix for a production build served locally', () => {
    // `vite preview` runs the built app: DEV is false, so no dev middleware.
    expect(previewUrl(3000, { ...dev, dev: false })).toBe('http://localhost:5199/preview/3000/');
  });

  it('keeps the path prefix on a non-loopback host', () => {
    const lan: PreviewEnv = { ...dev, hostname: '192.168.1.9', origin: 'http://192.168.1.9:5199' };
    expect(previewUrl(3000, lan)).toBe('http://192.168.1.9:5199/preview/3000/');
  });

  // M113 — static hosting with a wildcard domain.
  it('uses a wildcard subdomain on a static host when one is configured', () => {
    const wildcard: PreviewEnv = {
      dev: false,
      base: '/',
      origin: 'https://webnode.example.com',
      hostname: 'webnode.example.com',
      port: '',
      previewDomain: 'webnode.example.com',
    };
    expect(previewUrl(3000, wildcard)).toBe('https://3000.webnode.example.com/__webnode__/');
  });

  it('passes the base path to the static shell for a sub-path deploy', () => {
    expect(previewUrl(3000, { ...pages, previewDomain: 'webnode.example.com' })).toBe(
      'https://3000.webnode.example.com/__webnode__/?base=%2Fweb-node%2F',
    );
  });

  it('lets a wildcard domain win even without the dev server', () => {
    const local: PreviewEnv = { ...dev, dev: false, previewDomain: 'localhost' };
    expect(previewSubdomainHost(3000, local)).toBe('3000.localhost');
  });

  it('falls back to the prefix when no wildcard domain and not dev', () => {
    expect(previewSubdomainHost(3000, { ...dev, dev: false })).toBeNull();
  });
});

describe('previewPortFromHost', () => {
  it('reads the port from a `<port>.localhost` host', () => {
    expect(previewPortFromHost('3000.localhost')).toBe(3000);
    expect(previewPortFromHost('3000.localhost:5199')).toBe(3000);
    expect(previewPortFromHost('5173.LOCALHOST')).toBe(5173);
  });

  it('reads the port from a configured wildcard domain', () => {
    expect(previewPortFromHost('8080.webnode.example.com', 'webnode.example.com')).toBe(8080);
    // …but not from an unrelated host with the same shape.
    expect(previewPortFromHost('8080.webnode.example.com')).toBeNull();
  });

  it('rejects the bare domain, a non-numeric label, and out-of-range ports', () => {
    expect(previewPortFromHost('localhost')).toBeNull();
    expect(previewPortFromHost('webnode.example.com', 'webnode.example.com')).toBeNull();
    expect(previewPortFromHost('abc.localhost')).toBeNull();
    expect(previewPortFromHost('0.localhost')).toBeNull();
    expect(previewPortFromHost('70000.localhost')).toBeNull();
  });
});
