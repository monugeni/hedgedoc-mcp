import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { HedgeDocClient } from "./hedgedoc-client.js";
import { registerNoteTools } from "./tools/note-tools.js";
import { registerContentTools } from "./tools/content-tools.js";
import { registerExportTools } from "./tools/export-tools.js";

export function createServer(client: HedgeDocClient, publicUrl: string, downloadBaseUrl?: string): McpServer {
  const server = new McpServer({
    name: "hedgedoc-mcp",
    version: "1.0.0",
  });

  registerNoteTools(server, client, publicUrl);
  registerContentTools(server, client, publicUrl);
  registerExportTools(server, client, downloadBaseUrl);

  return server;
}
