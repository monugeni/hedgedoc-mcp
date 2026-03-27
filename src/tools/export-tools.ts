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
export const EXPORT_FORMATS = ["docx", "odt", "pdf", "rtf", "html"] as const;
export const MENU_DOWNLOAD_FORMATS = ["md", "docx", "pdf"] as const;

export type ExportFormat = typeof EXPORT_FORMATS[number];
export type DownloadFormat = "md" | ExportFormat;

const DOWNLOAD_LABELS: Record<DownloadFormat, string> = {
  md: "Markdown",
  docx: "DOCX",
  odt: "ODT",
  pdf: "PDF",
  rtf: "RTF",
  html: "HTML",
};

export function isDownloadFormat(value: string): value is DownloadFormat {
  return value === "md" || EXPORT_FORMATS.includes(value as ExportFormat);
}

function sanitizeFilenamePart(value: string): string {
  const sanitized = value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return sanitized || "note";
}

export function buildDownloadUrl(downloadBaseUrl: string, noteId: string, format: DownloadFormat): string {
  return `${downloadBaseUrl}/notes/${encodeURIComponent(noteId)}/download/${format}`;
}

export function buildDownloadMenu(downloadBaseUrl: string | undefined, noteId: string): string | null {
  if (!downloadBaseUrl) {
    return null;
  }
  return MENU_DOWNLOAD_FORMATS
    .map((format) => `[${DOWNLOAD_LABELS[format]}](${buildDownloadUrl(downloadBaseUrl, noteId, format)})`)
    .join(" | ");
}

export function getDownloadFilename(noteId: string, format: DownloadFormat): string {
  return `${sanitizeFilenamePart(noteId)}.${format}`;
}

export async function exportMarkdownToFile(markdown: string, noteId: string, format: ExportFormat): Promise<{ outputPath: string; downloadName: string }> {
  await mkdir(EXPORT_DIR, { recursive: true });

  const id = randomUUID().slice(0, 8);
  const fileStem = `${sanitizeFilenamePart(noteId)}-${id}`;
  const outputPath = path.join(EXPORT_DIR, `${fileStem}.${format}`);
  const inputPath = path.join(EXPORT_DIR, `${fileStem}.md`);

  await writeFile(inputPath, markdown, "utf-8");

  try {
    const args = [inputPath, "-o", outputPath, "--standalone"];
    if (format === "pdf") {
      args.push("--pdf-engine=weasyprint");
    }
    await execFileAsync("pandoc", args, { timeout: 30_000 });
    return {
      outputPath,
      downloadName: getDownloadFilename(noteId, format),
    };
  } catch (err) {
    await unlink(outputPath).catch(() => {});
    throw err;
  } finally {
    await unlink(inputPath).catch(() => {});
  }
}

export function registerExportTools(server: McpServer, client: HedgeDocClient, downloadBaseUrl?: string) {
  server.tool(
    "export_note",
    "Export a note to a downloadable document (docx, odt, pdf, rtf, html). Converts Markdown content via pandoc. Returns a download URL valid for 10 minutes.",
    {
      noteId: z.string().describe("Note ID or alias"),
      format: z.enum(EXPORT_FORMATS).default("docx").describe("Export format"),
    },
    { readOnlyHint: true, destructiveHint: false },
    async ({ noteId, format }) => {
      if (downloadBaseUrl) {
        const url = buildDownloadUrl(downloadBaseUrl, noteId, format);
        return {
          content: [{
            type: "text" as const,
            text: `Download ${DOWNLOAD_LABELS[format]} for "${noteId}": ${url}`,
          }],
        };
      }

      const markdown = await client.getContent(noteId);

      try {
        const { outputPath } = await exportMarkdownToFile(markdown, noteId, format);
        setTimeout(() => unlink(outputPath).catch(() => {}), 10 * 60 * 1000);

        return { content: [{ type: "text" as const, text: `Exported "${noteId}" to ${outputPath}` }] };
      } catch (err: any) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Export failed: ${err.message || err}` }],
        };
      }
    }
  );
}
