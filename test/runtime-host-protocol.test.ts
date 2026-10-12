import { describe, expect, it } from 'vitest';
import { HOST_TAG, isHostMessage, isHostMessageOf } from '../src/runtime-host-protocol';

describe('runtime-host bridge protocol', () => {
  it('tags every bridge message so it cannot be confused with preview traffic', () => {
    expect(HOST_TAG).toBe('__wnHost');
  });

  it('recognises well-formed bridge messages in both directions', () => {
    expect(isHostMessage({ __wnHost: 'boot', name: '' })).toBe(true);
    expect(isHostMessage({ __wnHost: 'post', name: 'x', data: { id: 1 } })).toBe(true);
    expect(isHostMessage({ __wnHost: 'up', isolated: true })).toBe(true);
    expect(isHostMessage({ __wnHost: 'data', name: '', data: { id: 1 } })).toBe(true);
    expect(isHostMessage({ __wnHost: 'hmr', port: 5173, frame: 'x' })).toBe(true);
  });

  it('rejects non-bridge payloads', () => {
    expect(isHostMessage(null)).toBe(false);
    expect(isHostMessage(undefined)).toBe(false);
    expect(isHostMessage('__wnHost')).toBe(false);
    // A preview's own HMR frame must not look like a bridge message.
    expect(isHostMessage({ __wnHmr: {}, port: 5173 })).toBe(false);
    expect(isHostMessage({ id: 1, type: 'run' })).toBe(false);
  });

  it('narrows to a specific kind', () => {
    const up = { __wnHost: 'up', isolated: false };
    expect(isHostMessageOf(up, 'up')).toBe(true);
    expect(isHostMessageOf(up, 'data')).toBe(false);
    const data = { __wnHost: 'data', name: '', data: {} };
    expect(isHostMessageOf(data, 'data')).toBe(true);
    expect(isHostMessageOf(data, 'up')).toBe(false);
  });
});
