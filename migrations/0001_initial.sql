PRAGMA foreign_keys = ON;
CREATE TABLE users (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('ADMIN','USER')),
 must_change_password INTEGER NOT NULL DEFAULT 1 CHECK(must_change_password IN (0,1)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE login_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, reset_at INTEGER NOT NULL);
CREATE TABLE categories (name TEXT PRIMARY KEY);
INSERT INTO categories(name) VALUES ('Barbearia'),('Salão de beleza'),('Restaurante'),('Mercado'),('Informática'),('Papelaria'),('Artigos religiosos'),('Academia'),('Clínica'),('Oficina'),('Loja de roupas'),('Outro');
CREATE TABLE establishments (
 id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id), name TEXT NOT NULL,
 city TEXT NOT NULL, segment TEXT NOT NULL REFERENCES categories(name), responsible TEXT NOT NULL,
 phone TEXT NOT NULL, phone_normalized TEXT NOT NULL, google_url TEXT NOT NULL,
 name_key TEXT NOT NULL, city_key TEXT NOT NULL,
 initial_snapshot TEXT NOT NULL CHECK(json_valid(initial_snapshot)),
 version INTEGER NOT NULL DEFAULT 1, created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX establishments_owner ON establishments(owner_id);
CREATE INDEX establishments_phone ON establishments(phone_normalized);
CREATE INDEX establishments_location ON establishments(city_key,segment);
CREATE INDEX establishments_google ON establishments(google_url);
CREATE TABLE batches (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, owner_id TEXT REFERENCES users(id), created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE TABLE plates (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 code TEXT GENERATED ALWAYS AS ('A' || printf('%05d', id)) STORED UNIQUE,
 token TEXT NOT NULL UNIQUE, batch_id TEXT NOT NULL REFERENCES batches(id),
 owner_id TEXT REFERENCES users(id), establishment_id TEXT REFERENCES establishments(id),
 status TEXT NOT NULL CHECK(status IN ('UNASSIGNED','AVAILABLE','ACTIVE')),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), activated_at TEXT,
 CHECK ((status='UNASSIGNED' AND owner_id IS NULL AND establishment_id IS NULL) OR (status='AVAILABLE' AND owner_id IS NOT NULL AND establishment_id IS NULL) OR (status='ACTIVE' AND owner_id IS NOT NULL AND establishment_id IS NOT NULL))
);
CREATE INDEX plates_owner ON plates(owner_id);
CREATE INDEX plates_batch ON plates(batch_id);
CREATE INDEX plates_establishment ON plates(establishment_id);
CREATE TABLE audit_log (
 id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id TEXT NOT NULL REFERENCES users(id),
 entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, action TEXT NOT NULL,
 old_data TEXT CHECK(old_data IS NULL OR json_valid(old_data)),
 new_data TEXT CHECK(new_data IS NULL OR json_valid(new_data)),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX audit_entity ON audit_log(entity_type,entity_id,id);
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'Audit is immutable'); END;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'Audit is immutable'); END;
CREATE TRIGGER initial_snapshot_immutable BEFORE UPDATE OF initial_snapshot ON establishments BEGIN SELECT RAISE(ABORT, 'Initial snapshot is immutable'); END;
CREATE TRIGGER plate_identity_immutable BEFORE UPDATE OF token,id,batch_id ON plates BEGIN SELECT RAISE(ABORT, 'Plate identity is immutable'); END;
CREATE TRIGGER plate_owner_insert BEFORE INSERT ON plates WHEN NEW.establishment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM establishments e WHERE e.id=NEW.establishment_id AND e.owner_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT,'Owner mismatch'); END;
CREATE TRIGGER plate_owner_update BEFORE UPDATE ON plates WHEN NEW.establishment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM establishments e WHERE e.id=NEW.establishment_id AND e.owner_id=NEW.owner_id) BEGIN SELECT RAISE(ABORT,'Owner mismatch'); END;
-- Each mutation and its audit run together in a D1 batch. This guard aborts the
-- transaction if a concurrent change invalidates a previously checked row.
CREATE TABLE mutation_guard (ok INTEGER NOT NULL CHECK(ok=1));
