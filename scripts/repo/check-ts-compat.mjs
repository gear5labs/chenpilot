#!/usr/bin/env node
// Compiles the published SDK declarations and a fixture consumer against the
// documented minimum supported TypeScript version (issue #1000).
//
// Usage: node scripts/repo/check-ts-compat.mjs
//
// The documented minimum is declared in packages/sdk/package.json under
// `peerDependencies.typescript` and mirrored in scripts/repo/repo-check.config.json
// under `tsCompat.minimumTypeScript`. The check:
//   1. packs @chen-pilot/sdk-core,
//   2. installs it into a temp consumer together with typescript@minimum,
//   3. compiles a fixture that imports the package entry points (no source
//      path aliases) with skipLibCheck (dependency .d.ts noise is out of scope),
//   4. parses every published .d.ts with the minimum compiler to catch syntax
//      that requires a newer TypeScript.
//
// Exit non-zero and name the offending file/syntax when the declarations need
// a compiler newer than the documented minimum.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readRepoConfig } from "./config.mjs";

const require = createRequire(import.meta.url);

const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

/** Whether `range` (e.g. ">=4.5.0") includes `version` (e.g. "4.5.2"). */
export function peerRangeSatisfies(range, version) {
  const m = /^>=\s*(\d+)\.(\d+)\.(\d+)$/.exec(range.trim());
  if (!m) return range.includes(version);
  const [maj, min, pat] = m.slice(1).map(Number);
  const [vMaj, vMin, vPat] = version.split(".").map(Number);
  if (vMaj !== maj) return vMaj > maj;
  if (vMin !== min) return vMin > min;
  return vPat >= pat;
}

function readMinimumTypeScript(root) {
  const config = readRepoConfig(root).tsCompat;
  const sdkManifest = JSON.parse(
    fs.readFileSync(path.join(root, "packages/sdk/package.json"), "utf8")
  );
  const peer = sdkManifest.peerDependencies?.typescript ?? "";
  return {
    minimum: config.minimumTypeScript,
    peerRange: peer,
    consumerFixture: config.consumerFixture,
  };
}

/** Parse each published .d.ts with the given TypeScript module and return syntax problems. */
export function parseDeclarations(ts, distDir) {
  const problems = [];
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.name.endsWith(".d.ts")) files.push(abs);
    }
  };
  walk(distDir);
  for (const file of files.sort()) {
    const text = fs.readFileSync(file, "utf8");
    const source = ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
    const diagnostics = source.parseDiagnostics ?? [];
    for (const d of diagnostics) {
      const { line, character } = d.file
        ? d.file.getLineAndCharacterOfPosition(d.start)
        : { line: 0, character: 0 };
      problems.push(
        `${path.relative(distDir, file)}:${line + 1}:${character + 1} ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`
      );
    }
  }
  return problems;
}

/** Compile the fixture consumer with the minimum TypeScript in a temp dir. */
export function compileConsumer(root, { minimum, consumerFixture }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ts-compat-"));
  try {
    const packOut = execFileSync(
      "npm",
      ["pack", "--json", "--ignore-scripts", "--pack-destination", tmp],
      {
        cwd: path.join(root, "packages/sdk"),
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    const [{ filename }] = JSON.parse(packOut);
    const tarball = path.join(tmp, filename);

    fs.writeFileSync(
      path.join(tmp, "package.json"),
      JSON.stringify(
        {
          name: "ts-compat-consumer",
          private: true,
          version: "0.0.0",
          devDependencies: {
            typescript: minimum,
            "@chen-pilot/sdk-core": `file:${tarball}`,
          },
        },
        null,
        2
      )
    );
    execFileSync("npm", ["install", "--no-audit", "--no-fund", "--legacy-peer-deps"], {
      cwd: tmp,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const fixtureSrc = path.join(root, consumerFixture);
    const consumerTs = path.join(tmp, "consumer.ts");
    fs.copyFileSync(fixtureSrc, consumerTs);
    fs.writeFileSync(
      path.join(tmp, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            target: "ES2020",
            module: "commonjs",
            moduleResolution: "node",
            strict: true,
            esModuleInterop: true,
            skipLibCheck: true,
            noEmit: true,
            types: [],
          },
          include: ["consumer.ts"],
        },
        null,
        2
      )
    );

    const tsc = path.join(tmp, "node_modules/.bin/tsc");
    try {
      execFileSync(tsc, ["-p", "tsconfig.json"], {
        cwd: tmp,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      return { ok: true, output: "", tmp, tarball, sdkDist: path.join(tmp, "node_modules/@chen-pilot/sdk-core/dist") };
    } catch (error) {
      return {
        ok: false,
        output: String(error.stdout || "") + String(error.stderr || error.message),
        tmp,
        tarball,
        sdkDist: path.join(tmp, "node_modules/@chen-pilot/sdk-core/dist"),
      };
    }
  } catch (error) {
    fs.rmSync(tmp, { recursive: true, force: true });
    return {
      ok: false,
      output: `setup failed: ${String(error.stderr || error.message).trim()}`,
      tmp: null,
    };
  }
}

export function checkTsCompat(root) {
  const spec = readMinimumTypeScript(root);
  const problems = [];

  if (!spec.minimum) {
    problems.push("tsCompat.minimumTypeScript is not configured");
    return problems;
  }
  if (!peerRangeSatisfies(spec.peerRange, spec.minimum)) {
    problems.push(
      `packages/sdk/package.json peerDependencies.typescript is "${spec.peerRange}", which does not include the documented minimum "${spec.minimum}"`
    );
  }

  const result = compileConsumer(root, spec);
  try {
    if (!result.ok) {
      problems.push(
        `fixture consumer does not compile with typescript@${spec.minimum}:\n${result.output.trim()}`
      );
    }
    if (result.sdkDist && fs.existsSync(result.sdkDist)) {
      // Parse declarations with the just-installed minimum compiler.
      const ts = require(path.join(result.tmp, "node_modules/typescript"));
      for (const problem of parseDeclarations(ts, result.sdkDist)) {
        problems.push(
          `published declaration is not valid under typescript@${spec.minimum}: ${problem}`
        );
      }
    } else if (result.ok) {
      problems.push("packed SDK dist directory is missing after install");
    }
  } finally {
    if (result.tmp) fs.rmSync(result.tmp, { recursive: true, force: true });
  }
  return problems;
}

function main() {
  const spec = readMinimumTypeScript(REPO_ROOT);
  const problems = checkTsCompat(REPO_ROOT);
  for (const problem of problems) console.error(problem);
  if (problems.length > 0) {
    console.error(
      `\n${problems.length} TypeScript compatibility problem(s). The documented minimum is typescript@${spec.minimum}.`
    );
    process.exit(1);
  }
  console.log(
    `TypeScript compatibility: OK (declarations and consumer compile with typescript@${spec.minimum}).`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
