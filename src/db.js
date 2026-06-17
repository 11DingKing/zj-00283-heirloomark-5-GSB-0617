const Database = require("better-sqlite3");
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, "heirloom-ark.db");
const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

function initSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS families (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      origin_place TEXT,
      description TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS members (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      gender TEXT CHECK(gender IN ('男','女')) NOT NULL,
      generation INTEGER NOT NULL,
      parent_id INTEGER,
      birth_year INTEGER,
      death_year INTEGER,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES members(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS heirlooms (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      family_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      era TEXT NOT NULL,
      origin TEXT NOT NULL,
      photo_description TEXT,
      current_holder_id INTEGER,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (family_id) REFERENCES families(id) ON DELETE CASCADE,
      FOREIGN KEY (current_holder_id) REFERENCES members(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS narratives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      heirloom_id INTEGER NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      narrator_name TEXT NOT NULL,
      narrator_relation TEXT NOT NULL,
      narrator_member_id INTEGER,
      collected_at TEXT NOT NULL,
      scene TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','verified','disputed')),
      submitter_member_id INTEGER,
      confirmed_count INTEGER NOT NULL DEFAULT 0,
      doubted_count INTEGER NOT NULL DEFAULT 0,
      verified_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (heirloom_id) REFERENCES heirlooms(id) ON DELETE CASCADE,
      FOREIGN KEY (narrator_member_id) REFERENCES members(id) ON DELETE SET NULL,
      FOREIGN KEY (submitter_member_id) REFERENCES members(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS narrative_verifications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      narrative_id INTEGER NOT NULL,
      verifier_member_id INTEGER NOT NULL,
      verdict TEXT NOT NULL CHECK(verdict IN ('confirmed','doubted')),
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (narrative_id) REFERENCES narratives(id) ON DELETE CASCADE,
      FOREIGN KEY (verifier_member_id) REFERENCES members(id) ON DELETE CASCADE,
      UNIQUE(narrative_id, verifier_member_id)
    );

    CREATE TABLE IF NOT EXISTS inheritances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      heirloom_id INTEGER NOT NULL,
      from_member_id INTEGER,
      to_member_id INTEGER NOT NULL,
      inherited_at TEXT NOT NULL,
      note TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (heirloom_id) REFERENCES heirlooms(id) ON DELETE CASCADE,
      FOREIGN KEY (from_member_id) REFERENCES members(id) ON DELETE SET NULL,
      FOREIGN KEY (to_member_id) REFERENCES members(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_members_family ON members(family_id);
    CREATE INDEX IF NOT EXISTS idx_members_parent ON members(parent_id);
    CREATE INDEX IF NOT EXISTS idx_heirlooms_family ON heirlooms(family_id);
    CREATE INDEX IF NOT EXISTS idx_narratives_heirloom ON narratives(heirloom_id);
    CREATE INDEX IF NOT EXISTS idx_narratives_status ON narratives(status);
    CREATE INDEX IF NOT EXISTS idx_narr_verif_narrative ON narrative_verifications(narrative_id);
    CREATE INDEX IF NOT EXISTS idx_narr_verif_verifier ON narrative_verifications(verifier_member_id);
    CREATE INDEX IF NOT EXISTS idx_inheritances_heirloom ON inheritances(heirloom_id);
    CREATE INDEX IF NOT EXISTS idx_inheritances_from ON inheritances(from_member_id);
    CREATE INDEX IF NOT EXISTS idx_inheritances_to ON inheritances(to_member_id);
  `);
}

initSchema();

module.exports = db;
