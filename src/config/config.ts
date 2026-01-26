require("dotenv").config();

export default {
  env:process.env.NODE_ENV|| 'development',
  port: 2333,
  apiKey: process.env.ANTHROPIC_API_KEY!,
  node_url: process.env.NODE_URL!,
  encryptionKey: process.env.ENCRYPTION_KEY!,
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
