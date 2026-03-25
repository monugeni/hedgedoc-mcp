import express from "express";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { HedgeDocClient } from "./hedgedoc-client.js";
import { createServer } from "./server.js";
import { loadConfig } from "./config.js";
import { EXPORT_DIR } from "./tools/export-tools.js";

const config = loadConfig();
const client = new HedgeDocClient(config.hedgedocUrl, config.databaseUrl);

// Wait for HedgeDoc to be ready
for (let attempt = 1; ; attempt++) {
  try {
    await client.healthCheck();
    console.error("Connected to HedgeDoc at", config.hedgedocUrl);
    break;
  } catch (err) {
    if (attempt >= 30) {
      console.error("Failed to connect to HedgeDoc after 30 attempts:", err);
      process.exit(1);
    }
    console.error(`Waiting for HedgeDoc (attempt ${attempt}/30)...`);
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// Create bot user for authorship tracking
const botName = process.env.AUTHOR_NAME || "Claude";
const botUserId = await client.ensureBotUser(botName);
console.error(`Registered bot user "${botName}" (${botUserId})`);

const transportArg = process.argv.includes("--stdio")
  ? "stdio"
  : process.argv.includes("--http")
    ? "http"
    : config.transport;

const epUrl = new URL(config.hedgedocPublicUrl);
const mcpPublicUrl = `${epUrl.protocol}//${epUrl.hostname}:${config.port}`;

if (transportArg === "stdio") {
  const server = createServer(client, config.hedgedocPublicUrl);
  const stdioTransport = new StdioServerTransport();
  await server.connect(stdioTransport);
  console.error("HedgeDoc MCP server running on stdio");
} else {
  const app = express();
  app.use(express.json());

  if (config.mcpApiKey) {
    app.use("/mcp", (req, res, next) => {
      const auth = req.headers.authorization;
      if (auth !== `Bearer ${config.mcpApiKey}`) {
        res.status(401).json({ error: "Unauthorized" });
        return;
      }
      next();
    });
  }

  const sessions = new Map<string, { transport: StreamableHTTPServerTransport; server: ReturnType<typeof createServer> }>();

  app.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (id) => {
        sessions.set(id, { transport, server });
        console.error(`Session initialized: ${id}`);
      },
    });

    const server = createServer(client, config.hedgedocPublicUrl, mcpPublicUrl);

    transport.onclose = () => {
      const id = transport.sessionId;
      if (id) sessions.delete(id);
      console.error(`Session closed: ${id}`);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  app.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  });

  app.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    if (!sessionId || !sessions.has(sessionId)) {
      res.status(400).json({ error: "Invalid or missing session ID" });
      return;
    }
    const session = sessions.get(sessionId)!;
    await session.transport.handleRequest(req, res);
  });

  app.get("/downloads/:filename", (req, res) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(EXPORT_DIR, filename);
    if (!existsSync(filePath)) {
      res.status(404).json({ error: "File not found or expired" });
      return;
    }
    res.download(filePath, filename);
  });

  app.get("/health", async (_req, res) => {
    try {
      await client.healthCheck();
      res.json({ status: "ok", hedgedoc: config.hedgedocUrl });
    } catch {
      res.status(503).json({ status: "error", message: "Cannot reach HedgeDoc" });
    }
  });

  app.listen(config.port, config.host, () => {
    console.error(`HedgeDoc MCP server listening on http://${config.host}:${config.port}/mcp`);
  });
}
