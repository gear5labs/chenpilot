import dotenv from "dotenv";
import path from "path";

// Load .env.local first, then fall back to .env
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

type StellarNetwork = "testnet" | "public";

// Stellar network configurations
const STELLAR_NETWORKS: Record<
  StellarNetwork,
  {
    horizonUrl: string;
    networkPassphrase: string;
    friendbotUrl: string;
  }
> = {
  testnet: {
    horizonUrl: "https://horizon-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
    friendbotUrl: "https://friendbot.stellar.org",
  },
  public: {
    horizonUrl: "https://horizon.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
    friendbotUrl: "", // No friendbot on mainnet
  },
};

// Get Stellar network from environment, default to testnet
const stellarNetwork: StellarNetwork =
  (process.env.STELLAR_NETWORK as StellarNetwork) || "testnet";

// Validate network type
if (stellarNetwork !== "testnet" && stellarNetwork !== "public") {
  throw new Error(
    `Invalid STELLAR_NETWORK: ${process.env.STELLAR_NETWORK}. Must be "testnet" or "public"`,
  );
}

// Get network configuration
const stellarConfig = STELLAR_NETWORKS[stellarNetwork];

export default {
  env: process.env.NODE_ENV || "development",
  port: 2333,
  apiKey: process.env.ANTHROPIC_API_KEY!,
  node_url: process.env.NODE_URL!,
  encryptionKey: process.env.ENCRYPTION_KEY!,
  stellar: {
    network: stellarNetwork,
    horizonUrl: process.env.STELLAR_HORIZON_URL || stellarConfig.horizonUrl,
    networkPassphrase:
      process.env.STELLAR_NETWORK_PASSPHRASE || stellarConfig.networkPassphrase,
    friendbotUrl: stellarConfig.friendbotUrl,
  },
  db: {
    postgres: {
      host: process.env.DB_HOST!,
      port: parseInt(process.env.DB_PORT || "5432"),
      username: process.env.DB_USERNAME!,
      password: process.env.DB_PASSWORD || undefined,
      database: process.env.DB_NAME!,
    },
  },
};
