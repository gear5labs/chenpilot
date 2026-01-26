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
````

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

* **pre-commit**

  * Runs ESLint with auto-fix
  * Runs Prettier formatting
  * Blocks commits if checks fail

* **commit-msg**

  * Validates commit messages using Commitlint
  * Enforces Conventional Commits format
  * Blocks commits with invalid commit messages

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
  "**/*.{ts,tsx}": [
    "eslint --fix",
    "prettier --write"
  ]
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

* **Parses Intent:** Understands natural language commands
* **Plans Workflow:** Creates step-by-step execution plans
* **Executes Tools:** Runs appropriate tools in sequence
* **Manages State:** Tracks operation status and results
* **Provides Feedback:** Returns structured responses

---

## Contributing

* Fork the repository
* Create a feature branch
* Make your changes
* Ensure pre-commit and commit message checks pass
* Add tests if applicable
* Submit a pull request

---

## License

This project is licensed under the ISC License.

---

## Support

For support and questions:

* Create an issue in the repository
* Check the API health endpoints
* Review the logs for error details

---

Chen Pilot — Your intelligent gateway to cross-chain DeFi operations

```
```
