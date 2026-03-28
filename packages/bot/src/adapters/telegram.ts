import { Telegraf } from 'telegraf';
import { TransactionNotificationData } from './types';

export class TelegramAdapter {
  private bot: Telegraf | undefined;
  private token: string;
  private userChatIds: Map<string, string> = new Map(); // userId -> chatId

  constructor(token: string) {
    this.token = token;
  }

  async init() {
    if (!this.token) {
      console.warn('⚠️ Telegram: No token provided, skipping initialization.');
      return;
    }

    this.bot = new Telegraf(this.token);

    this.bot.start((ctx) => ctx.reply('Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant.'));
    this.bot.help((ctx) => ctx.reply('Commands: /start, /balance, /swap'));

    this.bot.launch();
    console.log('✅ Telegram bot initialized.');
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
      console.warn('⚠️ Telegram bot not initialized');
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
        parse_mode: 'HTML',
      });
      return true;
    } catch (error) {
      console.error('Error sending Telegram notification:', error);
      return false;
    }
  }

  /**
   * Format transaction notification message
   */
  private formatTransactionMessage(data: TransactionNotificationData): string {
    const statusEmoji = data.successful ? '✅' : '❌';
    const timestamp = new Date(data.timestamp).toLocaleString();
    
    let message = `<b>Transaction ${data.successful ? 'Confirmed' : 'Failed'}</b> ${statusEmoji}\n\n`;
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
      console.warn('⚠️ Telegram bot not initialized');
      return false;
    }

    const chatId = this.userChatIds.get(userId);
    if (!chatId) {
      return false;
    }

    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: 'HTML',
      });
      return true;
    } catch (error) {
      console.error('Error sending Telegram notification:', error);
      return false;
    }
  }
}
