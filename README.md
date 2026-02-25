# Chen Pilot - AI Agent for Cross-Chain DeFi Operations

Chen Pilot is an intelligent AI agent that enables seamless interaction with blockchain networks and DeFi protocols through natural language commands. This agent provides a unified interface for managing Bitcoin wallets, Stellar operations, cross-chain swaps, and DeFi lending/borrowing activities.

---

## Prerequisites

- Node.js 18+
- PostgreSQL database
- Environment variables configured (see Configuration section)

---

## 🛠️ Installation

### Clone the repository

```bash
git clone <repository-url>
cd chenpilot-experimental
```

### Install dependencies

```bash
pnpm install
```

### Set up environment variables

```bash
cp .env.example .env
# Edit .env with your configuration
```

### Set up the database

```bash
npm run migration:run
```

### Start the development server

```bash
npm run dev
```

---

## 🧹 Code Quality & Git Hooks

This project uses **Husky**, **lint-staged**, and **commitlint** to enforce code quality and commit message standards.

### What Runs Automatically

- **pre-commit**
  - Runs ESLint with auto-fix
  - Runs Prettier formatting
  - Blocks commits if checks fail

- **commit-msg**
  - Validates commit messages using Commitlint
  - Enforces Conventional Commits format
  - Blocks commits with invalid commit messages

This setup helps maintain consistent code style and a clean, readable git history.

---

### Local Setup

Git hooks are enabled automatically after installing dependencies:

```bash
pnpm install
```

If hooks do not run for any reason, re-enable Husky manually:

```bash
pnpm exec husky install
```

---

### Configuration Overview

#### pre-commit hook

```sh
pnpm exec lint-staged
```

#### commit-msg hook

```sh
pnpm exec commitlint --edit $1
```

#### lint-staged configuration

```json
{
  "**/*.{ts,tsx}": ["eslint --fix", "prettier --write"]
}
```

#### commitlint configuration

Commit messages must follow the **Conventional Commits** specification.

Examples of valid commit messages:

```text
feat: add cross-chain swap workflow
fix: handle null wallet address
chore: update dependencies
docs: update README
```

---

### Skipping Hooks (Not Recommended)

Hooks can be skipped in exceptional cases:

```bash
git commit --no-verify
```

> ⚠️ Use sparingly. CI checks will still run and invalid commits may be rejected.

---

## Workflow System

The agent uses an intelligent workflow system that:

- **Parses Intent:** Understands natural language commands
- **Plans Workflow:** Creates step-by-step execution plans
- **Executes Tools:** Runs appropriate tools in sequence
- **Manages State:** Tracks operation status and results
- **Provides Feedback:** Returns structured responses

---

## SDK Idempotency for BTC → Stellar Swaps

Use the SDK idempotency helpers to guarantee retries do not create duplicate intents.

```ts
import {
  AgentClient,
  createBtcToStellarSwapIdempotencyKey,
  ChainId,
} from "@chen-pilot/sdk-core";

const client = new AgentClient({ baseUrl: "https://your-chenpilot-api" });

const swapRequest = {
  fromChain: ChainId.BITCOIN,
  toChain: ChainId.STELLAR,
  fromToken: "BTC",
  toToken: "XLM",
  amount: "0.01",
  destinationAddress: "G...",
};

// Generate once, persist in your app state, and reuse on retries
const idempotencyKey = createBtcToStellarSwapIdempotencyKey(
  swapRequest,
  "wallet-action-123"
);

await client.executeBtcToStellarSwap(swapRequest, {
  userId: "user-uuid",
  idempotencyKey,
  maxRetries: 3,
});
```

If a timeout/network failure happens, call `executeBtcToStellarSwap` again with the same `idempotencyKey`.

---

## SDK API Docs (TypeDoc)

The SDK package includes TypeDoc configuration for automated HTML API reference generation.

### Generate docs locally

```bash
cd packages/sdk
npm install
npm run docs
```

Generated output is written to:

```bash
packages/sdk/docs
```

### Automated publishing on push to `main`

GitHub Actions workflow: `.github/workflows/sdk-docs.yml`

On each push to `main`, the workflow:

1. Installs SDK dependencies
2. Runs `npm run docs` in `packages/sdk`
3. Deploys the generated HTML docs to GitHub Pages

---

## Contributing

- Fork the repository
- Create a feature branch
- Make your changes
- Ensure pre-commit and commit message checks pass
- Add tests if applicable
- Submit a pull request

---

## License

This project is licensed under the ISC License.

---

## Support

For support and questions:

- Create an issue in the repository
- Check the API health endpoints
- Review the logs for error details

---

Chen Pilot — Your intelligent gateway to cross-chain DeFi operations

```

```
