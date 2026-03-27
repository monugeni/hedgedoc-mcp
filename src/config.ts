export interface Config {
  /** Internal HedgeDoc URL — only used for the startup health check. Optional. */
  hedgedocUrl?: string;
  /** Public-facing HedgeDoc URL used in note links returned to the user. */
  hedgedocPublicUrl: string;
  /** Public-facing MCP URL used for browser download links. */
  mcpPublicUrl?: string;
  databaseUrl: string;
  port: number;
  host: string;
  mcpApiKey?: string;
  transport: "http" | "stdio";
}

export function loadConfig(): Config {
  const hedgedocUrl = process.env.HEDGEDOC_URL;
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const hedgedocPublicUrl = process.env.HEDGEDOC_PUBLIC_URL || hedgedocUrl;
  if (!hedgedocPublicUrl) {
    throw new Error(
      "HEDGEDOC_PUBLIC_URL (or HEDGEDOC_URL) environment variable is required for generating note links"
    );
  }

  const transport = process.env.TRANSPORT ?? "http";
  if (transport !== "http" && transport !== "stdio") {
    throw new Error('TRANSPORT must be "http" or "stdio"');
  }

  return {
    hedgedocUrl: hedgedocUrl?.replace(/\/+$/, ""),
    hedgedocPublicUrl: hedgedocPublicUrl.replace(/\/+$/, ""),
    mcpPublicUrl: process.env.MCP_PUBLIC_URL?.replace(/\/+$/, "") || undefined,
    databaseUrl,
    port: parseInt(process.env.PORT || "8211", 10),
    host: process.env.HOST || "0.0.0.0",
    mcpApiKey: process.env.MCP_API_KEY || undefined,
    transport,
  };
}
