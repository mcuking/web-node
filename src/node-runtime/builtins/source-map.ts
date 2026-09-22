/**
 * `SourceMap` — a faithful port of Node's `lib/internal/source_map/source_map.js`
 * (itself derived from V8's `SourceMap.js`). It is pure JavaScript in Node (only
 * `validateObject` is borrowed), so we port it verbatim: the VLQ decoding, the
 * `sections` handling and the entry lookup all behave exactly like Node's.
 *
 * `module.SourceMap` and `module.findSourceMap()` are the public faces of this.
 */
export const kMappings = Symbol('kMappings');

const VLQ_BASE_SHIFT = 5;
const VLQ_BASE_MASK = (1 << 5) - 1;
const VLQ_CONTINUATION_MASK = 1 << 5;

let base64Map: Record<string, number> | undefined;

function ensureBase64Map(): void {
  if (base64Map) return;
  const base64Digits = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  base64Map = {};
  for (let i = 0; i < base64Digits.length; ++i) base64Map[base64Digits[i]] = i;
}

class StringCharIterator {
  #string: string;
  #position = 0;

  constructor(string: string) {
    this.#string = string;
  }
  next(): string {
    return this.#string.charAt(this.#position++);
  }
  peek(): string {
    return this.#string.charAt(this.#position);
  }
  hasNext(): boolean {
    return this.#position < this.#string.length;
  }
}

type Mapping = unknown[];
type MapPayload = {
  sources: string[];
  sourcesContent?: string[];
  names?: string[];
  mappings: string;
};

/** One decoded mapping row: `[genLine, genCol, source?, srcLine?, srcCol?, name?]`. */
export class SourceMap {
  #payload: Record<string, unknown>;
  #mappings: Mapping[] = [];
  #sources: Record<string, boolean> = {};
  #sourceContentByURL: Record<string, string> = {};
  #lineLengths: number[] | undefined;

  constructor(payload: Record<string, unknown>, options: { lineLengths?: number[] } = {}) {
    ensureBase64Map();
    this.#payload = cloneSourceMapV3(payload);
    this.#parseMappingPayload();
    if (Array.isArray(options.lineLengths) && options.lineLengths.length) {
      this.#lineLengths = options.lineLengths;
    }
  }

  /** The raw source map v3 payload (a defensive copy). */
  get payload(): Record<string, unknown> {
    return cloneSourceMapV3(this.#payload);
  }

  get [kMappings](): Mapping[] {
    return this.#mappings;
  }

  /** Line lengths of the generated source, if supplied. */
  get lineLengths(): number[] | undefined {
    if (this.#lineLengths) return this.#lineLengths.slice();
    return undefined;
  }

  #parseMappingPayload(): void {
    const payload = this.#payload as { sections?: Array<{ map: MapPayload; offset: { line: number; column: number } }> };
    if (payload.sections) this.#parseSections(payload.sections);
    else this.#parseMap(this.#payload as unknown as MapPayload, 0, 0);
    this.#mappings.sort(compareSourceMapEntry);
  }

  #parseSections(sections: Array<{ map: MapPayload; offset: { line: number; column: number } }>): void {
    for (let i = 0; i < sections.length; ++i) {
      const section = sections[i];
      this.#parseMap(section.map, section.offset.line, section.offset.column);
    }
  }

  /**
   * Find the mapping entry covering `(lineOffset, columnOffset)` (both 0-indexed).
   */
  findEntry(lineOffset: number, columnOffset: number): Record<string, unknown> {
    let first = 0;
    let count = this.#mappings.length;
    while (count > 1) {
      const step = count >> 1;
      const middle = first + step;
      const mapping = this.#mappings[middle];
      if (
        lineOffset < (mapping[0] as number) ||
        (lineOffset === mapping[0] && columnOffset < (mapping[1] as number))
      ) {
        count = step;
      } else {
        first = middle;
        count -= step;
      }
    }
    const entry = this.#mappings[first];
    if (
      (!first && entry && (lineOffset < (entry[0] as number) || (lineOffset === entry[0] && columnOffset < (entry[1] as number)))) ||
      !entry
    ) {
      return {};
    }
    return {
      generatedLine: entry[0],
      generatedColumn: entry[1],
      originalSource: entry[2],
      originalLine: entry[3],
      originalColumn: entry[4],
      name: entry[5],
    };
  }

