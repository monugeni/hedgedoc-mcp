import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { HedgeDocClient } from "../hedgedoc-client.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

const execFileAsync = promisify(execFile);
export const EXPORT_DIR = "/tmp/hedgedoc-exports";

export function registerExportTools(server: McpServer, client: HedgeDocClient, downloadBaseUrl?: string) {
  server.tool(
    "export_note",
    "Export a note to a downloadable document (docx, odt, pdf, rtf, html). Converts Markdown content via pandoc. Returns a download URL valid for 10 minutes.",
    {
      noteId: z.string().describe("Note ID or alias"),
      format: z.enum(["docx", "odt", "pdf", "rtf", "html"]).default("docx").describe("Export format"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ noteId, format }) => {
      const markdown = await client.getContent(noteId);

      await mkdir(EXPORT_DIR, { recursive: true });

      const id = randomUUID().slice(0, 8);
      const filename = `${noteId}-${id}.${format}`;
      const outputPath = path.join(EXPORT_DIR, filename);
      const inputPath = path.join(EXPORT_DIR, `${noteId}-${id}.md`);

      await writeFile(inputPath, markdown, "utf-8");

      try {
        const args = [inputPath, "-o", outputPath, "--standalone"];
        if (format === "pdf") {
          args.push("--pdf-engine=weasyprint");
        }
        await execFileAsync("pandoc", args, { timeout: 30_000 });
      } catch (err: any) {
        await unlink(outputPath).catch(() => {});
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Export failed: ${err.message || err}` }],
        };
      } finally {
        await unlink(inputPath).catch(() => {});
      }

      setTimeout(() => unlink(outputPath).catch(() => {}), 10 * 60 * 1000);

      if (downloadBaseUrl) {
        const url = `${downloadBaseUrl}/downloads/${encodeURIComponent(filename)}`;
        return { content: [{ type: "text" as const, text: `Exported "${noteId}" as ${format.toUpperCase()}.\nDownload: ${url}` }] };
      }
      return { content: [{ type: "text" as const, text: `Exported "${noteId}" to ${outputPath}` }] };
    }
  );
}
