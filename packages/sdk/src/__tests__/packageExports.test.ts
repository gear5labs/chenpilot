/**
 * Package exports contract tests (#1050).
 *
 * Verifies that `package.json` exposes a proper `exports` map and that both
 * CommonJS and ESM consumers can resolve the published entry point from packed
 * package contents (not workspace source aliases).
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

describe("package exports (#1050)", () => {
  const packageRoot = path.resolve(__dirname, "../..");
  const packageJsonPath = path.join(packageRoot, "package.json");

  it("declares exports map for the main entry and package.json", () => {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    expect(packageJson.exports).toBeDefined();
    expect(packageJson.exports["."]).toBeDefined();
    expect(packageJson.exports["./package.json"]).toBe("./package.json");
    expect(packageJson.main).toBe("dist/index.js");
    expect(packageJson.types).toBe("dist/index.d.ts");
  });

  it("consumes the packed tarball from a CJS fixture", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-consume-cjs-"));
    // npm pack output is verbose; collect any .tgz it creates in tmpDir.
    execFileSync("npm", ["pack", "--pack-destination", tmpDir], {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tgzName = fs
      .readdirSync(tmpDir)
      .find((f) => f.endsWith(".tgz"));
    if (!tgzName) throw new Error("npm pack produced no tarball");
    const tgzPath = path.join(tmpDir, tgzName);

    const consumerDir = path.join(tmpDir, "consumer");
    fs.mkdirSync(consumerDir, { recursive: true });
    fs.writeFileSync(
      path.join(consumerDir, "package.json"),
      JSON.stringify({ name: "c", private: true, type: "commonjs" }, null, 2)
    );
    execFileSync("npm", ["install", tgzPath], {
      cwd: consumerDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
    });

    // Copy the fixture and run it against the installed packed package.
    const fixtureDir = path.join(packageRoot, "__fixtures__/consumption/cjs");
    const testFile = path.join(consumerDir, "fixture.cjs");
    fs.copyFileSync(path.join(fixtureDir, "index.cjs"), testFile);
    // Ensure it resolves @chen-pilot/sdk-core from node_modules
    const out = execFileSync("node", [testFile], {
      cwd: consumerDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out).toBe("");
  });

  it("consumes the packed tarball from an ESM fixture", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-consume-esm-"));
    execFileSync("npm", ["pack", "--pack-destination", tmpDir], {
      cwd: packageRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    const tgzName = fs
      .readdirSync(tmpDir)
      .find((f) => f.endsWith(".tgz"));
    if (!tgzName) throw new Error("npm pack produced no tarball");
    const tgzPath = path.join(tmpDir, tgzName);

    const consumerDir = path.join(tmpDir, "consumer");
    fs.mkdirSync(consumerDir, { recursive: true });
    fs.writeFileSync(
      path.join(consumerDir, "package.json"),
      JSON.stringify({ name: "e", private: true, type: "module" }, null, 2)
    );
    execFileSync("npm", ["install", tgzPath], {
      cwd: consumerDir,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, npm_config_audit: "false", npm_config_fund: "false" },
    });

    const fixtureDir = path.join(packageRoot, "__fixtures__/consumption/esm");
    const testFile = path.join(consumerDir, "fixture.mjs");
    fs.copyFileSync(path.join(fixtureDir, "index.mjs"), testFile);
    const out = execFileSync("node", [testFile], {
      cwd: consumerDir,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    expect(out).toBe("");
  });
});
