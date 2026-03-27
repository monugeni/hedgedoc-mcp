import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HedgeDocClient } from "../hedgedoc-client.js";
import { buildDownloadMenu } from "./export-tools.js";

export function registerNoteTools(server: McpServer, client: HedgeDocClient, publicUrl: string, downloadBaseUrl?: string) {
  const noteUrl = (id: string) => `${publicUrl}/${id}`;
  const noteLinks = (id: string) => {
    const downloads = buildDownloadMenu(downloadBaseUrl, id);
    return downloads ? `Note: ${noteUrl(id)}\nDownloads: ${downloads}` : `Note: ${noteUrl(id)}`;
  };

  server.tool(
    "create_note",
    "Create a new HedgeDoc note with Markdown content. Optionally specify an alias for a human-readable URL (requires CMD_ALLOW_FREEURL=true).",
    {
      content: z.string().describe("Markdown content for the new note"),
      alias: z.string().optional().describe("Custom URL alias (e.g. 'meeting-notes-2026-03')"),
    },
    { readOnlyHint: false, destructiveHint: false },
    async ({ content, alias }) => {
      const id = await client.createNote(content, alias);
      return {
        content: [{ type: "text", text: `Note created.\n${noteLinks(id)}` }],
      };
    }
  );

  server.tool(
    "delete_note",
    "Permanently delete a HedgeDoc note.",
    {
      noteId: z.string().describe("Note ID or alias"),
    },
    { readOnlyHint: false, destructiveHint: true },
    async ({ noteId }) => {
      await client.deleteNote(noteId);
      return {
        content: [{ type: "text", text: `Note "${noteId}" deleted.` }],
      };
    }
  );

  server.tool(
    "rename_note",
    "Rename a note by setting or changing its URL alias.",
    {
      noteId: z.string().describe("Current note ID or alias"),
      newAlias: z.string().describe("New URL alias (e.g. 'weekly-standup-notes')"),
    },
    { readOnlyHint: false, destructiveHint: false },
    async ({ noteId, newAlias }) => {
      await client.renameNote(noteId, newAlias);
      return {
        content: [{ type: "text", text: `Note renamed to "${newAlias}".\n${noteLinks(newAlias)}` }],
      };
    }
  );

  server.tool(
    "list_notes",
    "List all HedgeDoc notes with their IDs, aliases, titles, and last-modified dates.",
    {},
    { readOnlyHint: true, destructiveHint: false },
    async () => {
      const notes = await client.listNotes();
      if (notes.length === 0) {
        return { content: [{ type: "text", text: "No notes found." }] };
      }
      const lines = notes.map((n) => {
        const name = n.alias || n.id;
        const downloads = buildDownloadMenu(downloadBaseUrl, name);
        const suffix = downloads ? ` — ${downloads}` : "";
        return `- [${n.title || "(untitled)"}](${noteUrl(name)}) — ${name} — ${new Date(n.lastchangeAt).toISOString()}${suffix}`;
      });
      return {
        content: [{ type: "text", text: lines.join("\n") }],
      };
    }
  );
}
