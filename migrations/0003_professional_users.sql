-- One-time additive upgrade, AFTER 0002. Never replay 0001/0002 on production.
ALTER TABLE users ADD COLUMN commercial_type TEXT NOT NULL DEFAULT 'EQUIPE_GEAR' CHECK(commercial_type IN ('EQUIPE_GEAR','REVENDEDOR'));
ALTER TABLE users ADD COLUMN state TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('INVITED','ACTIVE','SUSPENDED'));
ALTER TABLE users ADD COLUMN archived_at TEXT;
ALTER TABLE batches ADD COLUMN product TEXT NOT NULL DEFAULT 'GOOGLE' CHECK(product IN ('GOOGLE','INSTAGRAM','PIX'));
ALTER TABLE batches ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK(is_test IN (0,1));
ALTER TABLE batches ADD COLUMN archived_at TEXT;
ALTER TABLE establishments ADD COLUMN is_test INTEGER NOT NULL DEFAULT 0 CHECK(is_test IN (0,1));
ALTER TABLE establishments ADD COLUMN archived_at TEXT;
CREATE TABLE access_tokens (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id),
 kind TEXT NOT NULL CHECK(kind IN ('INVITE','RESET')), token_hash TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL, consumed_at INTEGER, revoked_at INTEGER,
 delivery TEXT NOT NULL DEFAULT 'PENDING' CHECK(delivery IN ('PENDING','SENT','FAILED','MANUAL')),
 created_at INTEGER NOT NULL, created_by TEXT NOT NULL REFERENCES users(id)
);
CREATE INDEX access_tokens_user ON access_tokens(user_id,kind,created_at);
CREATE UNIQUE INDEX access_tokens_open ON access_tokens(user_id,kind) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE TABLE allocations (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), batch_id TEXT NOT NULL REFERENCES batches(id),
 product TEXT NOT NULL DEFAULT 'GOOGLE' CHECK(product='GOOGLE'),
 quantity INTEGER NOT NULL CHECK(quantity>0), consumed INTEGER NOT NULL DEFAULT 0 CHECK(consumed>=0 AND consumed<=quantity),
 request_key TEXT NOT NULL UNIQUE, created_by TEXT NOT NULL REFERENCES users(id),
 created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX allocations_balance ON allocations(user_id,batch_id,consumed);
ALTER TABLE plates ADD COLUMN activated_by TEXT REFERENCES users(id);
ALTER TABLE plates ADD COLUMN activation_type TEXT CHECK(activation_type IN ('EQUIPE_GEAR','REVENDEDOR'));
ALTER TABLE plates ADD COLUMN allocation_id TEXT REFERENCES allocations(id);
-- Existing active records keep their historical owner. The new field starts with
-- the original activation audit actor where available, otherwise the owner.
UPDATE plates SET activated_by=COALESCE((SELECT actor_id FROM audit_log WHERE entity_type='plate' AND entity_id=CAST(plates.id AS TEXT) AND action='activated' ORDER BY id LIMIT 1),owner_id),activation_type='EQUIPE_GEAR' WHERE status='ACTIVE';
CREATE TRIGGER allocation_capacity BEFORE INSERT ON allocations BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND commercial_type='REVENDEDOR' AND role='USER' AND state<>'SUSPENDED' AND archived_at IS NULL) THEN RAISE(ABORT,'Invalid reseller') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM batches WHERE id=NEW.batch_id AND product=NEW.product AND generation_state='READY' AND archived_at IS NULL) THEN RAISE(ABORT,'Invalid allocation batch') END;
 SELECT CASE WHEN NEW.quantity > (SELECT COUNT(*) FROM plates WHERE batch_id=NEW.batch_id AND status<>'ACTIVE' AND owner_id IS NULL AND blocked=0) - COALESCE((SELECT SUM(quantity-consumed) FROM allocations WHERE batch_id=NEW.batch_id),0) THEN RAISE(ABORT,'Insufficient units') END;
END;
CREATE TRIGGER allocation_identity BEFORE UPDATE OF user_id,batch_id,product,quantity,request_key ON allocations BEGIN SELECT RAISE(ABORT,'Allocation is immutable'); END;
CREATE TRIGGER allocation_consumption BEFORE UPDATE OF consumed ON allocations WHEN NEW.consumed<>OLD.consumed+1 BEGIN SELECT RAISE(ABORT,'Invalid consumption'); END;
-- Preserve outstanding reseller units when team members activate/reserve plates.
CREATE TRIGGER plate_capacity AFTER UPDATE OF owner_id,status ON plates
WHEN (SELECT COUNT(*) FROM plates WHERE batch_id=NEW.batch_id AND status<>'ACTIVE' AND owner_id IS NULL) < COALESCE((SELECT SUM(quantity-consumed) FROM allocations WHERE batch_id=NEW.batch_id),0)
BEGIN SELECT RAISE(ABORT,'Units reserved for resellers'); END;
CREATE TRIGGER plate_capacity_delete AFTER DELETE ON plates
WHEN (SELECT COUNT(*) FROM plates WHERE batch_id=OLD.batch_id AND status<>'ACTIVE' AND owner_id IS NULL) < COALESCE((SELECT SUM(quantity-consumed) FROM allocations WHERE batch_id=OLD.batch_id),0)
BEGIN SELECT RAISE(ABORT,'Units reserved for resellers'); END;
CREATE TRIGGER activation_account BEFORE UPDATE OF status ON plates WHEN NEW.status='ACTIVE' AND OLD.status<>'ACTIVE' BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.owner_id AND state='ACTIVE' AND archived_at IS NULL) THEN RAISE(ABORT,'Inactive account') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM batches WHERE id=NEW.batch_id AND product='GOOGLE' AND archived_at IS NULL) THEN RAISE(ABORT,'Inactive batch') END;
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM establishments e JOIN batches b ON b.id=NEW.batch_id WHERE e.id=NEW.establishment_id AND e.archived_at IS NULL AND e.is_test=b.is_test) THEN RAISE(ABORT,'Inactive batch') END;
END;
CREATE TRIGGER test_batch_identity BEFORE UPDATE OF is_test,product ON batches BEGIN SELECT RAISE(ABORT,'Batch classification is immutable'); END;
CREATE TRIGGER test_client_identity BEFORE UPDATE OF is_test ON establishments BEGIN SELECT RAISE(ABORT,'Client classification is immutable'); END;
INSERT INTO schema_versions(version) VALUES('0003_professional_users');
