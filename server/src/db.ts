import Database from 'better-sqlite3';

// Append new entries; never edit an existing one. user_version tracks how many have run.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE users (
    id INTEGER PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin','manager','viewer')),
    disabled INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at TEXT NOT NULL
  );
  CREATE TABLE projects (
    id INTEGER PRIMARY KEY,
    key TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    owner_id INTEGER NOT NULL REFERENCES users(id),
    archived INTEGER NOT NULL DEFAULT 0,
    next_number INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );
  CREATE TABLE project_members (
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('editor','viewer')),
    PRIMARY KEY (project_id, user_id)
  );
  CREATE TABLE epics (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    color TEXT NOT NULL DEFAULT '#6b7280',
    done INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE releases (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_date TEXT,
    end_date TEXT,
    capacity REAL,
    status TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','done'))
  );
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    number INTEGER NOT NULL,
    epic_id INTEGER REFERENCES epics(id) ON DELETE SET NULL,
    release_id INTEGER REFERENCES releases(id) ON DELETE SET NULL,
    type TEXT NOT NULL DEFAULT 'story' CHECK (type IN ('story','task','bug')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    acceptance_criteria TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','ready','in_progress','done')),
    value INTEGER,
    urgency INTEGER,
    effort REAL,
    rank INTEGER NOT NULL,
    created_by INTEGER REFERENCES users(id),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (project_id, number)
  );
  CREATE INDEX items_project_rank ON items(project_id, rank);
  CREATE TABLE dependencies (
    blocker_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    blocked_id INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
    PRIMARY KEY (blocker_id, blocked_id)
  );
  `,
  // Numeric value and urgency (1-10) become a MoSCoW category and an urgency level, plus an optional due date.
  `
  ALTER TABLE items RENAME COLUMN urgency TO urgency_score;
  ALTER TABLE items ADD COLUMN moscow TEXT CHECK (moscow IN ('must','should','could','wont'));
  ALTER TABLE items ADD COLUMN urgency TEXT CHECK (urgency IN ('wait','soon','now'));
  ALTER TABLE items ADD COLUMN due_date TEXT;
  UPDATE items SET
    moscow = CASE WHEN value >= 8 THEN 'must' WHEN value >= 5 THEN 'should' WHEN value >= 2 THEN 'could' WHEN value >= 1 THEN 'wont' END,
    urgency = CASE WHEN urgency_score >= 8 THEN 'now' WHEN urgency_score >= 4 THEN 'soon' WHEN urgency_score >= 1 THEN 'wait' END;
  ALTER TABLE items DROP COLUMN value;
  ALTER TABLE items DROP COLUMN urgency_score;
  `,
];

/** Brings the database up to `target` migrations. Tests pass a lower target to build an old database. */
export function migrate(db: Database.Database, target = MIGRATIONS.length): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  for (let i = version; i < target; i++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[i]);
      db.pragma(`user_version = ${i + 1}`);
    })();
  }
}

export function openDb(file: string): Database.Database {
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}