  /**
   * Map a 1-indexed `(lineNumber, columnNumber)` in generated code back to
   * its origin in the source.
   */
  findOrigin(lineNumber: number, columnNumber: number): Record<string, unknown> {
    const range = this.findEntry(lineNumber - 1, columnNumber - 1);
    if (
      range.originalSource === undefined ||
      range.originalLine === undefined ||
      range.originalColumn === undefined ||
      range.generatedLine === undefined ||
      range.generatedColumn === undefined
    ) {
      return {};
    }
    const lineOffset = lineNumber - (range.generatedLine as number);
    const columnOffset = columnNumber - (range.generatedColumn as number);
    return {
      name: range.name,
      fileName: range.originalSource,
      lineNumber: (range.originalLine as number) + lineOffset,
      columnNumber: (range.originalColumn as number) + columnOffset,
    };
  }

  #parseMap(map: MapPayload, lineNumber: number, columnNumber: number): void {
    let sourceIndex = 0;
    let sourceLineNumber = 0;
    let sourceColumnNumber = 0;
    let nameIndex = 0;

    const sources: string[] = [];
    for (let i = 0; i < map.sources.length; ++i) {
      const url = map.sources[i];
      sources.push(url);
      this.#sources[url] = true;
      if (map.sourcesContent?.[i]) this.#sourceContentByURL[url] = map.sourcesContent[i];
    }

    const iter = new StringCharIterator(map.mappings);
    let sourceURL = sources[sourceIndex];
    for (;;) {
      if (iter.peek() === ',') iter.next();
      else {
        while (iter.peek() === ';') {
          lineNumber += 1;
          columnNumber = 0;
          iter.next();
        }
        if (!iter.hasNext()) break;
      }

      columnNumber += decodeVLQ(iter);
      if (isSeparator(iter.peek())) {
        this.#mappings.push([lineNumber, columnNumber]);
        continue;
      }

      const sourceIndexDelta = decodeVLQ(iter);
      if (sourceIndexDelta) {
        sourceIndex += sourceIndexDelta;
        sourceURL = sources[sourceIndex];
      }
      sourceLineNumber += decodeVLQ(iter);
      sourceColumnNumber += decodeVLQ(iter);

      let name: string | undefined;
      if (!isSeparator(iter.peek())) {
        nameIndex += decodeVLQ(iter);
        name = map.names?.[nameIndex];
      }

      this.#mappings.push([lineNumber, columnNumber, sourceURL, sourceLineNumber, sourceColumnNumber, name]);
    }
  }
}

function isSeparator(char: string): boolean {
  return char === ',' || char === ';';
}

function decodeVLQ(iter: StringCharIterator): number {
  // Read the unsigned value.
  let result = 0;
  let shift = 0;
  let digit: number;
  do {
    digit = (base64Map as Record<string, number>)[iter.next()];
    result += (digit & VLQ_BASE_MASK) << shift;
    shift += VLQ_BASE_SHIFT;
  } while (digit & VLQ_CONTINUATION_MASK);

  // Fix the sign bit.
  const negative = result & 1;
  result >>>= 1;
  if (!negative) return result;
  return -result | (1 << 31);
}

/** Node's `Received …` suffix in `ERR_INVALID_ARG_TYPE` messages. */
function receivedType(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  const t = typeof value;
  if (t === 'string') return `type string ('${String(value)}')`;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return `type ${t} (${String(value)})`;
  return `type ${t}`;
}

function cloneSourceMapV3(payload: unknown): Record<string, unknown> {
  if (payload === null || typeof payload !== 'object') {
    throw Object.assign(
      new TypeError(`The "payload" argument must be of type object. Received ${receivedType(payload)}`),
      { code: 'ERR_INVALID_ARG_TYPE' },
    );
  }
  const clone = { ...(payload as Record<string, unknown>) };
  for (const key of Object.keys(clone)) {
    if (Array.isArray(clone[key])) clone[key] = (clone[key] as unknown[]).slice();
  }
  return clone;
}

function compareSourceMapEntry(entry1: Mapping, entry2: Mapping): number {
  const lineNumber1 = entry1[0] as number;
  const columnNumber1 = entry1[1] as number;
  const lineNumber2 = entry2[0] as number;
  const columnNumber2 = entry2[1] as number;
  if (lineNumber1 !== lineNumber2) return lineNumber1 - lineNumber2;
  return columnNumber1 - columnNumber2;
}
