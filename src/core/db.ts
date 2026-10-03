import { DatabaseSync } from 'node:sqlite'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export type Db = DatabaseSync

/**
 * Ordered schema migrations. PRAGMA user_version records how many have run.
 * Never edit a shipped migration; append a new one instead.
 */
const MIGRATIONS: string[] = [
  `
  CREATE TABLE accounts (
    id            TEXT PRIMARY KEY,
    provider      TEXT NOT NULL CHECK (provider IN ('gmail', 'outlook')),
    email         TEXT NOT NULL,
    name          TEXT,
    token_enc     BLOB,
    sync_cursor   TEXT,
    last_sync_at  INTEGER,
    last_error    TEXT,
    created_at    INTEGER NOT NULL
  );

  CREATE TABLE messages (
    id                  TEXT PRIMARY KEY,           -- "<accountId>:<providerId>"
    account_id          TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    provider_id         TEXT NOT NULL,
    thread_id           TEXT,
    from_name           TEXT,
    from_addr           TEXT,
    to_addrs            TEXT,
    subject             TEXT,
    snippet             TEXT,
    body_text           TEXT,                       -- cleaned, truncated plain text
    link_domains        TEXT,                       -- space-separated hostnames found in the body
    has_calendar_invite INTEGER NOT NULL DEFAULT 0,
    list_unsubscribe    INTEGER NOT NULL DEFAULT 0,
    has_attachments     INTEGER NOT NULL DEFAULT 0,
    provider_labels     TEXT,                       -- JSON array (Gmail label ids / Outlook categories)
    received_at         INTEGER NOT NULL,
    is_read             INTEGER NOT NULL DEFAULT 0,
    web_link            TEXT
  );
  CREATE INDEX messages_received ON messages (received_at DESC, id);
  CREATE INDEX messages_account_received ON messages (account_id, received_at DESC, id);
  CREATE INDEX messages_from_addr ON messages (from_addr);

  -- Full HTML bodies, fetched lazily when an email is opened. Brotli-compressed, size-capped LRU.
  CREATE TABLE bodies (
    message_id   TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    content      BLOB NOT NULL,
    is_html      INTEGER NOT NULL,
    size         INTEGER NOT NULL,
    accessed_at  INTEGER NOT NULL
  );
  CREATE INDEX bodies_accessed ON bodies (accessed_at);

  CREATE TABLE tags (
    message_id          TEXT PRIMARY KEY REFERENCES messages(id) ON DELETE CASCADE,
    tag                 TEXT NOT NULL,
    source              TEXT NOT NULL CHECK (source IN ('rule', 'llm', 'user')),
    confidence          REAL,
    reason              TEXT,
    model               TEXT,
    classifier_version  INTEGER NOT NULL,
    created_at          INTEGER NOT NULL,
    synced_tag          TEXT,                       -- tag last written to the provider
    sync_error          TEXT
  );
  CREATE INDEX tags_tag ON tags (tag);
  CREATE INDEX tags_pending_sync ON tags (message_id) WHERE synced_tag IS NOT tag;

  CREATE TABLE corrections (
    id           INTEGER PRIMARY KEY,
    message_id   TEXT,
    from_tag     TEXT,
    to_tag       TEXT NOT NULL,
    from_domain  TEXT,
    from_addr    TEXT,
    subject      TEXT,
    excerpt      TEXT,
    created_at   INTEGER NOT NULL
  );
  CREATE INDEX corrections_domain ON corrections (from_domain, created_at DESC);

  CREATE TABLE settings (
    key    TEXT PRIMARY KEY,
    value  TEXT NOT NULL
  );

  -- Provider label/category ids for our "AI/<Tag>" labels.
  CREATE TABLE label_cache (
    account_id         TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name               TEXT NOT NULL,
    provider_label_id  TEXT NOT NULL,
    PRIMARY KEY (account_id, name)
  );

  CREATE VIRTUAL TABLE messages_fts USING fts5 (
    subject, from_name, from_addr, snippet, body_text,
    content = 'messages', content_rowid = 'rowid',
    tokenize = 'unicode61 remove_diacritics 2'
  );
  CREATE TRIGGER messages_fts_insert AFTER INSERT ON messages BEGIN
    INSERT INTO messages_fts (rowid, subject, from_name, from_addr, snippet, body_text)
    VALUES (new.rowid, new.subject, new.from_name, new.from_addr, new.snippet, new.body_text);
  END;
  CREATE TRIGGER messages_fts_delete AFTER DELETE ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, subject, from_name, from_addr, snippet, body_text)
    VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_addr, old.snippet, old.body_text);
  END;
  CREATE TRIGGER messages_fts_update AFTER UPDATE OF subject, from_name, from_addr, snippet, body_text ON messages BEGIN
    INSERT INTO messages_fts (messages_fts, rowid, subject, from_name, from_addr, snippet, body_text)
    VALUES ('delete', old.rowid, old.subject, old.from_name, old.from_addr, old.snippet, old.body_text);
    INSERT INTO messages_fts (rowid, subject, from_name, from_addr, snippet, body_text)
    VALUES (new.rowid, new.subject, new.from_name, new.from_addr, new.snippet, new.body_text);
  END;
  `
]

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
  const db = new DatabaseSync(path)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -16000;
  `)
  migrate(db)
  return db
}

function migrate(db: Db): void {
  const { user_version: current } = db.prepare('PRAGMA user_version').get() as { user_version: number }
  for (let v = current; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v])
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

/** Runs fn inside BEGIN/COMMIT; nested calls join the outer transaction. */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn()
  db.exec('BEGIN IMMEDIATE')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}
