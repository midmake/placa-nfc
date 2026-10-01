-- Incremental v2. Apply ONLY this file to the existing production schema.
-- Do NOT replay 0001: production was initialized manually.
-- Run the preflight in docs/DEPLOY_V2.md and take a D1 backup first.
-- One-time migration: duplicate-column failure on repeat is intentional.
ALTER TABLE plates ADD COLUMN physical_code TEXT;
ALTER TABLE plates ADD COLUMN blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0,1));
CREATE UNIQUE INDEX plates_physical_code_unique ON plates(physical_code) WHERE physical_code IS NOT NULL;
CREATE INDEX plates_owner_active ON plates(owner_id,status,blocked);
CREATE TRIGGER physical_code_immutable BEFORE UPDATE OF physical_code ON plates
WHEN OLD.physical_code IS NOT NULL AND NEW.physical_code IS NOT OLD.physical_code
BEGIN SELECT RAISE(ABORT,'Physical code is immutable'); END;
ALTER TABLE batches ADD COLUMN physical_prefix TEXT;
ALTER TABLE batches ADD COLUMN target_quantity INTEGER NOT NULL DEFAULT 0;
ALTER TABLE batches ADD COLUMN generation_state TEXT NOT NULL DEFAULT 'READY' CHECK(generation_state IN ('GENERATING','READY'));
ALTER TABLE batches ADD COLUMN request_key TEXT;
ALTER TABLE batches ADD COLUMN production_origin TEXT;
CREATE UNIQUE INDEX batches_request_unique ON batches(request_key) WHERE request_key IS NOT NULL;
ALTER TABLE establishments ADD COLUMN address TEXT NOT NULL DEFAULT '';
CREATE TABLE activation_grants (
 token_hash TEXT PRIMARY KEY,
 plate_id INTEGER NOT NULL REFERENCES plates(id),
 user_id TEXT NOT NULL REFERENCES users(id),
 session_hash TEXT NOT NULL REFERENCES sessions(token_hash) ON DELETE CASCADE,
 expires_at INTEGER NOT NULL
);
CREATE INDEX activation_grants_expiry ON activation_grants(expires_at);
CREATE TABLE schema_versions (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')));
INSERT INTO schema_versions(version) VALUES('0002_operations');
