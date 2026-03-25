import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HedgeDocClient } from "../hedgedoc-client.js";

export function registerContentTools(server: McpServer, client: HedgeDocClient, publicUrl: string) {
  const noteUrl = (id: string) => `${publicUrl}/${id}`;

  server.tool(
    "get_text",
    "Read the Markdown content of a HedgeDoc note. Returns the raw Markdown source and a link to the note.",
    {
      noteId: z.string().describe("Note ID or alias"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ noteId }) => {
      const content = await client.getContent(noteId);
      return {
        content: [{ type: "text", text: `${noteUrl(noteId)}\n${content}` }],
      };
    }
  );

  server.tool(
    "edit_text",
    "Make a surgical edit to a note by replacing a specific section of text. Finds the exact old_text in the note and replaces it with new_text. Use this instead of set_text for modifications.",
    {
      noteId: z.string().describe("Note ID or alias"),
      old_text: z.string().describe("Exact text to find in the note (must match precisely)"),
      new_text: z.string().describe("Replacement text"),
    },
    { readOnlyHint: false, destructiveHint: false },
    async ({ noteId, old_text, new_text }) => {
      const current = await client.getContent(noteId);
      const idx = current.indexOf(old_text);
      if (idx === -1) {
        return {
          isError: true,
          content: [{ type: "text", text: `Could not find the specified text in note "${noteId}". Read the note again with get_text to see the current content.` }],
        };
      }
      const secondIdx = current.indexOf(old_text, idx + 1);
      if (secondIdx !== -1) {
        return {
          isError: true,
          content: [{ type: "text", text: `The specified text appears multiple times in note "${noteId}". Provide a longer, unique snippet to match exactly one location.` }],
        };
      }
      const updated = current.substring(0, idx) + new_text + current.substring(idx + old_text.length);
      await client.updateContent(noteId, updated);
      return {
        content: [{ type: "text", text: `Edit applied to note "${noteId}".` }],
      };
    }
  );

  server.tool(
    "set_text",
    "Replace the entire content of a note. Only use this for writing a completely new document — use edit_text for modifications. Write content in Markdown format.",
    {
      noteId: z.string().describe("Note ID or alias"),
      content: z.string().describe("New Markdown content"),
    },
    { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
    async ({ noteId, content }) => {
      await client.updateContent(noteId, content);
      return {
        content: [{ type: "text", text: `Note "${noteId}" updated.` }],
      };
    }
  );

  server.tool(
    "append_text",
    "Append text to the end of a note.",
    {
      noteId: z.string().describe("Note ID or alias"),
      text: z.string().describe("Markdown text to append"),
    },
    { readOnlyHint: false, destructiveHint: false },
    async ({ noteId, text }) => {
      const current = await client.getContent(noteId);
      const updated = current.endsWith("\n") ? current + text : current + "\n" + text;
      await client.updateContent(noteId, updated);
      return {
        content: [{ type: "text", text: `Text appended to note "${noteId}".` }],
      };
    }
  );

  server.tool(
    "get_note_info",
    "Get metadata about a note: title, creation date, last modified, view count, etc.",
    {
      noteId: z.string().describe("Note ID or alias"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ noteId }) => {
      const info = await client.getNoteInfo(noteId);
      return {
        content: [{ type: "text", text: JSON.stringify(info, null, 2) }],
      };
    }
  );

  server.tool(
    "get_revisions",
    "List available revisions for a note.",
    {
      noteId: z.string().describe("Note ID or alias"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ noteId }) => {
      const revisions = await client.getRevisions(noteId);
      return {
        content: [{ type: "text", text: JSON.stringify(revisions, null, 2) }],
      };
    }
  );
}
