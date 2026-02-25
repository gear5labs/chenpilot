import { Client, GatewayIntentBits } from 'discord.js';

export class DiscordAdapter {
  private client: Client;

  constructor(token: string) {
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent
      ]
    });
  }

  async init() {
    const token = process.env.DISCORD_BOT_TOKEN;
    if (!token) {
      console.warn('⚠️ Discord: No token provided, skipping initialization.');
      return;
    }

    this.client.once('ready', () => {
      console.log(`✅ Discord bot logged in as ${this.client.user?.tag}`);
    });

    this.client.on('messageCreate', async (message) => {
      if (message.author.bot) return;

      if (message.content === '!start') {
        await message.reply('Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant.');
      }
    });

    await this.client.login(token);
    console.log('✅ Discord bot initialized.');
  }
}
