/**
 * Resizable three-column layout math, kept pure so it is unit-testable and the
 * DOM wiring in `main.ts` stays thin.
 *
 * The split is stored as **fractions of the usable width**, not pixels, so a
 * chosen layout survives a window resize (and a reload) instead of drifting on
 * one screen size. `output` is never stored: it always takes the remainder, so
 * the three columns sum exactly to the width with no rounding gap.
 *
 * Only the two dividers the user can actually drag are modelled — one between
 * the file tree and the editor, one between the editor and the output pane — so
 * `files` and `editor` are the two stored fractions and `output` is derived.
 */

export interface PaneFractions {
  /** Left column (file tree) as a fraction of the usable width. */
  files: number;
  /** Middle column (editor) as a fraction of the usable width. */
  editor: number;
}

export interface PaneWidths {
  files: number;
  editor: number;
  output: number;
}

export interface PaneMins {
  files: number;
  editor: number;
  output: number;
}

/**
 * Minimum widths in CSS pixels. They apply to the *resolved* widths, so a drag
 * (or a shrinking window) never collapses a column past the point where its
 * content is unusable.
 */
export const PANE_MINS: PaneMins = { files: 150, editor: 220, output: 260 };

/** The file-tree column's fixed default width, matching the stylesheet. */
export const DEFAULT_FILES_PX = 240;

/**
 * The editor:output ratio the stylesheet uses when nothing has been resized
 * (`1fr` vs `1.1fr`). `output = ratio * editor`, so `editor` is `1 / (1 + ratio)`
 * of what is left after the file tree.
 */
const DEFAULT_EDITOR_OUTPUT_RATIO = 1.1;

/**
 * The split a fresh session starts from: a `240px` file tree and the stylesheet's
 * `editor:output = 1:1.1`, expressed as fractions of `available`.
 */
export function defaultFractions(available: number): PaneFractions {
  const total = Math.max(0, available);
  if (total === 0) return { files: 0, editor: 0 };
  const files = Math.min(DEFAULT_FILES_PX, total) / total;
  const remaining = Math.max(0, 1 - files);
  return { files, editor: remaining / (1 + DEFAULT_EDITOR_OUTPUT_RATIO) };
}

/**
 * Turn a stored fraction split into concrete pixel widths for a given container
 * width, clamping each column to its minimum. The clamps are applied in order
 * (file tree, then editor) so the remainder handed to `output` is never below
 * its own minimum while the width allows it.
 */
export function resolveWidths(fractions: PaneFractions, available: number, mins: PaneMins = PANE_MINS): PaneWidths {
  const total = Math.max(0, available);
  const maxFiles = Math.max(mins.files, total - mins.editor - mins.output);
  const files = Math.min(Math.max(fractions.files * total, mins.files), maxFiles);
  const maxEditor = Math.max(mins.editor, total - files - mins.output);
  const editor = Math.min(Math.max(fractions.editor * total, mins.editor), maxEditor);
  const output = Math.max(0, total - files - editor);
  return { files, editor, output };
}

/** The inverse of {@link resolveWidths}: record a pixel split as fractions. */
export function fractionsFromPixels(files: number, editor: number, available: number): PaneFractions {
  const total = Math.max(0, available);
  if (total === 0) return { files: 0, editor: 0 };
  return { files: files / total, editor: editor / total };
}

/** Whether a value parsed from storage is a usable fraction split. */
export function isPaneFractions(value: unknown): value is PaneFractions {
  if (!value || typeof value !== 'object') return false;
  const v = value as Partial<PaneFractions>;
  return (
    typeof v.files === 'number' &&
    typeof v.editor === 'number' &&
    Number.isFinite(v.files) &&
    Number.isFinite(v.editor) &&
    v.files > 0 &&
    v.editor > 0 &&
    v.files + v.editor < 1
  );
}
