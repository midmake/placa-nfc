import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
export class TestDB {
  sql = new DatabaseSync(":memory:");
  constructor(upgrade = true) {
    this.sql.exec(
      readFileSync(
        new URL("../migrations/0001_initial.sql", import.meta.url),
        "utf8",
      ),
    );
    if (upgrade)
      this.sql.exec(
        readFileSync(
          new URL("../migrations/0002_operations.sql", import.meta.url),
          "utf8",
        ),
      );
    if (upgrade)
      this.sql.exec(
        readFileSync(
          new URL("../migrations/0003_professional_users.sql", import.meta.url),
          "utf8",
        ),
      );
  }

  prepare(query: string) {
    const db = this;
    let params: any[] = [];
    const p = {
      bind(...args: any[]) {
        params = args;
        return p;
      },
      async first() {
        return db.sql.prepare(query).get(...params) || null;
      },
      async all() {
        return { results: db.sql.prepare(query).all(...params) };
      },
      async run() {
        const r = db.sql.prepare(query).run(...params);
        return { results: [], meta: { changes: Number(r.changes) } };
      },
      _exec() {
        const stmt = db.sql.prepare(query);
        return stmt.columns().length
          ? { results: stmt.all(...params) }
          : {
              results: [],
              meta: { changes: Number(stmt.run(...params).changes) },
            };
      },
    };
    return p;
  }
  async batch(stmts: any[]) {
    this.sql.exec("BEGIN");
    try {
      const r = stmts.map((s) => s._exec());
      this.sql.exec("COMMIT");
      return r;
    } catch (e) {
      this.sql.exec("ROLLBACK");
      throw e;
    }
  }
}
