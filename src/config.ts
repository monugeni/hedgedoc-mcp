export interface Config {
  hedgedocUrl: string;
  hedgedocPublicUrl: string;
  databaseUrl: string;
  port: number;
  host: string;
  mcpApiKey?: string;
  transport: "http" | "stdio";
}

export function loadConfig(): Config {
  const hedgedocUrl = process.env.HEDGEDOC_URL;
  const databaseUrl = process.env.DATABASE_URL;

  if (!hedgedocUrl) {
    throw new Error("HEDGEDOC_URL environment variable is required");
  }
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const transport = process.env.TRANSPORT ?? "http";
  if (transport !== "http" && transport !== "stdio") {
    throw new Error('TRANSPORT must be "http" or "stdio"');
  }

  const hedgedocPublicUrl = (process.env.HEDGEDOC_PUBLIC_URL || hedgedocUrl).replace(/\/+$/, "");

  return {
    hedgedocUrl: hedgedocUrl.replace(/\/+$/, ""),
    hedgedocPublicUrl,
    databaseUrl,
    port: parseInt(process.env.PORT || "8211", 10),
    host: process.env.HOST || "0.0.0.0",
    mcpApiKey: process.env.MCP_API_KEY || undefined,
    transport,
  };
}
