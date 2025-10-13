export default {
  env: process.env.NODE_ENV || 'development',
  port: 2333,
  apiKey: process.env.ANTHROPIC_API_KEY!,
  node_url: process.env.NODE_URL!,

  // XVerse API Configuration
  xverseApiKey: process.env.XVERSE_API_KEY!,
  bitcoinNetwork: process.env.BITCOIN_NETWORK || 'mainnet',
  xverseBaseUrl: process.env.XVERSE_BASE_URL,

  db: {
    postgres: {
      host: process.env.DB_HOST!,
      port: parseInt(process.env.DB_PORT || '5432'),
      username: process.env.DB_USERNAME!,
      password: process.env.DB_PASSWORD || undefined,
      database: process.env.DB_NAME!,
    },
  },
};
