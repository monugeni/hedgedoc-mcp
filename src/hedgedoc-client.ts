import pg from "pg";

export interface NoteInfo {
  id: string;
  alias: string | null;
  title: string;
  lastchangeAt: Date;
}

/**
 * Authorship entry: [userId, startPos, endPos, createdAtMs, updatedAtMs]
 * Tracks which user wrote which character range.
 */
type AuthorshipEntry = [string, number, number, number, number];

export class HedgeDocClient {
  private baseUrl: string;
  private pool: pg.Pool;
  private botUserId: string | null = null;

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
   * Ensure a bot User row exists in the database for authorship tracking.
   * Returns the user's UUID. Creates the user if it doesn't exist.
   */
  async ensureBotUser(displayName: string): Promise<string> {
    if (this.botUserId) return this.botUserId;

    const email = `${displayName.toLowerCase().replace(/\s+/g, "-")}@mcp.local`;

    // Check if user exists
    const existing = await this.pool.query(
      `SELECT id FROM "Users" WHERE email = $1`,
      [email]
    );
    if (existing.rows.length > 0) {
      this.botUserId = existing.rows[0].id;
      return this.botUserId!;
    }

    // Create bot user
    const result = await this.pool.query(
      `INSERT INTO "Users" (id, profileid, profile, email, "createdAt", "updatedAt")
       VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
       RETURNING id`,
      [
        `mcp-${displayName}`,
        JSON.stringify({ name: displayName, photo: "" }),
        email,
      ]
    );
    this.botUserId = result.rows[0].id;
    return this.botUserId!;
  }

  /**
   * Create a new note. Returns the note shortid or alias.
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

    const location = res.headers.get("location");
    if (location) {
      const id = location.replace(/^\/+/, "").split("/")[0];
      return id || (alias ?? "unknown");
    }

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
   * Update note content with proper authorship tracking.
   *
   * How it works:
   * 1. Reads current content + authorship from the Notes table
   * 2. Computes which character ranges changed
   * 3. Updates the authorship array to attribute changed ranges to the bot user
   * 4. Writes content + authorship + lastchangeuserId back
   * 5. HedgeDoc's background job (saveAllNotesRevision) auto-creates a
   *    revision entry within ~5 minutes, so the change shows in history
   */
  async updateContent(noteId: string, newContent: string): Promise<void> {
    const botId = this.botUserId;
    if (!botId) throw new Error("Bot user not initialized. Call ensureBotUser() first.");

    // Read current state
    const current = await this.pool.query(
      `SELECT id, content, authorship FROM "Notes" WHERE shortid = $1 OR alias = $1`,
      [noteId]
    );
    if (current.rows.length === 0) {
      throw new Error(`Note "${noteId}" not found`);
    }

    const row = current.rows[0];
    const oldContent: string = row.content || "";
    const oldAuthorship: AuthorshipEntry[] = row.authorship
      ? (typeof row.authorship === "string" ? JSON.parse(row.authorship) : row.authorship)
      : [];

    // Compute new authorship
    const now = Date.now();
    const newAuthorship = this.computeAuthorship(oldContent, newContent, oldAuthorship, botId, now);

    // Extract title from markdown
    const titleMatch = newContent.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : newContent.split("\n")[0].slice(0, 100);

    // Ensure Author row exists (for color assignment in editor)
    await this.pool.query(
      `INSERT INTO "Authors" ("noteId", "userId", color, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, NOW(), NOW())
       ON CONFLICT ("noteId", "userId") DO NOTHING`,
      [row.id, botId, "#4dabf7"]
    );

    // Update the note
    await this.pool.query(
      `UPDATE "Notes"
       SET content = $1,
           title = $2,
           authorship = $3,
           "lastchangeAt" = NOW(),
           "lastchangeuserId" = $4,
           "updatedAt" = NOW()
       WHERE id = $5`,
      [newContent, title, JSON.stringify(newAuthorship), botId, row.id]
    );
  }

  /**
   * Compute updated authorship array after a content change.
   *
   * For a surgical edit (old_text → new_text at a known position):
   * - Entries before the change: unchanged
   * - Entries overlapping the change: trimmed/split, changed range attributed to bot
   * - Entries after the change: positions shifted by the length delta
   *
   * For a full replacement: entire document attributed to bot.
   */
  private computeAuthorship(
    oldContent: string,
    newContent: string,
    oldAuthorship: AuthorshipEntry[],
    botId: string,
    now: number
  ): AuthorshipEntry[] {
    // Find the common prefix and suffix to locate the changed region
    let prefixLen = 0;
    const minLen = Math.min(oldContent.length, newContent.length);
    while (prefixLen < minLen && oldContent[prefixLen] === newContent[prefixLen]) {
      prefixLen++;
    }

    let suffixLen = 0;
    while (
      suffixLen < (minLen - prefixLen) &&
      oldContent[oldContent.length - 1 - suffixLen] === newContent[newContent.length - 1 - suffixLen]
    ) {
      suffixLen++;
    }

    const oldChangeStart = prefixLen;
    const oldChangeEnd = oldContent.length - suffixLen;
    const newChangeStart = prefixLen;
    const newChangeEnd = newContent.length - suffixLen;
    const delta = (newChangeEnd - newChangeStart) - (oldChangeEnd - oldChangeStart);

    // If nothing changed, return as-is
    if (oldChangeStart === oldChangeEnd && newChangeStart === newChangeEnd) {
      return oldAuthorship;
    }

    // If no prior authorship or full replacement, attribute everything to bot
    if (oldAuthorship.length === 0 || (oldChangeStart === 0 && oldChangeEnd === oldContent.length)) {
      return [[botId, 0, newContent.length, now, now]];
    }

    const result: AuthorshipEntry[] = [];

    for (const entry of oldAuthorship) {
      const [userId, start, end, created, _updated] = entry;

      if (end <= oldChangeStart) {
        // Entirely before the change — keep as-is
        result.push(entry);
      } else if (start >= oldChangeEnd) {
        // Entirely after the change — shift by delta
        result.push([userId, start + delta, end + delta, created, _updated]);
      } else {
        // Overlaps the changed region — trim to the parts outside the change
        if (start < oldChangeStart) {
          result.push([userId, start, oldChangeStart, created, _updated]);
        }
        if (end > oldChangeEnd) {
          result.push([userId, newChangeEnd, end + delta, created, _updated]);
        }
      }
    }

    // Insert the bot's authorship for the new content range
    if (newChangeEnd > newChangeStart) {
      result.push([botId, newChangeStart, newChangeEnd, now, now]);
    }

    // Sort by start position
    result.sort((a, b) => a[1] - b[1]);

    return result;
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
