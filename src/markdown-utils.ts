export interface HeadingInfo {
  level: number;
  text: string;
  lineStart: number;
  lineEnd: number;
}

export interface OutlineResult {
  headings: HeadingInfo[];
  totalLines: number;
}

export interface SectionResult {
  heading: string;
  level: number;
  lineStart: number;
  lineEnd: number;
  content: string;
}

/**
 * Parse markdown headings and compute their section ranges.
 * Each heading's lineEnd is the last line before the next same-or-higher-level heading,
 * or end of document.
 */
export function parseOutline(content: string): OutlineResult {
  const lines = content.split("\n");
  const headings: HeadingInfo[] = [];

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      headings.push({
        level: match[1].length,
        text: match[2].trim(),
        lineStart: i + 1,
        lineEnd: lines.length,
      });
    }
  }

  for (let i = 0; i < headings.length; i++) {
    for (let j = i + 1; j < headings.length; j++) {
      if (headings[j].level <= headings[i].level) {
        headings[i].lineEnd = headings[j].lineStart - 1;
        break;
      }
    }
  }

  return { headings, totalLines: lines.length };
}

export function formatOutline(outline: OutlineResult): string {
  const parts: string[] = [`${outline.totalLines} lines total`, ""];
  for (const h of outline.headings) {
    const indent = "  ".repeat(h.level - 1);
    const hashes = "#".repeat(h.level);
    parts.push(`${indent}${hashes} ${h.text} [${h.lineStart}-${h.lineEnd}]`);
  }
  return parts.join("\n");
}

