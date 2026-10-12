import { describe, expect, it } from 'vitest';
import { capabilityIssues, capabilityMessage, detectCapabilities, type CapabilityScope } from '../src/ui/capabilities';

function scope(overrides: Partial<CapabilityScope>): CapabilityScope {
  return overrides;
}

const SAB = function SharedArrayBuffer() {};

describe('browser capability detection', () => {
  it('reports full fidelity under cross-origin isolation with OPFS', () => {
    const caps = detectCapabilities(scope({ crossOriginIsolated: true, SharedArrayBuffer: SAB, navigator: { storage: { getDirectory: () => {} } } }));
    expect(caps).toEqual({
      crossOriginIsolated: true,
      sharedArrayBuffer: true,
      opfs: true,
      realParallelism: true,
      persistence: true,
    });
    expect(capabilityIssues(caps)).toEqual([]);
  });

  it('flags no isolation when crossOriginIsolated is false, even with a constructor', () => {
    // A bare `SharedArrayBuffer` global is not enough — the constructor throws
    // at runtime unless the realm is cross-origin isolated.
    const caps = detectCapabilities(scope({ crossOriginIsolated: false, SharedArrayBuffer: SAB, navigator: { storage: { getDirectory: () => {} } } }));
    expect(caps.sharedArrayBuffer).toBe(true);
    expect(caps.realParallelism).toBe(false);
    expect(capabilityIssues(caps)).toEqual(['no-isolation']);
  });

  it('flags no OPFS when storage.getDirectory is missing', () => {
    const caps = detectCapabilities(scope({ crossOriginIsolated: true, SharedArrayBuffer: SAB, navigator: {} }));
    expect(caps.opfs).toBe(false);
    expect(capabilityIssues(caps)).toEqual(['no-opfs']);
    expect(capabilityMessage('no-opfs')).toMatch(/not persist/);
  });

  it('lists both issues, isolation first, when nothing is available', () => {
    const caps = detectCapabilities(scope({}));
    expect(caps).toEqual({ crossOriginIsolated: false, sharedArrayBuffer: false, opfs: false, realParallelism: false, persistence: false });
    expect(capabilityIssues(caps)).toEqual(['no-isolation', 'no-opfs']);
  });

  it('defaults to the global scope without throwing', () => {
    // In the node test environment none of the features exist; detection must
    // still be a total function.
    expect(() => detectCapabilities()).not.toThrow();
    expect(typeof detectCapabilities().opfs).toBe('boolean');
  });

  it('has a message for every issue', () => {
    for (const issue of ['no-isolation', 'no-opfs'] as const) {
      expect(capabilityMessage(issue).length).toBeGreaterThan(10);
    }
  });
});
