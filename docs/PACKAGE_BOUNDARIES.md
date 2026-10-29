# Package Boundaries Verification

## Purpose

The package boundaries check verifies that packages in the workspace only use dependencies they explicitly declare in their `package.json`. This prevents accidental dependencies on hoisted modules that would break clean installations.

## Problem

When using pnpm or npm workspaces, the package manager hoists shared dependencies to a root `node_modules` directory. This means a package can import a dependency that is:
- Declared in the root `package.json` but not in the package's `package.json`
- Installed by another package and hoisted up

Such "accidental" dependencies cause failures during clean installs of individual packages or in CI environments where dependencies are installed per-workspace instead of at the root.

## How It Works

The check:
1. Scans each package's source files (excluding test files)
2. Extracts all `import` and `require` statements
3. Verifies each imported package is declared in that package's manifest
4. Reports any undeclared dependencies found

### Running the Check

```bash
# Run the full repository checks (includes package boundaries)
pnpm run repo:check

# Run the check in isolation
node scripts/repo/check-package-boundaries.mjs
```

### Example Output

```
Checking package boundaries...
✓ chenpilot-experimental
✓ @chen-pilot/sdk-core
✓ All packages declare their dependencies
```

### Fixing Violations

If the check fails with undeclared dependencies:

```
✗ @my-package/foo
  @my-package/foo: undeclared dependency "lodash" is imported but not in package.json
```

**Fix:**
1. Add the dependency to the package's `package.json`:
   ```bash
   cd packages/foo
   pnpm add lodash
   ```
2. Run the check again to verify

## Implementation Details

- **Source scope**: Only main source files are checked (`/src`), not tests
- **Built-in modules**: Node.js built-in modules are excluded
- **Relative imports**: Relative imports (`./*`) are excluded
- **Test files**: `.test.ts`, `.test.js`, `.spec.ts`, `.spec.js` files in `/src` are skipped

## Integration

The check is part of the standard repository verification:
- Runs as part of `pnpm run repo:check`
- Runs in CI on every push and PR
- Included in the release gate checks

## See Also

- `scripts/repo/check-package-boundaries.mjs` - Implementation
- `tests/repo/package-boundaries.test.mjs` - Test suite
- `pnpm-workspace.yaml` - Workspace configuration
