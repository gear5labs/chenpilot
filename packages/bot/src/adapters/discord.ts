import { Client, GatewayIntentBits, Message, TextChannel } from 'discord.js';
import { TransactionNotificationData } from './types';
import { createTrustlineOperation } from '@chen-pilot/sdk-core';

const BACKEND_URL = process.env.NODE_URL || 'http://localhost:3000';

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
      console.warn("⚠️ Discord: No token provided, skipping initialization.");
      return;
    }

    this.client.once("ready", () => {
      console.log(`✅ Discord bot logged in as ${this.client.user?.tag}`);
    });

    this.client.on("messageCreate", async (message: Message) => {
      if (message.author.bot) return;

      const content = message.content;

      if (content === "!start") {
        await message.reply(
          "Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant."
        );
        return;
      }

      if (content === "!sponsor") {
        const userId = message.author.id;
        await message.reply("⏳ Requesting account sponsorship...");

        try {
          const response = await fetch(
            `${BACKEND_URL}/api/account/${userId}/sponsor`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
            }
          );
          const data = (await response.json()) as {
            success: boolean;
            message: string;
            address?: string;
          };

          if (data.success) {
            await message.reply(
              `✅ Account sponsored successfully!\n📬 Address: \`${data.address}\``
            );
          } else {
            await message.reply(`❌ Sponsorship failed: ${data.message}`);
          }
        } catch (error) {
          console.error("Sponsor command error:", error);
          await message.reply(
            "❌ Could not reach the sponsorship service. Please try again later."
          );
        }
        return;
      }

      if (content.startsWith('!trustline')) {
        const text = content.split(' ').slice(1).join(' ');
        if (!text) {
          return message.reply('Usage: !trustline <assetCode> [issuerDomain|issuerAddress] OR !trustline <description>\nExample: !trustline USDC circle.com OR !trustline the dollar stablecoin');
        }

        const args = text.split(' ');
        let assetCode = args[0];
        let assetIssuer = args[1];

        try {
          // If we only have one arg or it doesn't look like a code + issuer, try AI recognition
          if (!assetIssuer || assetCode.length > 12) {
            await message.reply(`🔍 AI is identifying the asset: "${text}"...`);
            const recognized = await this.recognizeAsset(text, message.author.id);
            
            if (recognized) {
              assetCode = recognized.assetCode;
              assetIssuer = recognized.issuer;
              await message.reply(`💡 AI recognized this as **${assetCode}**${assetIssuer ? ` from \`${assetIssuer}\`` : ''}.\n${recognized.description}`);
            } else if (!assetIssuer) {
              return message.reply(`❌ Could not recognize asset from "${text}". Please provide an asset code and issuer address/domain.`);
            }
          }

          if (!assetIssuer && assetCode !== 'XLM') {
            return message.reply(`Please provide an issuer domain or address for ${assetCode}.`);
          }

          await message.reply(`🔍 Looking up asset ${assetCode}${assetIssuer ? ` from ${assetIssuer}` : ''}...`);
          const op = await createTrustlineOperation(assetCode, assetIssuer || 'native');
          
          let response = `✅ Found asset ${assetCode}!\n\n`;
          response += `To add this trustline, you can use the following details in your wallet:\n`;
          response += `**Asset:** ${assetCode}\n`;
          response += `**Issuer:** \`${(op as any).asset.issuer || 'native'}\`\n\n`;
          response += `*Note: In a future update, I will provide a direct signing link.*`;
          
          await message.reply(response);
        } catch (error) {
          await message.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }

      // Handle natural language asset recognition
      if (!content.startsWith('!')) {
        const keywords = ['add', 'trustline', 'asset', 'coin', 'stablecoin', 'token'];
        const lowercaseText = content.toLowerCase();
        
        if (keywords.some(k => lowercaseText.includes(k))) {
          try {
            const recognized = await this.recognizeAsset(content, message.author.id);
            if (recognized && recognized.confidence > 0.8) {
              let response = `🤖 It sounds like you're talking about **${recognized.assetCode}**!\n\n`;
              response += `${recognized.description}\n\n`;
              response += `Would you like to add a trustline for this asset? Use \`!trustline ${recognized.assetCode} ${recognized.issuer || ''}\``;
              
              await message.reply(response);
            }
          } catch (error) {
            console.error("Passive AI recognition error:", error);
          }
        }
      }
    });

    await this.client.login(token);
    console.log("✅ Discord bot initialized.");
  }

  /**
   * Calls the backend AI asset recognition service
   */
  private async recognizeAsset(query: string, userId: string): Promise<any> {
    try {
      const response = await fetch(`${BACKEND_URL}/api/assets/recognize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, query })
      });

      const data = await response.json() as any;
      if (data.success) {
        return data.asset;
      }
      return null;
    } catch (error) {
      console.error("Error calling asset recognition API:", error);
      return null;
    }
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
      console.warn("⚠️ Discord bot not initialized");
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
      console.error("Error sending Discord notification:", error);
      return false;
    }
  }

  /**
   * Format transaction notification message
   */
  private formatTransactionMessage(data: TransactionNotificationData): string {
    const statusEmoji = data.successful ? "✅" : "❌";
    const timestamp = new Date(data.timestamp).toLocaleString();

    let message = `**Transaction ${data.successful ? "Confirmed" : "Failed"}** ${statusEmoji}\n\n`;
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
      console.warn("⚠️ Discord bot not initialized");
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
      console.error("Error sending Discord notification:", error);
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
