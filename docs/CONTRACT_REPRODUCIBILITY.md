# Contract Artifact Reproducibility (issue #998)

Contract wasm artifacts must be byte-reproducible from the same source. CI
builds the Soroban workspace **twice** into separate target directories and
compares the outputs after stripping known non-deterministic metadata.

## Running

```bash
# Build twice and compare (requires rust + wasm32-unknown-unknown)
node scripts/repo/check-contract-reproducibility.mjs

# Compare two prebuilt artifact directories
node scripts/repo/check-contract-reproducibility.mjs --dir-a /tmp/a --dir-b /tmp/b
```

## Non-deterministic metadata excluded from the comparison

These pieces of a wasm module are toolchain banners or local build context.
They vary between builds even when the compiled code is identical, so they are
removed **before** hashing and must not fail the check:

| Section | Why it is non-deterministic |
| --- | --- |
| `producers` | Records rustc / wasm-bindgen / wasm-opt versions and paths, which change across toolchains and CI images. |
| `name` | Symbol and function names; may embed local file paths and crate versions. |
| `comment` | Free-form toolchain banners (for example `wasm-opt` notes). |
| `.debug_*` | DWARF debug info (`.debug_info`, `.debug_line`, `.debug_str`, …). Absolute paths and compilation directories differ per machine. The workspace release profile already sets `strip = "debuginfo"`, but a custom profile or toolchain may still emit them. |

Every **non-custom** section (type, import, function, table, memory, global,
export, start, element, code, data, data count) is compared verbatim. A
deterministic custom section such as `target_features` is also compared
verbatim — if it changes, the build inputs changed.

## Adding a new non-deterministic section

If a toolchain starts emitting a new custom section that varies across builds
without changing codegen, add its name to `NON_DETERMINISTIC_SECTIONS` in
[`scripts/repo/check-contract-reproducibility.mjs`](../scripts/repo/check-contract-reproducibility.mjs)
and to the table above. Do **not** exclude a section whose contents are part
of the deployed contract's observable bytecode.

## Release profile

The workspace `Cargo.toml` release profile is already biased toward
reproducibility (`codegen-units = 1`, `lto = true`, `strip = "debuginfo"`,
`panic = "abort"`). Changing any of those flags can reintroduce non-determinism
and will fail this check.
