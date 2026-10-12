import { describe, expect, it } from 'vitest';
import {
  RUNTIME_HOST_LABEL,
  RUNTIME_HOST_SHELL_PATH,
  isRuntimeHostHostname,
  runtimeHostFrame,
  runtimeHostHostname,
  type RuntimeHostEnv,
} from '../src/ui/runtime-host-url';

const dev: RuntimeHostEnv = {
  dev: true,
  base: '/',
  origin: 'http://localhost:5199',
  hostname: 'localhost',
  port: '5199',
};

const pages: RuntimeHostEnv = {
  dev: false,
  base: '/web-node/',
  origin: 'https://mcuking.github.io',
  hostname: 'mcuking.github.io',
  port: '',
};

describe('runtimeHostHostname', () => {
  it('uses rt.localhost under the dev server on loopback', () => {
    expect(runtimeHostHostname(dev)).toBe(`${RUNTIME_HOST_LABEL}.localhost`);
  });

  it('uses the configured runtime domain', () => {
    expect(runtimeHostHostname({ ...dev, runtimeDomain: 'webnode.example' })).toBe('rt.webnode.example');
  });

  it('falls back to the preview domain when no runtime domain is set', () => {
    expect(runtimeHostHostname({ ...dev, previewDomain: 'preview.example' })).toBe('rt.preview.example');
  });

  it('prefers the dedicated runtime domain over the preview domain', () => {
    expect(
      runtimeHostHostname({ ...dev, previewDomain: 'preview.example', runtimeDomain: 'rt.example' }),
    ).toBe('rt.rt.example');
  });

  it('has no host on a sub-path deploy (no wildcard DNS, e.g. GitHub Pages)', () => {
    expect(runtimeHostHostname(pages)).toBeNull();
  });

  it('has no host in a production build served from the origin root without a wildcard', () => {
    expect(runtimeHostHostname({ ...dev, dev: false })).toBeNull();
  });

  it('has no host when the dev server is not on loopback', () => {
    expect(runtimeHostHostname({ ...dev, hostname: '192.168.1.10' })).toBeNull();
  });
});

describe('runtimeHostFrame', () => {
  it('builds the shell URL and origin with the dev port', () => {
    expect(runtimeHostFrame(dev)).toEqual({
      url: `http://rt.localhost:5199${RUNTIME_HOST_SHELL_PATH}`,
      origin: 'http://rt.localhost:5199',
      hostname: 'rt.localhost',
    });
  });

  it('omits the port when it is the default one', () => {
    const frame = runtimeHostFrame({ ...dev, port: '', origin: 'https://localhost' });
    expect(frame?.url).toBe(`https://rt.localhost${RUNTIME_HOST_SHELL_PATH}`);
    expect(frame?.origin).toBe('https://rt.localhost');
  });

  it('is null when no isolated host is available', () => {
    expect(runtimeHostFrame(pages)).toBeNull();
  });
});

describe('isRuntimeHostHostname', () => {
  it('recognises the runtime host (ignoring a port)', () => {
    expect(isRuntimeHostHostname('rt.localhost', dev)).toBe(true);
    expect(isRuntimeHostHostname('rt.localhost:5199', dev)).toBe(true);
    expect(isRuntimeHostHostname('RT.LOCALHOST', dev)).toBe(true);
  });

  it('rejects any other host', () => {
    expect(isRuntimeHostHostname('localhost', dev)).toBe(false);
    expect(isRuntimeHostHostname('3000.localhost', dev)).toBe(false);
    expect(isRuntimeHostHostname('rt.example.com', dev)).toBe(false);
  });

  it('never matches when there is no host at all', () => {
    expect(isRuntimeHostHostname('rt.localhost', pages)).toBe(false);
  });
});
