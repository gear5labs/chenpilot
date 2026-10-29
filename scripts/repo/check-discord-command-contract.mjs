#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkCommandContract,
  formatCommandContractProblems,
} from "./discord-command-contract.mjs";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../.."
);
const definitionsPath = path.join(
  repoRoot,
  "packages/bot/src/slashCommands.ts"
);
const adapterPath = path.join(repoRoot, "packages/bot/src/adapters/discord.ts");
const problems = checkCommandContract(
  fs.readFileSync(definitionsPath, "utf8"),
  fs.readFileSync(adapterPath, "utf8")
);

const report = formatCommandContractProblems(problems);
if (report) {
  console.error(`Discord slash command contract check failed:\n${report}`);
  process.exitCode = 1;
} else {
  console.log(
    "Discord slash command definitions match adapter handlers and options."
  );
}
