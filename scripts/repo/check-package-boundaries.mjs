#!/usr/bin/env node
/**
 * Verify that packages in a workspace only use dependencies they declare.
 *
 * When pnpm hoists dependencies to root node_modules, a package can
 * accidentally import undeclared dependencies. This check prevents that
 * by scanning source files for imports and verifying all imported packages
 * are declared in the package manifest.
 *
 * Usage: node scripts/repo/check-package-boundaries.mjs
 */

import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = import.meta.dirname;
const projectRoot = path.resolve(__dirname, "../..");

/**
 * Parse package.json and extract all declared dependencies
 */
function getDeclaredDependencies(packageJsonPath) {
  const content = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  return {
    dependencies: { ...content.dependencies },
    devDependencies: { ...content.devDependencies },
    peerDependencies: { ...content.peerDependencies },
  };
}

/**
 * Extract import/require statements from source files
 */
function extractImports(
  sourceDir,
  extensions = [".ts", ".js", ".tsx", ".jsx"],
  includeTests = false
) {
  const imports = new Set();

  if (!fs.existsSync(sourceDir)) {
    return imports;
  }

  const walkDir = (dir) => {
    try {
      const files = fs.readdirSync(dir);
      for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
          // Skip node_modules and dist
          if (
            file === "node_modules" ||
            file === "dist" ||
            file === ".git" ||
            file === "__tests__"
          ) {
            continue;
          }
          walkDir(fullPath);
        } else if (extensions.some((ext) => file.endsWith(ext))) {
          // Skip test files unless explicitly included
          if (
            !includeTests &&
            (file.endsWith(".test.ts") ||
              file.endsWith(".test.js") ||
              file.endsWith(".spec.ts") ||
              file.endsWith(".spec.js"))
          ) {
            continue;
          }

          const content = fs.readFileSync(fullPath, "utf-8");

          // Match import/require statements
          const importRegex = /(?:import|require)\s*\(?["']([^"']+)["']/g;
          let match;
          while ((match = importRegex.exec(content)) !== null) {
            const moduleName = match[1];
            // Extract package name (handle scoped packages @org/package)
            const packageName = moduleName.startsWith("@")
              ? moduleName.split("/").slice(0, 2).join("/")
              : moduleName.split("/")[0];

            // Skip relative imports and built-ins
            if (!packageName.startsWith(".") && !isBuiltIn(packageName)) {
              imports.add(packageName);
            }
          }
        }
      }
    } catch (e) {
      // Skip if directory can't be read
    }
  };

  walkDir(sourceDir);
  return imports;
}

/**
 * Check if module is Node.js built-in
 */
function isBuiltIn(moduleName) {
  const builtIns = [
    "assert",
    "buffer",
    "child_process",
    "cluster",
    "crypto",
    "dgram",
    "dns",
    "domain",
    "events",
    "fs",
    "http",
    "https",
    "net",
    "os",
    "path",
    "punycode",
    "querystring",
    "readline",
    "repl",
    "stream",
    "string_decoder",
    "tls",
    "tty",
    "url",
    "util",
    "vm",
    "zlib",
    "async_hooks",
    "v8",
    "perf_hooks",
    "inspector",
    "module",
    "process",
    "worker_threads",
    "constants",
  ];
  return builtIns.includes(moduleName);
}

/**
 * Check a single package for undeclared dependencies
 */
function checkPackage(packageRoot) {
  const packageJsonPath = path.join(packageRoot, "package.json");
  const pkgJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8"));
  const packageName = pkgJson.name || path.basename(packageRoot);

  const declared = getDeclaredDependencies(packageJsonPath);
  const allDeclared = new Set([
    ...Object.keys(declared.dependencies || {}),
    ...Object.keys(declared.devDependencies || {}),
    ...Object.keys(declared.peerDependencies || {}),
  ]);

  // Extract imports from src (excluding test files)
  const srcImports = extractImports(
    path.join(packageRoot, "src"),
    undefined,
    false
  );
  const allImports = new Set([...srcImports]);

  const problems = [];
  for (const imported of allImports) {
    if (!allDeclared.has(imported)) {
      problems.push(
        `${packageName}: undeclared dependency "${imported}" is imported but not in package.json`
      );
    }
  }

  return { packageName, problems, imports: allImports, declared: allDeclared };
}

/**
 * Main check function
 */
function main() {
  const config = JSON.parse(
    fs.readFileSync(
      path.join(projectRoot, "scripts/repo/repo-check.config.json"),
      "utf-8"
    )
  );

  const packages = config.packageManifests.packages || ["."];
  const allProblems = [];

  console.log("Checking package boundaries...\n");

  for (const pkg of packages) {
    const packageRoot = path.join(projectRoot, pkg);
    if (!fs.existsSync(path.join(packageRoot, "package.json"))) {
      continue;
    }

    const { packageName, problems, imports, declared } =
      checkPackage(packageRoot);

    if (problems.length > 0) {
      allProblems.push(...problems);
      console.error(`✗ ${packageName}`);
      for (const problem of problems) {
        console.error(`  ${problem}`);
      }
    } else {
      console.log(`✓ ${packageName}`);
    }
  }

  console.log("");

  if (allProblems.length > 0) {
    console.error("✗ Package boundary check failed\n");
    console.error("To fix:");
    console.error("  1. Review the undeclared dependencies above");
    console.error(
      "  2. Add them to the package's package.json dependencies or devDependencies"
    );
    console.error("  3. Run: pnpm install");
    process.exit(1);
  }

  console.log("✓ All packages declare their dependencies");
}

main();
