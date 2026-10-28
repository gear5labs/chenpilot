import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  checkCommandContract,
  compareCommandContracts,
  formatCommandContractProblems,
} from "../../scripts/repo/discord-command-contract.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);

test("registered Discord slash commands match adapter command and option handlers", () => {
  const definitions = fs.readFileSync(
    path.join(repoRoot, "packages/bot/src/slashCommands.ts"),
    "utf8"
  );
  const adapter = fs.readFileSync(
    path.join(repoRoot, "packages/bot/src/adapters/discord.ts"),
    "utf8"
  );

  assert.deepEqual(checkCommandContract(definitions, adapter), {
    missing: [],
    stale: [],
    incompatible: [],
  });
});

test("reports missing, stale, and incompatible definitions with actionable details", () => {
  const problems = compareCommandContracts(
    [
      {
        name: "ping",
        options: [{ name: "target", type: "integer", required: true }],
      },
      { name: "old-command", options: [] },
    ],
    [
      {
        name: "missing-command",
        options: [{ name: "target", type: "string", required: true }],
      },
      {
        name: "ping",
        options: [{ name: "target", type: "string", required: true }],
      },
    ]
  );

  assert.deepEqual(problems.missing, [
    'Adapter handler "/missing-command" has no registered command definition.',
  ]);
  assert.deepEqual(problems.stale, [
    'Registered command definition "/old-command" has no adapter handler.',
  ]);
  assert.deepEqual(problems.incompatible, [
    '/ping option "target" is registered as integer, but the adapter reads string.',
  ]);

  const report = formatCommandContractProblems(problems);
  assert.match(report, /Missing command definitions:/);
  assert.match(report, /Stale command definitions:/);
  assert.match(report, /Incompatible command definitions:/);
});

test("treats requiredness changes and unhandled options as contract failures", () => {
  const problems = compareCommandContracts(
    [
      {
        name: "search",
        options: [
          { name: "query", type: "string", required: true },
          { name: "unused", type: "string", required: false },
        ],
      },
    ],
    [
      {
        name: "search",
        options: [{ name: "query", type: "string", required: false }],
      },
    ]
  );

  assert.deepEqual(problems.missing, []);
  assert.deepEqual(problems.stale, []);
  assert.deepEqual(problems.incompatible, [
    '/search option "query" is registered required, but the adapter reads it as optional.',
    '/search registers option "unused", but the adapter does not read it.',
  ]);
});
