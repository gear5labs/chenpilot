require("dotenv").config();

export default {
  env: process.env.NODE_ENV || "development",
  port: 2333,
  apiKey: process.env.ANTHROPIC_API_KEY!,
  node_url: process.env.NODE_URL!,
  encryptionKey: process.env.ENCRYPTION_KEY!,
  stellar: {
    horizonUrl: process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org',
    networkPassphrase: process.env.STELLAR_NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015',
    network: process.env.STELLAR_NETWORK || 'TESTNET',
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
                                                                                                                                                          