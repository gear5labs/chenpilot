/**
 * Type shim for the workspace-root `stellar-sdk` dependency.
 *
 * The SDK package itself depends on `@stellar/stellar-sdk`; the root
 * `stellar-sdk` (used by memoUtils and some test files) is resolved from the
 * workspace root at runtime. Re-export its real types instead of declaring a
 * narrow ambient module that shadows them and breaks unrelated imports
 * (Asset, Operation, Keypair, ...).
 */
declare module "stellar-sdk" {
  export * from "@stellar/stellar-sdk";
}
