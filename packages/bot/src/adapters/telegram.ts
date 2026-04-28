import { Telegraf } from 'telegraf';
import { TransactionNotificationData } from './types';
import { createTrustlineOperation } from '@chen-pilot/sdk-core';

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
    this.bot.help((ctx) => ctx.reply('Commands: /start, /balance, /swap, /trustline, /amm'));

    this.bot.command('amm', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) {
        let helpMsg = '🔍 <b>AMM Explorer</b>\n\n';
        helpMsg += 'Use this command to search for liquidity pools and view their metrics.\n\n';
        helpMsg += '<b>Usage:</b>\n';
        helpMsg += '• <code>/amm search &lt;assetA&gt; &lt;assetB&gt;</code>\n';
        helpMsg += '• <code>/amm stats &lt;poolId&gt;</code>\n\n';
        helpMsg += '<b>Examples:</b>\n';
        helpMsg += '• <code>/amm search XLM USDC</code>\n';
        helpMsg += '• <code>/amm search XLM yXLM:GBSH...</code>\n';
        helpMsg += '• <code>/amm stats 65f...a1b</code>';
        
        return ctx.reply(helpMsg, { parse_mode: 'HTML' });
      }

      const subCommand = args[0].toLowerCase();
      const horizonUrl = process.env.STELLAR_HORIZON_URL || 'https://horizon.stellar.org';

      try {
        if (subCommand === 'search') {
          if (args.length < 3) {
            return ctx.reply('❌ Usage: <code>/amm search &lt;assetA&gt; &lt;assetB&gt;</code>', { parse_mode: 'HTML' });
          }
          const assetA = args[1];
          const assetB = args[2];
          const loadingMsg = await ctx.reply(`🔍 Searching for <b>${assetA}/${assetB}</b> pools...`, { parse_mode: 'HTML' });

          const formatAsset = (a: string) => {
            const upper = a.toUpperCase();
            if (upper === 'XLM' || upper === 'NATIVE') return 'native';
            if (a.includes(':')) {
              const [code, issuer] = a.split(':');
              return `${code.toUpperCase()}:${issuer}`;
            }
            return a;
          };

          const response = await fetch(`${horizonUrl}/liquidity_pools?assets=${formatAsset(assetA)},${formatAsset(assetB)}`);
          const data = await response.json() as any;
          const pools = data._embedded?.records || [];

          if (pools.length === 0) {
            return ctx.reply(`❌ No liquidity pools found for <b>${assetA}/${assetB}</b>.`, { parse_mode: 'HTML' });
          }

          let message = `✅ <b>Found ${pools.length} pool(s) for ${assetA}/${assetB}:</b>\n\n`;
          pools.slice(0, 5).forEach((p: any) => {
            const resA = p.reserves[0];
            const resB = p.reserves[1];
            const shortId = `${p.id.slice(0, 8)}...${p.id.slice(-8)}`;
            
            // APR calculation
            const reserveA = parseFloat(resA.amount);
            const reserveB = parseFloat(resB.amount);
            const volumeEntry = p.volume ? p.volume[Object.keys(p.volume)[0]] : null;
            const volume24h = volumeEntry ? parseFloat(volumeEntry.base_volume) + parseFloat(volumeEntry.counter_volume) : 0;
            const totalLiquidity = reserveA + reserveB;
            const apr = totalLiquidity > 0 ? ((volume24h * 0.003 * 365) / totalLiquidity * 100).toFixed(2) : '0.00';

            message += `🔹 <b>Pool</b> <code>${shortId}</code>\n`;
            message += `💰 <b>Reserves:</b>\n`;
            message += `  • ${reserveA.toLocaleString()} ${resA.asset.split(':')[0]}\n`;
            message += `  • ${reserveB.toLocaleString()} ${resB.asset.split(':')[0]}\n`;
            message += `📊 <b>Fee:</b> ${(p.fee_bp / 100).toFixed(2)}% | <b>APR:</b> ${apr}%\n`;
            message += `🔗 <code>/amm stats ${p.id}</code>\n\n`;
          });

          if (pools.length > 5) {
            message += `<i>...and ${pools.length - 5} more.</i>`;
          }

          await ctx.reply(message, { parse_mode: 'HTML' });
        } else if (subCommand === 'stats') {
          if (args.length < 2) {
            return ctx.reply('❌ Usage: <code>/amm stats &lt;poolId&gt;</code>', { parse_mode: 'HTML' });
          }
          const poolId = args[1];
          await ctx.reply(`📊 Fetching stats for pool <code>${poolId.slice(0, 8)}...</code>`, { parse_mode: 'HTML' });

          const response = await fetch(`${horizonUrl}/liquidity_pools/${poolId}`);
          if (response.status === 404) {
            return ctx.reply('❌ Liquidity pool not found.');
          }
          const p = await response.json() as any;

          const resA = p.reserves[0];
          const resB = p.reserves[1];
          
          // APR calculation
          const reserveA = parseFloat(resA.amount);
          const reserveB = parseFloat(resB.amount);
          const volumeEntry = p.volume ? p.volume[Object.keys(p.volume)[0]] : null;
          const volume24h = volumeEntry ? parseFloat(volumeEntry.base_volume) + parseFloat(volumeEntry.counter_volume) : 0;
          const totalLiquidity = reserveA + reserveB;
          const apr = totalLiquidity > 0 ? ((volume24h * 0.003 * 365) / totalLiquidity * 100).toFixed(2) : '0.00';

          let message = `📊 <b>Liquidity Pool Metrics</b>\n\n`;
          message += `🆔 <b>ID:</b> <code>${p.id}</code>\n\n`;
          
          message += `<b>Assets:</b>\n`;
          message += `• ${resA.asset}\n`;
          message += `• ${resB.asset}\n\n`;
          
          message += `<b>Reserves:</b>\n`;
          message += `• <b>${reserveA.toLocaleString()}</b> ${resA.asset.split(':')[0]}\n`;
          message += `• <b>${reserveB.toLocaleString()}</b> ${resB.asset.split(':')[0]}\n\n`;
          
          message += `<b>Statistics:</b>\n`;
          message += `• <b>Shares:</b> ${parseFloat(p.total_shares).toLocaleString()}\n`;
          message += `• <b>Trustlines:</b> ${p.total_trustlines}\n`;
          message += `• <b>Fee:</b> ${(p.fee_bp / 100).toFixed(2)}%\n`;
          message += `• <b>APR:</b> ${apr}%\n`;

          await ctx.reply(message, { parse_mode: 'HTML' });
        } else {
          await ctx.reply('❓ Unknown subcommand. Use <b>search</b> or <b>stats</b>.', { parse_mode: 'HTML' });
        }
      } catch (error) {
        console.error('AMM Explorer error:', error);
        await ctx.reply(`❌ <b>Error:</b> ${error instanceof Error ? error.message : 'Unknown error'}`, { parse_mode: 'HTML' });
      }
    });

    this.bot.command('trustline', async (ctx) => {
      const args = ctx.message.text.split(' ').slice(1);
      if (args.length < 1) {
        return ctx.reply('Usage: /trustline <assetCode> [issuerDomain|issuerAddress]\nExample: /trustline USDC circle.com');
      }

      const assetCode = args[0];
      const assetIssuer = args[1];

      if (!assetIssuer) {
        return ctx.reply(`Please provide an issuer domain or address for ${assetCode}.`);
      }

      try {
        await ctx.reply(`🔍 Looking up asset ${assetCode} from ${assetIssuer}...`);
        const op = await createTrustlineOperation(assetCode, assetIssuer);
        
        // In a real scenario, we would generate a signing link (e.g., Albedo or Stellar Laboratory)
        // For now, we'll return the operation details
        let message = `✅ Found asset ${assetCode}!\n\n`;
        message += `To add this trustline, you can use the following details in your wallet:\n`;
        message += `<b>Asset:</b> ${assetCode}\n`;
        message += `<b>Issuer:</b> <code>${(op as any).asset.issuer}</code>\n\n`;
        message += `<i>Note: In a future update, I will provide a direct signing link.</i>`;
        
        await ctx.reply(message, { parse_mode: 'HTML' });
      } catch (error) {
        await ctx.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    this.bot.launch();
    console.log("✅ Telegram bot initialized.");
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
