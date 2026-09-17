import { describe, expect, it } from 'vitest';
import { previewUrl, type PreviewEnv } from '../src/ui/preview-url';

const dev: PreviewEnv = {
  dev: true,
  base: '/',
  origin: 'http://localhost:5199',
  hostname: 'localhost',
  port: '5199',
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
    const pages: PreviewEnv = {
      dev: false,
      base: '/web-node/',
      origin: 'https://mcuking.github.io',
      hostname: 'mcuking.github.io',
      port: '',
    };
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
});
