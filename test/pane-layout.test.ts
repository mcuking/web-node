import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FILES_PX,
  PANE_MINS,
  defaultFractions,
  fractionsFromPixels,
  isPaneFractions,
  resolveWidths,
} from '../src/ui/pane-layout';

describe('defaultFractions', () => {
  it('reproduces the stylesheet split (240px, editor:output = 1:1.1)', () => {
    const available = 1000;
    const { files, editor } = defaultFractions(available);
    const width = resolveWidths({ files, editor }, available);
    expect(width.files).toBeCloseTo(DEFAULT_FILES_PX, 5);
    // editor:output must be 1:1.1.
    expect(width.output / width.editor).toBeCloseTo(1.1, 5);
    expect(width.files + width.editor + width.output).toBeCloseTo(available, 5);
  });

  it('degenerates safely at zero width', () => {
    expect(defaultFractions(0)).toEqual({ files: 0, editor: 0 });
  });
});

describe('resolveWidths', () => {
  it('always sums to the container width', () => {
    const width = resolveWidths({ files: 0.25, editor: 0.35 }, 1200);
    expect(width.files + width.editor + width.output).toBeCloseTo(1200, 5);
  });

  it('enforces the minimum widths', () => {
    // A stored split that would starve the editor is clamped up to its minimum.
    const width = resolveWidths({ files: 0.9, editor: 0.05 }, 1200);
    expect(width.files).toBeGreaterThanOrEqual(PANE_MINS.files);
    expect(width.editor).toBeGreaterThanOrEqual(PANE_MINS.editor);
    expect(width.output).toBeGreaterThanOrEqual(PANE_MINS.output);
  });

  it('keeps every column at its minimum on a narrow viewport', () => {
    const width = resolveWidths({ files: 0.5, editor: 0.3 }, 400);
    expect(width.files).toBeGreaterThanOrEqual(PANE_MINS.files);
    expect(width.editor).toBeGreaterThanOrEqual(PANE_MINS.editor);
    // Too narrow to honour all three: output shrinks, but never goes negative.
    expect(width.output).toBeGreaterThanOrEqual(0);
  });

  it('scales with the container for the same fractions', () => {
    const a = resolveWidths({ files: 0.3, editor: 0.3 }, 1000);
    const b = resolveWidths({ files: 0.3, editor: 0.3 }, 1500);
    expect(b.files / a.files).toBeCloseTo(1.5, 2);
    expect(b.output).toBeGreaterThan(a.output);
  });
});

describe('fractionsFromPixels', () => {
  it('round-trips a resolved split', () => {
    const available = 1280;
    const width = resolveWidths({ files: 0.22, editor: 0.34 }, available);
    const fractions = fractionsFromPixels(width.files, width.editor, available);
    const again = resolveWidths(fractions, available);
    expect(again.files).toBeCloseTo(width.files, 5);
    expect(again.editor).toBeCloseTo(width.editor, 5);
  });

  it('returns zeros for a zero-width container', () => {
    expect(fractionsFromPixels(100, 200, 0)).toEqual({ files: 0, editor: 0 });
  });
});

describe('isPaneFractions', () => {
  it('accepts a sane stored split', () => {
    expect(isPaneFractions({ files: 0.24, editor: 0.3 })).toBe(true);
  });

  it('rejects anything that is not a usable split', () => {
    expect(isPaneFractions(null)).toBe(false);
    expect(isPaneFractions('nope')).toBe(false);
    expect(isPaneFractions({ files: 0.6 })).toBe(false);
    expect(isPaneFractions({ files: 0, editor: 0.3 })).toBe(false);
    expect(isPaneFractions({ files: 0.6, editor: 0.6 })).toBe(false);
    expect(isPaneFractions({ files: Number.NaN, editor: 0.3 })).toBe(false);
  });
});
