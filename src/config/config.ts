require("dotenv").config();
export default {
  port: 2333,
  apiKey: process.env.ANTHROPIC_API_KEY!,
  node_url: process.env.NODE_URL!,
};
