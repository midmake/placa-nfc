// Bounded LOCAL-only exercise, not a Cloudflare capacity benchmark.
import worker, { type Env } from "../src/index";
import { TestDB } from "../tests/db";
import { digest } from "../src/security";
import { setTimeout as delay } from "node:timers/promises";
const routes = [
  [
    "/api/login",
    "POST",
    { email: "missing@example.test", password: "incorrect-password" },
  ],
  ["/api/search?q=test", "GET", undefined],
  ["/api/plates?batch_id=local", "GET", undefined],
  ["/r/A00001-" + "b".repeat(48), "GET", undefined],
] as const;
for (const rate of [10, 50, 100])
  for (const [path, method, data] of routes) {
    const db = new TestDB();
    db.sql
      .prepare(
        "INSERT INTO users(id,name,email,password_hash,role,must_change_password) VALUES('load','load','load@example.test','fixture','ADMIN',0)",
      )
      .run();
    db.sql
      .prepare("INSERT INTO sessions VALUES(?,'load',?,?)")
      .run(await digest("a".repeat(64)), Date.now() + 3600000, Date.now());
    db.sql
      .prepare(
        "INSERT INTO batches(id,name,created_by) VALUES('local','local','load')",
      )
      .run();
    db.sql
      .prepare(
        "INSERT INTO plates(token,batch_id,status,physical_code) VALUES(?,'local','UNASSIGNED','A3009-K7Q2')",
      )
      .run("b".repeat(48));
    const env = {
      DB: db,
      PASSWORD_PEPPER: "load-fixture-only".repeat(4),
    } as unknown as Env;
    const statuses: Record<string, number> = {},
      times: number[] = [];
    const start = performance.now();
    await Promise.all(
      Array.from({ length: rate }, async (_, i) => {
        await delay((i * 1000) / rate);
        const before = performance.now();
        const r = await worker.fetch(
          new Request("https://local.invalid" + path, {
            method,
            headers: {
              origin: "https://local.invalid",
              "content-type": "application/json",
              "cf-connecting-ip": "local-load",
              cookie: "gg_session=" + "a".repeat(64),
            },
            body: data === undefined ? undefined : JSON.stringify(data),
          }),
          env,
        );
        await r.body?.cancel();
        times.push(performance.now() - before);
        statuses[r.status] = (statuses[r.status] || 0) + 1;
      }),
    );
    times.sort((a, b) => a - b);
    console.log(
      JSON.stringify({
        route: path.startsWith("/r/") ? "/r/[fixture]" : path,
        offeredRps: rate,
        requests: rate,
        elapsedMs: Math.round(performance.now() - start),
        p95Ms: Math.round(times[Math.floor(times.length * 0.95)]),
        statuses,
      }),
    );
    if (Object.keys(statuses).some((s) => Number(s) >= 500))
      process.exitCode = 1;
    db.sql.close();
  }