export function findHeading(headings: HeadingInfo[], query: string): HeadingInfo | undefined {
  const q = query.replace(/^#+\s*/, "").trim().toLowerCase();
  return (
    headings.find(h => h.text.toLowerCase() === q) ||
    headings.find(h => h.text.toLowerCase().includes(q))
  );
}

export function extractSection(content: string, headingQuery: string): SectionResult | null {
  const { headings } = parseOutline(content);
  const heading = findHeading(headings, headingQuery);
  if (!heading) return null;

  const lines = content.split("\n");
  const sectionLines = lines.slice(heading.lineStart - 1, heading.lineEnd);

  return {
    heading: heading.text,
    level: heading.level,
    lineStart: heading.lineStart,
    lineEnd: heading.lineEnd,
    content: sectionLines.join("\n"),
  };
}

export function readLineRange(content: string, start: number, end: number): string {
  const lines = content.split("\n");
  const s = Math.max(1, start);
  const e = Math.min(lines.length, end);
  const result: string[] = [];
  for (let i = s - 1; i < e; i++) {
    result.push(`${(i + 1).toString().padStart(4)}| ${lines[i]}`);
  }
  return result.join("\n");
}

/**
 * Grep-like search. Returns formatted output with matching lines marked by `>`,
 * grouped into context blocks separated by `---`.
 */
export function searchContent(content: string, query: string, contextLines: number = 2): { formatted: string; totalMatches: number } {
  const lines = content.split("\n");
  const queryLower = query.toLowerCase();
  const matchLineNums: number[] = [];

  for (let i = 0; i < lines.length; i++) {
    if (lines[i].toLowerCase().includes(queryLower)) {
      matchLineNums.push(i + 1);
    }
  }

  if (matchLineNums.length === 0) return { formatted: "", totalMatches: 0 };

  const blocks: { start: number; end: number; matchLines: Set<number> }[] = [];
  for (const ln of matchLineNums) {
    const s = Math.max(1, ln - contextLines);
    const e = Math.min(lines.length, ln + contextLines);
    const last = blocks[blocks.length - 1];
    if (last && s <= last.end + 1) {
      last.end = e;
      last.matchLines.add(ln);
    } else {
      blocks.push({ start: s, end: e, matchLines: new Set([ln]) });
    }
  }

  const formatted = blocks.map(b => {
    const out: string[] = [];
    for (let i = b.start; i <= b.end; i++) {
      const prefix = b.matchLines.has(i) ? ">" : " ";
      out.push(`${prefix}${i.toString().padStart(4)}| ${lines[i - 1]}`);
    }
    return out.join("\n");
  }).join("\n ---\n");

  return { formatted, totalMatches: matchLineNums.length };
}

export function replaceLineRange(
  content: string,
  start: number,
  end: number,
  newText: string,
): { content: string; oldLineCount: number; newLineCount: number } {
  const lines = content.split("\n");
  const oldLineCount = lines.length;

  if (start < 1 || start > lines.length) {
    throw new Error(`Invalid start line ${start} (document has ${lines.length} lines)`);
  }
  if (end < start) {
    throw new Error(`end (${end}) must be >= start (${start})`);
  }

  const clampedEnd = Math.min(end, lines.length);
  const newLines = newText === "" ? [] : newText.split("\n");
  lines.splice(start - 1, clampedEnd - start + 1, ...newLines);

  return { content: lines.join("\n"), oldLineCount, newLineCount: lines.length };
}

export function insertAfterHeading(
  content: string,
  headingQuery: string,
  text: string,
  position: "beginning" | "end" = "end",
): { content: string; insertedAtLine: number; heading: string } | null {
  const { headings } = parseOutline(content);
  const heading = findHeading(headings, headingQuery);
  if (!heading) return null;

  const lines = content.split("\n");
  // "beginning" = right after the heading line; "end" = after the last line of the section
  const insertIdx = position === "beginning" ? heading.lineStart : heading.lineEnd;
  const newLines = text.split("\n");
  lines.splice(insertIdx, 0, ...newLines);

  return {
    content: lines.join("\n"),
    insertedAtLine: insertIdx + 1,
    heading: heading.text,
  };
}

/**
 * Apply multiple line-range edits to content. All line numbers refer to the ORIGINAL
 * document — edits are applied bottom-to-top so they don't shift each other.
 * Overlapping ranges are rejected.
 */
export function applyLineRangeEdits(
  content: string,
  edits: { start: number; end: number; new_text: string }[],
): { content: string; oldLineCount: number; newLineCount: number } {
  const lines = content.split("\n");
  const oldLineCount = lines.length;

  const sorted = [...edits].sort((a, b) => b.start - a.start);
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].start <= sorted[i + 1].end) {
      throw new Error(
        `Overlapping line ranges: [${sorted[i + 1].start}-${sorted[i + 1].end}] and [${sorted[i].start}-${sorted[i].end}]`,
      );
    }
  }

  for (const edit of sorted) {
    if (edit.start < 1 || edit.start > lines.length) {
      throw new Error(`Invalid start line ${edit.start} (document has ${lines.length} lines)`);
    }
    const clampedEnd = Math.min(edit.end, lines.length);
    const newLines = edit.new_text === "" ? [] : edit.new_text.split("\n");
    lines.splice(edit.start - 1, clampedEnd - edit.start + 1, ...newLines);
  }

  return { content: lines.join("\n"), oldLineCount, newLineCount: lines.length };
}

/**
 * Apply multiple string-match edits sequentially.
 */
export function applyStringMatchEdits(
  content: string,
  edits: { old_text: string; new_text: string }[],
): { content: string; appliedCount: number; errors: string[] } {
  let current = content;
  let appliedCount = 0;
  const errors: string[] = [];

  for (let i = 0; i < edits.length; i++) {
    const { old_text, new_text } = edits[i];
    const idx = current.indexOf(old_text);
    if (idx === -1) {
      errors.push(`Edit ${i + 1}: text not found`);
      continue;
    }
    const secondIdx = current.indexOf(old_text, idx + 1);
    if (secondIdx !== -1) {
      errors.push(`Edit ${i + 1}: text matches multiple locations — use a longer/unique snippet`);
      continue;
    }
    current = current.substring(0, idx) + new_text + current.substring(idx + old_text.length);
    appliedCount++;
  }

  return { content: current, appliedCount, errors };
}
