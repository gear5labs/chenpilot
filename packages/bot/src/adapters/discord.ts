import { Client, GatewayIntentBits, Message, TextChannel } from 'discord.js';
import { TransactionNotificationData } from './types';

export class DiscordAdapter {
  private client: Client;
  private userChannels: Map<string, string> = new Map(); // userId -> channelId
  private token: string;

  constructor(token: string) {
    this.token = token;
    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
      ],
    });
  }

  async init() {
    const token = process.env.DISCORD_BOT_TOKEN || this.token;
    if (!token) {
      console.warn('⚠️ Discord: No token provided, skipping initialization.');
      return;
    }

    this.client.once('ready', () => {
      console.log(`✅ Discord bot logged in as ${this.client.user?.tag}`);
    });

    this.client.on('messageCreate', async (message: Message) => {
      if (message.author.bot) return;

      if (message.content === '!start') {
        await message.reply('Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant.');
      }
    });

    await this.client.login(token);
    console.log('✅ Discord bot initialized.');
  }

  /**
   * Register a user to receive notifications
   */
  async registerUser(userId: string, channelId: string): Promise<boolean> {
    this.userChannels.set(userId, channelId);
    return true;
  }

  /**
   * Send a transaction confirmation notification
   */
  async sendTransactionNotification(
    userId: string,
    data: TransactionNotificationData
  ): Promise<boolean> {
    if (!this.client || !this.client.user) {
      console.warn('⚠️ Discord bot not initialized');
      return false;
    }

    const channelId = this.userChannels.get(userId);
    if (!channelId) {
      console.warn(`⚠️ No channel ID found for user ${userId}`);
      return false;
    }

    const channel = this.client.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      console.warn(`⚠️ Channel ${channelId} not found`);
      return false;
    }

    const message = this.formatTransactionMessage(data);

    try {
      await channel.send(message);
      return true;
    } catch (error) {
      console.error('Error sending Discord notification:', error);
      return false;
    }
  }

  /**
   * Format transaction notification message
   */
  private formatTransactionMessage(data: TransactionNotificationData): string {
    const statusEmoji = data.successful ? '✅' : '❌';
    const timestamp = new Date(data.timestamp).toLocaleString();
    
    let message = `**Transaction ${data.successful ? 'Confirmed' : 'Failed'}** ${statusEmoji}\n\n`;
    message += `📋 **Hash:** \`${data.hash.slice(0, 8)}...${data.hash.slice(-8)}\`\n`;
    message += `💰 **Amount:** ${data.amount} ${data.asset}\n`;
    message += `📤 **From:** \`${data.from.slice(0, 4)}...${data.from.slice(-4)}\`\n`;
    message += `📥 **To:** \`${data.to.slice(0, 4)}...${data.to.slice(-4)}\`\n`;
    message += `⏱️ **Time:** ${timestamp}\n`;
    
    if (data.fee) {
      message += `💵 **Fee:** ${data.fee} XLM\n`;
    }
    
    if (data.memo) {
      message += `📝 **Memo:** ${data.memo}\n`;
    }

    return message;
  }

  /**
   * Send a general notification to a user
   */
  async sendNotification(userId: string, message: string): Promise<boolean> {
    if (!this.client || !this.client.user) {
      console.warn('⚠️ Discord bot not initialized');
      return false;
    }

    const channelId = this.userChannels.get(userId);
    if (!channelId) {
      return false;
    }

    const channel = this.client.channels.cache.get(channelId) as TextChannel;
    if (!channel) {
      return false;
    }

    try {
      await channel.send(message);
      return true;
    } catch (error) {
      console.error('Error sending Discord notification:', error);
      return false;
    }
  }

  /**
   * Get the Discord client
   */
  getClient(): Client {
    return this.client;
  }
}
