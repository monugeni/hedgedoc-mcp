import pg from "pg";

export interface NoteInfo {
  id: string;
  alias: string | null;
  title: string;
  lastchangeAt: Date;
}

export class HedgeDocClient {
  private baseUrl: string;
  private pool: pg.Pool;

  constructor(baseUrl: string, databaseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.pool = new pg.Pool({ connectionString: databaseUrl });
  }

  /** Check that HedgeDoc is responding. */
  async healthCheck(): Promise<void> {
    const res = await fetch(`${this.baseUrl}/status`);
    if (!res.ok) throw new Error(`HedgeDoc status ${res.status}`);
  }

  /**
   * Create a new note. Returns the note shortid or alias.
   * If alias is provided and CMD_ALLOW_FREEURL is enabled, the note is
   * created at that path.
   */
  async createNote(content: string, alias?: string): Promise<string> {
    const url = alias
      ? `${this.baseUrl}/new/${encodeURIComponent(alias)}`
      : `${this.baseUrl}/new`;

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/markdown" },
      body: content,
      redirect: "manual",
    });

    // HedgeDoc responds with a 302 redirect to the new note
    const location = res.headers.get("location");
    if (location) {
      // location is like "/<shortid>" or "/<alias>"
      const id = location.replace(/^\/+/, "").split("/")[0];
      return id || (alias ?? "unknown");
    }

    // Some versions return 200 with the URL in the body
    if (res.ok) {
      const body = await res.text();
      const match = body.match(/\/([A-Za-z0-9_-]+)$/);
      return match ? match[1] : (alias ?? "unknown");
    }

    throw new Error(`Failed to create note: HTTP ${res.status}`);
  }

  /** Get the raw Markdown content of a note. */
  async getContent(noteId: string): Promise<string> {
    const res = await fetch(`${this.baseUrl}/${encodeURIComponent(noteId)}/download`);
    if (!res.ok) {
      throw new Error(`Failed to get note "${noteId}": HTTP ${res.status}`);
    }
    return res.text();
  }

  /** Get note metadata via HedgeDoc REST API. */
  async getNoteInfo(noteId: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/${encodeURIComponent(noteId)}/info`);
    if (!res.ok) {
      throw new Error(`Failed to get note info "${noteId}": HTTP ${res.status}`);
    }
    return res.json();
  }

  /** Get revision list for a note. */
  async getRevisions(noteId: string): Promise<any[]> {
    const res = await fetch(`${this.baseUrl}/${encodeURIComponent(noteId)}/revision`);
    if (!res.ok) {
      throw new Error(`Failed to get revisions for "${noteId}": HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.revision ?? data;
  }

  /**
   * Update note content via direct database access.
   * HedgeDoc 1.x REST API has no PUT endpoint for content, so we
   * update the Notes table directly in PostgreSQL.
   */
  async updateContent(noteId: string, content: string): Promise<void> {
    const titleMatch = content.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : content.split("\n")[0].slice(0, 100);

    const result = await this.pool.query(
      `UPDATE "Notes"
       SET content = $1, title = $2, "lastchangeAt" = NOW(), "updatedAt" = NOW()
       WHERE shortid = $3 OR alias = $3`,
      [content, title, noteId]
    );
    if (result.rowCount === 0) {
      throw new Error(`Note "${noteId}" not found`);
    }
  }

  /** Delete a note via direct database access. */
  async deleteNote(noteId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM "Notes" WHERE shortid = $1 OR alias = $1`,
      [noteId]
    );
    if (result.rowCount === 0) {
      throw new Error(`Note "${noteId}" not found`);
    }
  }

  /** List all notes from the database. */
  async listNotes(): Promise<NoteInfo[]> {
    const result = await this.pool.query(
      `SELECT shortid AS id, alias, title, "lastchangeAt" FROM "Notes" ORDER BY "lastchangeAt" DESC`
    );
    return result.rows;
  }
}
