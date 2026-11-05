CREATE TABLE pix_links (
  id INTEGER PRIMARY KEY,
  public_id TEXT NOT NULL UNIQUE,
  store TEXT NOT NULL,
  recipient TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('cpf','cnpj','email','phone','random','payload')),
  pix_value TEXT NOT NULL CHECK(length(pix_value) BETWEEN 1 AND 1024),
  version INTEGER NOT NULL DEFAULT 1
);
INSERT INTO schema_versions(version) VALUES('0004_pix_links');
