import { Telegraf } from 'telegraf';

export class TelegramAdapter {
  private bot: Telegraf | undefined;
  private token: string;

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
}
