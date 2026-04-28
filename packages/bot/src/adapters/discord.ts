import { Client, GatewayIntentBits, Message, TextChannel } from 'discord.js';
import { TransactionNotificationData } from './types';
import { createTrustlineOperation } from '@chen-pilot/sdk-core';

export class DiscordAdapter {
  private client: Client;
  private userChannels: Map<string, string> = new Map(); // userId -> channelId
  private token: string;
  private backendUrl: string = process.env.BACKEND_URL || 'http://localhost:2333';

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

      if (message.content === "!start") {
        await message.reply(
          "Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant."
        );
      }

      if (message.content === "!help") {
        await message.reply(
          "**Commands:**\n`!start`, `!help`, `!sponsor`, `!trustline`, `!amm`"
        );
      }

      if (message.content === "!sponsor") {
        const userId = message.author.id;
        await message.reply("⏳ Requesting account sponsorship...");

        try {
          const response = await fetch(
            `${this.backendUrl}/api/account/${userId}/sponsor`,
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
      }

      if (message.content.startsWith('!trustline')) {
        const args = message.content.split(' ').slice(1);
        if (args.length < 1) {
          return message.reply('Usage: !trustline <assetCode> [issuerDomain|issuerAddress]\nExample: !trustline USDC circle.com');
        }

        const assetCode = args[0];
        const assetIssuer = args[1];

        if (!assetIssuer) {
          return message.reply(`Please provide an issuer domain or address for ${assetCode}.`);
        }

        try {
          await message.reply(`🔍 Looking up asset ${assetCode} from ${assetIssuer}...`);
          const op = await createTrustlineOperation(assetCode, assetIssuer);
          
          let response = `✅ Found asset ${assetCode}!\n\n`;
          response += `To add this trustline, you can use the following details in your wallet:\n`;
          response += `**Asset:** ${assetCode}\n`;
          response += `**Issuer:** \`${(op as any).asset.issuer}\`\n\n`;
          response += `*Note: In a future update, I will provide a direct signing link.*`;
          
          await message.reply(response);
        } catch (error) {
          await message.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      if (message.content.startsWith('!amm')) {
        const args = message.content.split(' ').slice(1);
        if (args.length < 1) {
          let helpMsg = '🔍 **AMM Explorer**\n\n';
          helpMsg += 'Use this command to search for liquidity pools and view their metrics.\n\n';
          helpMsg += '**Usage:**\n';
          helpMsg += '• `!amm search <assetA> <assetB>`\n';
          helpMsg += '• `!amm stats <poolId>`\n\n';
          helpMsg += '**Examples:**\n';
          helpMsg += '• `!amm search XLM USDC`\n';
          helpMsg += '• `!amm search XLM yXLM:GBSH...`\n';
          helpMsg += '• `!amm stats 65f...a1b`';
          
          return message.reply(helpMsg);
        }

        const subCommand = args[0].toLowerCase();
        const horizonUrl = process.env.STELLAR_HORIZON_URL || 'https://horizon.stellar.org';

        try {
          if (subCommand === 'search') {
            if (args.length < 3) {
              return message.reply('❌ Usage: `!amm search <assetA> <assetB>`');
            }
            const assetA = args[1];
            const assetB = args[2];
            await message.reply(`🔍 Searching for **${assetA}/${assetB}** pools...`);

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
              return message.reply(`❌ No liquidity pools found for **${assetA}/${assetB}**.`);
            }

            let responseMsg = `✅ **Found ${pools.length} pool(s) for ${assetA}/${assetB}:**\n\n`;
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

              responseMsg += `🔹 **Pool** \`${shortId}\`\n`;
              responseMsg += `💰 **Reserves:**\n`;
              responseMsg += `  • ${reserveA.toLocaleString()} ${resA.asset.split(':')[0]}\n`;
              responseMsg += `  • ${reserveB.toLocaleString()} ${resB.asset.split(':')[0]}\n`;
              responseMsg += `📊 **Fee:** ${(p.fee_bp / 100).toFixed(2)}% | **APR:** ${apr}%\n`;
              responseMsg += `🔗 \`!amm stats ${p.id}\`\n\n`;
            });

            if (pools.length > 5) {
              responseMsg += `*...and ${pools.length - 5} more.*`;
            }

            await message.reply(responseMsg);
          } else if (subCommand === 'stats') {
            if (args.length < 2) {
              return message.reply('❌ Usage: `!amm stats <poolId>`');
            }
            const poolId = args[1];
            await message.reply(`📊 Fetching stats for pool \`${poolId.slice(0, 8)}...\``);

            const response = await fetch(`${horizonUrl}/liquidity_pools/${poolId}`);
            if (response.status === 404) {
              return message.reply('❌ Liquidity pool not found.');
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

            let responseMsg = `📊 **Liquidity Pool Metrics**\n\n`;
            responseMsg += `🆔 **ID:** \`${p.id}\`\n\n`;
            
            responseMsg += `**Assets:**\n`;
            responseMsg += `• ${resA.asset}\n`;
            responseMsg += `• ${resB.asset}\n\n`;
            
            responseMsg += `**Reserves:**\n`;
            responseMsg += `• **${reserveA.toLocaleString()}** ${resA.asset.split(':')[0]}\n`;
            responseMsg += `• **${reserveB.toLocaleString()}** ${resB.asset.split(':')[0]}\n\n`;
            
            responseMsg += `**Statistics:**\n`;
            responseMsg += `• **Shares:** ${parseFloat(p.total_shares).toLocaleString()}\n`;
            responseMsg += `• **Trustlines:** ${p.total_trustlines}\n`;
            responseMsg += `• **Fee:** ${(p.fee_bp / 100).toFixed(2)}%\n`;
            responseMsg += `• **APR:** ${apr}%\n`;

            await message.reply(responseMsg);
          } else {
            await message.reply('❓ Unknown subcommand. Use `search` or `stats`.');
          }
        } catch (error) {
          console.error('AMM Explorer error:', error);
          await message.reply(`❌ **Error:** ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
      }
    });

    await this.client.login(token);
    console.log("✅ Discord bot initialized.");
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
