import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HedgeDocClient } from "../hedgedoc-client.js";
import {
  parseOutline,
  formatOutline,
  extractSection,
  readLineRange,
  searchContent,
  replaceLineRange,
  insertAfterHeading,
  applyLineRangeEdits,
  applyStringMatchEdits,
} from "../markdown-utils.js";

export function registerSmartEditTools(server: McpServer, client: HedgeDocClient) {

  // ── Read tools (cheap, targeted) ──────────────────────────────────────

  server.tool(
    "get_outline",
    "Get the heading structure of a note with line numbers for each section. Use this to orient yourself in a document before reading or editing — far cheaper than reading the full text.",
    {
      noteId: z.string().describe("Note ID or alias"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ noteId }) => {
      const content = await client.getContent(noteId);
      const outline = parseOutline(content);
      return {
        content: [{ type: "text", text: formatOutline(outline) }],
      };
    },
  );

  server.tool(
    "get_section",
    "Read only the content under a specific heading, down to the next heading of same or higher level. Returns line-numbered text suitable for edit_by_line_range. Much cheaper than reading the full document.",
    {
      noteId: z.string().describe("Note ID or alias"),
      heading: z.string().describe("Heading text to find (case-insensitive substring match, e.g. 'Vendor Approval' or 'Summary Table')"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ noteId, heading }) => {
      const content = await client.getContent(noteId);
      const section = extractSection(content, heading);
      if (!section) {
        const outline = parseOutline(content);
        return {
          isError: true,
          content: [{
            type: "text",
            text: `No heading matching "${heading}" found. Available headings:\n${formatOutline(outline)}`,
          }],
        };
      }
      const lines = section.content.split("\n");
      const numbered = lines
        .map((line, i) => `${(section.lineStart + i).toString().padStart(4)}| ${line}`)
        .join("\n");
      return {
        content: [{
          type: "text",
          text: `"${section.heading}" [lines ${section.lineStart}-${section.lineEnd}]\n\n${numbered}`,
        }],
      };
    },
  );

  server.tool(
    "read_lines",
    "Read a specific line range from a note with line numbers. Use after get_outline or search_in_note to read exactly the lines you need.",
    {
      noteId: z.string().describe("Note ID or alias"),
      start: z.number().int().min(1).describe("Start line (1-based, inclusive)"),
      end: z.number().int().min(1).describe("End line (1-based, inclusive)"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ noteId, start, end }) => {
      const content = await client.getContent(noteId);
      const totalLines = content.split("\n").length;
      const result = readLineRange(content, start, end);
      return {
        content: [{
          type: "text",
          text: `Lines ${start}-${Math.min(end, totalLines)} of ${totalLines}\n\n${result}`,
        }],
      };
    },
  );

  server.tool(
    "search_in_note",
    "Search for text in a note. Returns matching lines with line numbers and surrounding context, like grep. Use to locate content without reading the full document.",
    {
      noteId: z.string().describe("Note ID or alias"),
      query: z.string().describe("Text to search for (case-insensitive)"),
      context_lines: z.number().int().min(0).max(10).default(2)
        .describe("Lines of context before/after each match (default 2)"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ noteId, query, context_lines }) => {
      const content = await client.getContent(noteId);
      const { formatted, totalMatches } = searchContent(content, query, context_lines);
      if (totalMatches === 0) {
        return {
          content: [{ type: "text", text: `No matches for "${query}".` }],
        };
      }
      return {
        content: [{
          type: "text",
          text: `${totalMatches} match${totalMatches !== 1 ? "es" : ""}\n\n${formatted}`,
        }],
      };
    },
  );

  // ── Write tools (efficient, no echoing) ───────────────────────────────

  server.tool(
    "edit_by_line_range",
    "Replace a range of lines with new content. Line numbers come from get_outline, get_section, read_lines, or search_in_note. You only send the new text — no need to echo the old content back. To delete lines, pass empty string as new_text.",
    {
      noteId: z.string().describe("Note ID or alias"),
      start: z.number().int().min(1).describe("First line to replace (1-based, inclusive)"),
      end: z.number().int().min(1).describe("Last line to replace (1-based, inclusive)"),
      new_text: z.string().describe("Replacement text (empty string to delete the lines)"),
    },
    { readOnlyHint: false, destructiveHint: false },
    async ({ noteId, start, end, new_text }) => {
      const content = await client.getContent(noteId);
      try {
        const result = replaceLineRange(content, start, end, new_text);
        await client.updateContent(noteId, result.content);
        const replacedCount = Math.min(end, result.oldLineCount) - start + 1;
        const insertedCount = new_text === "" ? 0 : new_text.split("\n").length;
        return {
          content: [{
            type: "text",
            text: `Replaced lines ${start}-${Math.min(end, result.oldLineCount)} (${replacedCount} lines) with ${insertedCount} lines. Document: ${result.oldLineCount} → ${result.newLineCount} lines.`,
          }],
        };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text", text: err.message }],
        };
      }
    },
  );

  server.tool(
    "insert_after_heading",
    "Insert text at a section boundary identified by heading. Use 'end' to append at the end of the section (e.g. add table rows), or 'beginning' to insert right after the heading line.",
    {
      noteId: z.string().describe("Note ID or alias"),
      heading: z.string().describe("Heading text to find (case-insensitive substring match)"),
      text: z.string().describe("Text to insert"),
      position: z.enum(["beginning", "end"]).default("end")
        .describe("'beginning' = right after the heading line; 'end' = after the last line of the section (default)"),
    },
    { readOnlyHint: false, destructiveHint: false },
    async ({ noteId, heading, text, position }) => {
      const content = await client.getContent(noteId);
      const result = insertAfterHeading(content, heading, text, position);
      if (!result) {
        const outline = parseOutline(content);
        return {
          isError: true,
          content: [{
            type: "text",
            text: `No heading matching "${heading}" found. Available headings:\n${formatOutline(outline)}`,
          }],
        };
      }
      await client.updateContent(noteId, result.content);
      const insertedLines = text.split("\n").length;
      return {
        content: [{
          type: "text",
          text: `Inserted ${insertedLines} line${insertedLines !== 1 ? "s" : ""} at line ${result.insertedAtLine} (${position} of "${result.heading}").`,
        }],
      };
    },
  );

  server.tool(
    "batch_edit",
    "Apply multiple edits in a single call. Supports line_range edits (all line numbers refer to the ORIGINAL document — applied bottom-to-top) and string_match edits (applied sequentially after line edits). One round trip instead of N.",
    {
      noteId: z.string().describe("Note ID or alias"),
      edits: z.array(
        z.discriminatedUnion("type", [
          z.object({
            type: z.literal("line_range"),
            start: z.number().int().min(1).describe("First line to replace (1-based)"),
            end: z.number().int().min(1).describe("Last line to replace (1-based)"),
            new_text: z.string().describe("Replacement text (empty to delete)"),
          }),
          z.object({
            type: z.literal("string_match"),
            old_text: z.string().describe("Exact text to find"),
            new_text: z.string().describe("Replacement text"),
          }),
        ]),
      ).min(1).describe("Array of edit operations"),
    },
    { readOnlyHint: false, destructiveHint: false },
    async ({ noteId, edits }) => {
      let content = await client.getContent(noteId);
      const originalLineCount = content.split("\n").length;
      const report: string[] = [];

      const lineEdits = edits.filter((e): e is typeof e & { type: "line_range" } => e.type === "line_range");
      const stringEdits = edits.filter((e): e is typeof e & { type: "string_match" } => e.type === "string_match");

      if (lineEdits.length > 0) {
        try {
          const result = applyLineRangeEdits(content, lineEdits);
          content = result.content;
          report.push(`${lineEdits.length} line-range edit${lineEdits.length !== 1 ? "s" : ""} applied`);
        } catch (err: any) {
          return { isError: true, content: [{ type: "text", text: `Line-range error: ${err.message}` }] };
        }
      }

      if (stringEdits.length > 0) {
        const result = applyStringMatchEdits(content, stringEdits);
        content = result.content;
        if (result.appliedCount > 0) {
          report.push(`${result.appliedCount} string-match edit${result.appliedCount !== 1 ? "s" : ""} applied`);
        }
        if (result.errors.length > 0) {
          report.push(`Errors: ${result.errors.join("; ")}`);
        }
      }

      await client.updateContent(noteId, content);
      const newLineCount = content.split("\n").length;
      report.push(`Document: ${originalLineCount} → ${newLineCount} lines`);

      return {
        content: [{ type: "text", text: report.join(". ") + "." }],
      };
    },
  );
}
