export function getEnv() {
  const STARKNET_RPC_URL =
    process.env.STARKNET_RPC_URL ||
    "https://starknet-sepolia.public.blastapi.io/rpc/v0_8";
  const STRK_TOKEN_ADDRESS =
    process.env.STRK_TOKEN_ADDRESS ||
    "0x04718f5e71a3dd7f17a0a2b1a0985a0f9a7251d4dfd1b1a79cd0f9b0b0c0de8f"; // placeholder
  const STARKNET_DEFAULT_ACCOUNT = process.env.STARKNET_DEFAULT_ACCOUNT;
  const BITCOIN_NETWORK = process.env.BITCOIN_NETWORK || "TESTNET";
  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  const ANTHROPIC_MODEL =
    process.env.ANTHROPIC_MODEL || "claude-3-7-sonnet-latest";
  const ATOMIQ_REGISTRY_URL = process.env.ATOMIQ_REGISTRY_URL;
  const ATOMIQ_INTERMEDIARY_URL = process.env.ATOMIQ_INTERMEDIARY_URL;
  const MEMPOOL_API_URL = process.env.MEMPOOL_API_URL;
  const REQUEST_TIMEOUT_MS = process.env.REQUEST_TIMEOUT_MS
    ? Number(process.env.REQUEST_TIMEOUT_MS)
    : undefined;
  const USE_FIXED_PRICE = process.env.USE_FIXED_PRICE === "true";
  const FIXED_BTC_USD = process.env.FIXED_BTC_USD
    ? Number(process.env.FIXED_BTC_USD)
    : undefined;
  const FIXED_STRK_USD = process.env.FIXED_STRK_USD
    ? Number(process.env.FIXED_STRK_USD)
    : undefined;
  return {
    STARKNET_RPC_URL,
    STRK_TOKEN_ADDRESS,
    STARKNET_DEFAULT_ACCOUNT,
    BITCOIN_NETWORK,
    ANTHROPIC_API_KEY,
    ANTHROPIC_MODEL,
    ATOMIQ_REGISTRY_URL,
    ATOMIQ_INTERMEDIARY_URL,
    MEMPOOL_API_URL,
    REQUEST_TIMEOUT_MS,
    USE_FIXED_PRICE,
    FIXED_BTC_USD,
    FIXED_STRK_USD,
  };
}
