import { Telegraf } from 'telegraf';
import { TransactionNotificationData } from './types';
import { createTrustlineOperation } from '@chen-pilot/sdk-core';

const BACKEND_URL = process.env.NODE_URL || 'http://localhost:3000';

export class TelegramAdapter {
  private bot: Telegraf | undefined;
  private token: string;
  private userChatIds: Map<string, string> = new Map(); // userId -> chatId

  constructor(token: string) {
    this.token = token;
  }

  async init() {
    if (!this.token) {
      console.warn("⚠️ Telegram: No token provided, skipping initialization.");
      return;
    }

    this.bot = new Telegraf(this.token);

    this.bot.start((ctx) => ctx.reply('Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant.'));
    this.bot.help((ctx) => ctx.reply('Commands: /start, /balance, /swap, /trustline'));

    this.bot.command('trustline', async (ctx) => {
      const text = ctx.message.text.split(' ').slice(1).join(' ');
      if (!text) {
        return ctx.reply('Usage: /trustline <assetCode> [issuerDomain|issuerAddress] OR /trustline <description>\nExample: /trustline USDC circle.com OR /trustline the dollar stablecoin');
      }

      const args = text.split(' ');
      let assetCode = args[0];
      let assetIssuer = args[1];

      try {
        // If we only have one arg or it doesn't look like a code + issuer, try AI recognition
        if (!assetIssuer || assetCode.length > 12) {
          await ctx.reply(`🔍 AI is identifying the asset: "${text}"...`);
          const recognized = await this.recognizeAsset(text, ctx.from.id.toString());
          
          if (recognized) {
            assetCode = recognized.assetCode;
            assetIssuer = recognized.issuer;
            await ctx.reply(`💡 AI recognized this as <b>${assetCode}</b>${assetIssuer ? ` from <code>${assetIssuer}</code>` : ''}.\n${recognized.description}`, { parse_mode: 'HTML' });
          } else if (!assetIssuer) {
            return ctx.reply(`❌ Could not recognize asset from "${text}". Please provide an asset code and issuer address/domain.`);
          }
        }

        if (!assetIssuer && assetCode !== 'XLM') {
          return ctx.reply(`Please provide an issuer domain or address for ${assetCode}.`);
        }

        await ctx.reply(`🔍 Looking up asset ${assetCode}${assetIssuer ? ` from ${assetIssuer}` : ''}...`);
        const op = await createTrustlineOperation(assetCode, assetIssuer || 'native');
        
        let message = `✅ Found asset ${assetCode}!\n\n`;
        message += `To add this trustline, you can use the following details in your wallet:\n`;
        message += `<b>Asset:</b> ${assetCode}\n`;
        message += `<b>Issuer:</b> <code>${(op as any).asset.issuer || 'native'}</code>\n\n`;
        message += `<i>Note: In a future update, I will provide a direct signing link.</i>`;
        
        await ctx.reply(message, { parse_mode: 'HTML' });
      } catch (error) {
        await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    // Handle natural language asset recognition
    this.bot.on('text', async (ctx, next) => {
      const text = ctx.message.text;
      if (text.startsWith('/') || text.toLowerCase().includes('trustline')) {
        return next();
      }

      // Simple heuristic: if message mentions "add", "trustline", "asset", or "coin"
      const keywords = ['add', 'trustline', 'asset', 'coin', 'stablecoin', 'token'];
      const lowercaseText = text.toLowerCase();
      
      if (keywords.some(k => lowercaseText.includes(k))) {
        try {
          const recognized = await this.recognizeAsset(text, ctx.from.id.toString());
          if (recognized && recognized.confidence > 0.8) {
            let message = `🤖 It sounds like you're talking about <b>${recognized.assetCode}</b>!\n\n`;
            message += `${recognized.description}\n\n`;
            message += `Would you like to add a trustline for this asset? Use <code>/trustline ${recognized.assetCode} ${recognized.issuer || ''}</code>`;
            
            await ctx.reply(message, { parse_mode: 'HTML' });
          }
        } catch (error) {
          // Silent error for passive recognition
          console.error("Passive AI recognition error:", error);
        }
      }
      return next();
    });

    this.bot.launch();
    console.log("✅ Telegram bot initialized.");
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
  async registerUser(userId: string, chatId: string): Promise<boolean> {
    this.userChatIds.set(userId, chatId);
    return true;
  }

  /**
   * Send a transaction confirmation notification
   */
  async sendTransactionNotification(
    userId: string,
    data: TransactionNotificationData
  ): Promise<boolean> {
    if (!this.bot) {
      console.warn("⚠️ Telegram bot not initialized");
      return false;
    }

    const chatId = this.userChatIds.get(userId);
    if (!chatId) {
      console.warn(`⚠️ No chat ID found for user ${userId}`);
      return false;
    }

    const message = this.formatTransactionMessage(data);

    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: "HTML",
      });
      return true;
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
      return false;
    }
  }

  /**
   * Format transaction notification message
   */
  private formatTransactionMessage(data: TransactionNotificationData): string {
    const statusEmoji = data.successful ? "✅" : "❌";
    const timestamp = new Date(data.timestamp).toLocaleString();

    let message = `<b>Transaction ${data.successful ? "Confirmed" : "Failed"}</b> ${statusEmoji}\n\n`;
    message += `📋 <b>Hash:</b> <code>${data.hash.slice(0, 8)}...${data.hash.slice(-8)}</code>\n`;
    message += `💰 <b>Amount:</b> ${data.amount} ${data.asset}\n`;
    message += `📤 <b>From:</b> <code>${data.from.slice(0, 4)}...${data.from.slice(-4)}</code>\n`;
    message += `📥 <b>To:</b> <code>${data.to.slice(0, 4)}...${data.to.slice(-4)}</code>\n`;
    message += `⏱️ <b>Time:</b> ${timestamp}\n`;

    if (data.fee) {
      message += `💵 <b>Fee:</b> ${data.fee} XLM\n`;
    }

    if (data.memo) {
      message += `📝 <b>Memo:</b> ${data.memo}\n`;
    }

    return message;
  }

  /**
   * Send a general notification to a user
   */
  async sendNotification(userId: string, message: string): Promise<boolean> {
    if (!this.bot) {
      console.warn("⚠️ Telegram bot not initialized");
      return false;
    }

    const chatId = this.userChatIds.get(userId);
    if (!chatId) {
      return false;
    }

    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: "HTML",
      });
      return true;
    } catch (error) {
      console.error("Error sending Telegram notification:", error);
      return false;
    }
  }
}
