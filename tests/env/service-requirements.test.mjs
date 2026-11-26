import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { after, before, describe, it } from "node:test";
import {
  checkPostgres,
  checkRedis,
  MIN_POSTGRES_MAJOR,
  MIN_REDIS_MAJOR,
  parseRedisVersion,
} from "../../scripts/env/preflight.mjs";
import { REPO_ROOT } from "../docs/helpers.mjs";

const env = (entries) => new Map(Object.entries(entries));

/** Any TCP listener; the PostgreSQL probe only needs the port to accept. */
function listener() {
  const server = net.createServer();
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server))
  );
}

/** Fake `pg` whose SHOW server_version returns `version`. */
const pgWithVersion = (version) => ({
  Client: class {
    async connect() {}
    async query() {
      return { rows: [{ server_version: version }] };
    }
    async end() {}
  },
});

/** A fake Redis that answers AUTH/PING and INFO with the given version. */
function fakeRedis(version) {
  const payload = version === null ? "role:master\r\n" : `redis_version:${version}\r\n`;
  const server = net.createServer((socket) => {
    let buffer = "";
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      for (;;) {
        const m = buffer.match(/^\*(\d+)\r\n/);
        if (!m) return;
        const parts = buffer.split("\r\n");
        const needed = 1 + Number(m[1]) * 2;
        if (parts.length <= needed) return;
        const args = [];
        for (let i = 2; i < needed; i += 2) args.push(parts[i]);
        const [cmd] = args;
        let reply;
        if (cmd === "AUTH") reply = "+OK";
        else if (cmd === "PING") reply = "+PONG";
        else if (cmd === "INFO")
          reply = `$${Buffer.byteLength(payload)}\r\n${payload}`;
        else reply = "-ERR unknown command";
        socket.write(`${reply}\r\n`);
        buffer = parts.slice(needed).join("\r\n");
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve(server))
  );
}

describe("documented service requirements", () => {
  it("matches the minimums stated in README.md", () => {
    const readme = fs.readFileSync(path.join(REPO_ROOT, "README.md"), "utf8");
    assert.match(readme, new RegExp(`PostgreSQL ${MIN_POSTGRES_MAJOR}\\+`));
    assert.match(readme, new RegExp(`Redis ${MIN_REDIS_MAJOR}\\+`));
  });

  it("CI service images satisfy the documented minimums", () => {
    const dir = path.join(REPO_ROOT, ".github", "workflows");
    const majors = { postgres: [], redis: [] };
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".yml")) continue;
      const text = fs.readFileSync(path.join(dir, file), "utf8");
      for (const m of text.matchAll(/image:\s*(postgres|redis):(\d+)/g))
        majors[m[1]].push(Number(m[2]));
    }
    for (const major of majors.postgres)
      assert.ok(
        major >= MIN_POSTGRES_MAJOR,
        `postgres:${major} is below the documented minimum`
      );
    for (const major of majors.redis)
      assert.ok(
        major >= MIN_REDIS_MAJOR,
        `redis:${major} is below the documented minimum`
      );
    assert.ok(majors.postgres.length > 0, "no postgres image found in CI");
    assert.ok(majors.redis.length > 0, "no redis image found in CI");
  });
});

describe("preflight: PostgreSQL version", () => {
  let server;
  let port;
  before(async () => {
    server = await listener();
    port = server.address().port;
  });
  after(() => server.close());

  const baseEnv = () =>
    env({
      DB_HOST: "127.0.0.1",
      DB_PORT: String(port),
      DB_USERNAME: "u",
      DB_NAME: "d",
    });

  it("fails below the documented minimum", async () => {
    const result = await checkPostgres(baseEnv(), {
      pg: pgWithVersion("13.4"),
    });
    assert.equal(result.status, "fail");
    assert.match(result.message, /below the documented minimum PostgreSQL 14/);
    assert.match(result.fix, /postgres:15/);
  });

  it("accepts the minimum boundary version", async () => {
    const result = await checkPostgres(baseEnv(), {
      pg: pgWithVersion("14.0"),
    });
    assert.equal(result.status, "ok");
    assert.match(result.message, /server 14\.0/);
  });

  it("accepts newer versions and distro-suffixed strings", async () => {
    for (const version of ["15.3", "14.11 (Debian 14.11-1.pgdg120+1)"]) {
      const result = await checkPostgres(baseEnv(), {
        pg: pgWithVersion(version),
      });
      assert.equal(result.status, "ok", version);
    }
  });

  it("does not fail when the version cannot be determined", async () => {
    const result = await checkPostgres(baseEnv(), {
      pg: pgWithVersion("unknown"),
    });
    assert.equal(result.status, "ok");
  });
});

describe("preflight: Redis version", () => {
  let server;
  let port;
  before(async () => {
    server = await fakeRedis("7.2.4");
    port = server.address().port;
  });
  after(() => server.close());

  const baseEnv = () =>
    env({ REDIS_HOST: "127.0.0.1", REDIS_PORT: String(port) });

  it("reports the server version on success", async () => {
    const result = await checkRedis(baseEnv());
    assert.equal(result.status, "ok");
    assert.match(result.message, /server 7\.x/);
  });

  it("fails below the documented minimum", async () => {
    const old = await fakeRedis("5.0.14");
    try {
      const result = await checkRedis(
        env({
          REDIS_HOST: "127.0.0.1",
          REDIS_PORT: String(old.address().port),
        })
      );
      assert.equal(result.status, "fail");
      assert.match(result.message, /below the documented minimum 6/);
      assert.match(result.fix, /redis:7/);
    } finally {
      old.close();
    }
  });

  it("accepts the minimum boundary version", async () => {
    const edge = await fakeRedis("6.2.0");
    try {
      const result = await checkRedis(
        env({
          REDIS_HOST: "127.0.0.1",
          REDIS_PORT: String(edge.address().port),
        })
      );
      assert.equal(result.status, "ok");
    } finally {
      edge.close();
    }
  });

  it("still passes when INFO has no version field", async () => {
    const quiet = await fakeRedis(null);
    try {
      const result = await checkRedis(
        env({
          REDIS_HOST: "127.0.0.1",
          REDIS_PORT: String(quiet.address().port),
        })
      );
      assert.equal(result.status, "ok");
      assert.doesNotMatch(result.message, /server \d/);
    } finally {
      quiet.close();
    }
  });
});

describe("parseRedisVersion", () => {
  it("extracts the major version from INFO output", () => {
    assert.equal(parseRedisVersion("# Server\r\nredis_version:7.0.15\r\n"), 7);
    assert.equal(parseRedisVersion("redis_version:6.2\r\n"), 6);
  });

  it("returns null for missing or malformed input", () => {
    assert.equal(parseRedisVersion(""), null);
    assert.equal(parseRedisVersion("redis_version:abc"), null);
    assert.equal(parseRedisVersion(undefined), null);
  });
});
