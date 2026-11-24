# Contributing to `@chen-pilot/sdk-core`

Welcome to `@chen-pilot/sdk-core`! This package is the foundational client-side SDK for Chen Pilot cross-chain and Stellar/Soroban DeFi operations.

---

## 🏛️ Architecture & Boundaries

`@chen-pilot/sdk-core` is a **pure TypeScript library** with zero platform UI or chat adapter dependencies:

```text
[ Consumers: Web UI, CLI, @chen-pilot/bot ]
                     │
                     ▼
           [ @chen-pilot/sdk-core ]
  ┌──────────────────┴──────────────────┐
  ▼                                     ▼
[ Asset Intelligence ]        [ Unified Tx Builder ]
[ Network Intelligence ]      [ Signature Providers ]
                     │
                     ▼
          [ @stellar/stellar-sdk ]
                     │
                     ▼
          [ Stellar RPC / Horizon ]
```

### Boundary Constraints
1. **Platform Agnostic**: Must run in both Node.js (≥18) and modern browser runtimes. Never import chat client APIs (Discord, Telegraf) or DOM-specificglobals outside browser bundles.
2. **Cryptographic Safety**: Private key derivations must use standard BIP-39 and ED25519 HD keys. Sensitive key material must not be logged or exposed in error messages.
3. **Deterministic Fee & Sequence Handling**: Transaction builders must handle sequence collisions, fee bumps, and Soroban resource footprint calculations deterministically.

---

## ⚙️ Development Commands

From repository root:
```bash
# Build TypeScript artifacts (emits to dist/)
pnpm --filter @chen-pilot/sdk-core build

# Type check without emitting
pnpm --filter @chen-pilot/sdk-core type-check

# Run test suite
pnpm --filter @chen-pilot/sdk-core test

# Run conformance test suite
pnpm --filter @chen-pilot/sdk-core test:conformance

# Generate TypeDoc documentation
pnpm --filter @chen-pilot/sdk-core docs
```

Or from `packages/sdk`:
```bash
cd packages/sdk
pnpm run build
pnpm run type-check
pnpm run test
pnpm run test:conformance
```

---

## 🧪 Clean-Checkout Validation

To verify the SDK on a clean checkout:
```bash
git clone <repo>
cd chenpilot
pnpm install --frozen-lockfile
pnpm --filter @chen-pilot/sdk-core build
pnpm --filter @chen-pilot/sdk-core type-check
```
Both commands must exit with status `0`.
