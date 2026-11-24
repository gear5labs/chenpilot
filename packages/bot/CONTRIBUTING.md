# Contributing to `@chen-pilot/bot`

Welcome to the `@chen-pilot/bot` package! This package provides the unified Telegram and Discord bots for the Chen Pilot DeFi operations gateway.

---

## 🏛️ Architecture & Boundaries

`@chen-pilot/bot` acts strictly as an interaction and presentation adapter:

```text
[ Telegram / Discord Events ]
              │
              ▼
    [ Bot Adapter Layer ]
              │
              ▼
      [ Command Router ]
              │
              ▼
   [ Interaction Handler ]
              │
              ▼
    [ @chen-pilot/sdk-core ] ──► [ Stellar / Soroban ]
```

### Boundary Constraints
1. **No Direct Blockchain Access**: The bot package must **never** make direct RPC calls, manipulate secret keys directly, or submit Soroban contract invocations without going through `@chen-pilot/sdk-core`.
2. **Stateless Operations**: Interaction handlers should not maintain persistent business state in memory; use Redis or database storage when state is required.
3. **Graceful Degradation**: Outages in Discord or Telegram APIs must not compromise wallet keys or ongoing multi-sig sessions.

---

## ⚙️ Development Commands

From repository root:
```bash
# Build the bot package
pnpm --filter @chen-pilot/bot build

# Run in development mode (hot reloading via ts-node)
pnpm --filter @chen-pilot/bot dev

# Start compiled output
pnpm --filter @chen-pilot/bot start
```

Or from `packages/bot`:
```bash
cd packages/bot
pnpm run build
pnpm run dev
pnpm run start
```

---

## 🔐 Environment Configuration

Copy `.env.example` to `.env` inside `packages/bot` (or use workspace root `.env`):

```bash
cp .env.example .env
```

Key variables:
- `TELEGRAM_BOT_TOKEN`: Token obtained from `@BotFather`.
- `DISCORD_BOT_TOKEN`: Discord Application Bot token.
- `DISCORD_CLIENT_ID`: Discord Application Client ID.

---

## 🧪 Clean-Checkout Validation

To verify the package on a clean clone:
```bash
git clone <repo>
cd chenpilot
pnpm install --frozen-lockfile
pnpm --filter @chen-pilot/bot build
```
Ensure build exits with code `0`.
