import { Telegraf } from "telegraf";
import { TransactionNotificationData, Button, ButtonInteraction as GenericButtonInteraction, ButtonHandler } from "../types";
import { createTrustlineOperation } from "@chen-pilot/sdk-core";
import { searchFeatures, formatHelpMessage } from "../services/helpProvider";
import { AssetVerificationService } from "../assetVerification";
import {
  RateLimiter,
  DEFAULT_RATE_LIMIT,
  STRICT_RATE_LIMIT,
} from "../rateLimiter";
import {
  withPerformanceProfiling,
  extractCommandName,
} from "../performanceProfiler";
import { botWorkflowManager } from "../services/workflowService";

const BACKEND_URL =
  process.env.BACKEND_URL ||
  process.env.API_BASE_URL ||
  "http://localhost:2333";
import { createTrustlineOperation, AgentClient } from "@chen-pilot/sdk-core";
import { searchFeatures, formatHelpMessage, formatAiHelpMessage } from "../services/helpProvider";
import { AssetVerificationService } from '../assetVerification';
import { RateLimiter, DEFAULT_RATE_LIMIT, STRICT_RATE_LIMIT } from '../rateLimiter';
import { withPerformanceProfiling, extractCommandName } from '../performanceProfiler';
import { MultisigWizard } from '../multisigWizard';

const BACKEND_URL = process.env.BACKEND_URL || process.env.API_BASE_URL || 'http://localhost:2333';
const DASHBOARD_URL = process.env.DASHBOARD_URL || `${BACKEND_URL}/dashboard`;
const HORIZON_URL =
  process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org";
const DEBOUNCE_MS = 1000; // 1 second debounce between commands

// Commands that involve personal account data and must only be used in DMs
const DM_ONLY_COMMANDS = ['/balance', '/swap'];

// Commands that start a wizard
const WIZARD_COMMANDS = ['/multisig'];

// Commands that require stricter rate limiting
const SENSITIVE_COMMANDS = ["/trustline", "/validate"];

function isDM(ctx: Parameters<Parameters<Telegraf["command"]>[1]>[0]): boolean {
  return ctx.chat?.type === "private";
}

async function rejectPublicChannel(
  ctx: Parameters<Parameters<Telegraf["command"]>[1]>[0]
): Promise<void> {
  await ctx.reply(
    "🔒 This command contains sensitive account data and can only be used in a private message (DM) with the bot."
  );
}

export class TelegramAdapter {
  private bot: Telegraf | undefined;
  private token: string;
  private userChatIds: Map<string, string> = new Map(); // userId -> chatId
  // #145: Track last command timestamp per user
  private lastCommandTime: Map<number, number> = new Map();
  // #123: Rate limit limiters for bot commands
  private defaultRateLimiter: RateLimiter;
  private strictRateLimiter: RateLimiter;
  private verificationService: AssetVerificationService;
  // Button handlers map: buttonId -> ButtonHandler
  private buttonHandlers: Map<string, ButtonHandler> = new Map();
  // #114: AI agent client
  private agentClient: AgentClient;

  constructor(token: string) {
    this.token = token;
    this.verificationService = new AssetVerificationService(HORIZON_URL);
    // #123: Initialize rate limiters
    this.defaultRateLimiter = new RateLimiter(DEFAULT_RATE_LIMIT);
    this.strictRateLimiter = new RateLimiter(STRICT_RATE_LIMIT);
    // #114: Initialize AI agent client
    this.agentClient = new AgentClient({ baseUrl: BACKEND_URL });
  }

  // #145: Returns true if the user is flooding (within debounce window)
  private isFlooding(userId: number): boolean {
    const now = Date.now();
    const last = this.lastCommandTime.get(userId) ?? 0;
    if (now - last < DEBOUNCE_MS) return true;
    this.lastCommandTime.set(userId, now);
    return false;
  }

  // #123: Check rate limit for a user and command
  private checkRateLimit(
    userId: number,
    command: string
  ): { allowed: boolean; message?: string } {
    // Determine which rate limiter to use based on command
    const isSensitive = SENSITIVE_COMMANDS.some((cmd) =>
      command.startsWith(cmd)
    );
    const rateLimiter = isSensitive
      ? this.strictRateLimiter
      : this.defaultRateLimiter;

    const status = rateLimiter.check(String(userId));

    if (!status.allowed) {
      const retryAfter = status.retryAfter || 60;
      return {
        allowed: false,
        message: `⏳ Rate limit exceeded. Please wait ${retryAfter} seconds before trying again.`,
      };
    }

    return { allowed: true };
  }

  async init() {
    if (!this.token) {
      console.warn("⚠️ Telegram: No token provided, skipping initialization.");
      return;
    }

    this.bot = new Telegraf(this.token);

    // #145: Middleware to debounce all incoming messages/commands
    this.bot.use(async (ctx: Context, next: () => Promise<void>) => {
      const userId: number | undefined = ctx.from?.id;
      if (userId && this.isFlooding(userId)) {
        await ctx.reply(
          "⏳ Please wait a moment before sending another command."
        );
        return;
      }

      // #123: Rate limit check
      const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
      const command = text.split(" ")[0] || "";
      if (userId) {
        const rateLimitResult = this.checkRateLimit(userId, command);
        if (!rateLimitResult.allowed) {
          await ctx.reply(rateLimitResult.message!);
          return;
        }
      }

      return next();
    });

    // Handle callback queries (button presses)
    this.bot.on('callback_query', async (ctx: any) => {
      const buttonId = ctx.callbackQuery.data;
      const userId = String(ctx.from?.id || 'unknown');
      const chatId = String(ctx.chat?.id || '');

      const genericInteraction: GenericButtonInteraction = {
        platform: 'telegram',
        userId: userId,
        buttonId: buttonId,
        chatId: chatId,
        raw: ctx,
        reply: async (message: string) => {
          await ctx.answerCbQuery(); // Acknowledge the callback query
          await ctx.reply(message);
        }
      };

      const handler = this.buttonHandlers.get(buttonId);
      if (handler) {
        try {
          await handler(genericInteraction);
        } catch (error) {
          console.error('Error handling button interaction:', error);
          await ctx.answerCbQuery('❌ An error occurred while processing your button click.');
        }
      } else {
        await ctx.answerCbQuery('⚠️ No handler found for this button.');
      }
    });

    this.bot.start(async (ctx: any) => {
    this.bot.start(async (ctx: Context) => {
      const userId = String(ctx.from?.id || "unknown");
      await withPerformanceProfiling("/start", "telegram", userId, () =>
        ctx.reply(
          "Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant."
        )
      )();
    });
    this.bot.help(async (ctx: Context) => {
      const userId = String(ctx.from?.id || "unknown");
      await withPerformanceProfiling("/help", "telegram", userId, () =>
        ctx.reply(
          "Commands: /start, /balance, /swap, /trustline, /dashboard, /validate"
        )
      )();
    });

    this.bot.command("trustline", async (ctx: Context) => {
      const userId = String(ctx.from?.id || "unknown");
      const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
      const commandName = extractCommandName(text, "telegram");
      await withPerformanceProfiling(
        commandName,
        "telegram",
        userId,
        async () => {
          const args = text.split(" ").slice(1);
          if (args.length < 1) {
            return ctx.reply(
              "Usage: /trustline <assetCode> [issuerDomain|issuerAddress]\nExample: /trustline USDC circle.com"
            );
          }
      const userId = String(ctx.from?.id || 'unknown');
      await withPerformanceProfiling('/start', 'telegram', userId, () => ctx.reply('Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant.'))();
    });
    this.bot.help(async (ctx: Context) => {
      const userId = String(ctx.from?.id || 'unknown');
      await withPerformanceProfiling('/help', 'telegram', userId, async () => {
        // Extract query after /help command
        const messageText = ctx.message?.text || '';
        const query = messageText.replace(/^\/help\s*/i, '').trim();
        
        if (query.length > 0) {
          // Check if it's a natural language question vs keyword search
          const isNaturalLanguage = query.includes(" ") && !["swap", "balance", "trustline", "sponsor", "notify", "status", "price", "help"].includes(query.toLowerCase());
          
          if (isNaturalLanguage) {
            try {
              await ctx.reply("🤖 Thinking... Let me get you some help with that.");
              const response = await this.agentClient.query({
                userId,
                query,
              });
              const aiResponse = typeof response.result === 'string' ? response.result : (response.result as any).message || "Sorry, I couldn't help with that.";
              await ctx.reply(formatAiHelpMessage(aiResponse, "html"), { parse_mode: "HTML" });
            } catch (error) {
              // Fallback to keyword search if AI fails
              console.error("AI help failed, falling back to keyword search:", error);
              const results = searchFeatures(query);
              await ctx.reply(formatHelpMessage(results, true, "html"), { parse_mode: "HTML" });
            }
          } else {
            // Keyword search
            const results = searchFeatures(query);
            await ctx.reply(formatHelpMessage(results, true, "html"), { parse_mode: "HTML" });
          }
        } else {
          // Show all commands
          const results = searchFeatures(query);
          await ctx.reply(formatHelpMessage(results, false, "html"), { parse_mode: "HTML" });
        }
      })();
    });

    this.bot.command('trustline', async (ctx: Context) => {
      const userId = String(ctx.from?.id || 'unknown');
      const commandName = extractCommandName(ctx.message.text, 'telegram');
      await withPerformanceProfiling(commandName, 'telegram', userId, async () => {
        const args = ctx.message.text.split(' ').slice(1);
        if (args.length < 1) {
          return ctx.reply(
            "Usage: /trustline <assetCode> [issuerDomain|issuerAddress]\nExample: /trustline USDC circle.com"
          );
        }

          const assetCode = args[0];
          const assetIssuer = args[1];

          if (!assetIssuer) {
            return ctx.reply(
              `Please provide an issuer domain or address for ${assetCode}.`
            );
          }

          try {
            await ctx.reply(
              `🔍 Looking up asset ${assetCode} from ${assetIssuer}...`
            );
            const op = await createTrustlineOperation(assetCode, assetIssuer);

            // In a real scenario, we would generate a signing link (e.g., Albedo or Stellar Laboratory)
            // For now, we'll return the operation details
            let message = `✅ Found asset ${assetCode}!\n\n`;
            message += `To add this trustline, you can use the following details in your wallet:\n`;
            message += `<b>Asset:</b> ${assetCode}\n`;
            message += `<b>Issuer:</b> <code>${(op as { asset: { issuer: string } }).asset.issuer}</code>\n\n`;
            message += `<i>Note: In a future update, I will provide a direct signing link.</i>`;

            await ctx.reply(message, { parse_mode: "HTML" });
          } catch (error) {
            await ctx.reply(
              `❌ Error: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        try {
          await ctx.reply(
            `🔍 Looking up asset ${assetCode} from ${assetIssuer}...`
          );
          const op = await createTrustlineOperation(assetCode, assetIssuer);

          // In a real scenario, we would generate a signing link (e.g., Albedo or Stellar Laboratory)
          // For now, we'll return the operation details
          let message = `✅ Found asset ${assetCode}!\n\n`;
          message += `To add this trustline, you can use the following details in your wallet:\n`;
          message += `<b>Asset:</b> ${assetCode}\n`;
          message += `<b>Issuer:</b> <code>${(op as { asset: { issuer: string } }).asset.issuer}</code>\n\n`;
          message += `<i>Note: In a future update, I will provide a direct signing link.</i>`;

          await ctx.reply(message, { parse_mode: "HTML" });
        } catch (error) {
          await ctx.reply(
            `❌ Error: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      )();
    });

    // #134: Ping command — measure end-to-end latency
    this.bot.command("ping", async (ctx: Context) => {
      const userId = String(ctx.from?.id || "unknown");
      await withPerformanceProfiling("/ping", "telegram", userId, async () => {
    this.bot.command('ping', async (ctx: Context) => {
      const userId = String(ctx.from?.id || 'unknown');
      await withPerformanceProfiling('/ping', 'telegram', userId, async () => {
        const startTime = Date.now();
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), 5000);
          const response = await fetch(`${BACKEND_URL}/api/health`, {
            method: "GET",
            signal: controller.signal,
          });
          clearTimeout(timeout);
          const roundtripMs = Date.now() - startTime;
          if (response.ok) {
            await ctx.reply(
              `🏓 <b>Pong!</b>\n\n📡 <b>End-to-End Latency:</b> ${roundtripMs}ms\n✅ Backend: Online`,
              { parse_mode: "HTML" }
            );
          } else {
            await ctx.reply(
              `🏓 <b>Pong!</b>\n\n📡 <b>End-to-End Latency:</b> ${roundtripMs}ms\n⚠️ Backend: Returned HTTP ${response.status}`,
              { parse_mode: "HTML" }
            );
          }
        } catch {
          const roundtripMs = Date.now() - startTime;
          await ctx.reply(
            `🏓 <b>Pong!</b>\n\n📡 <b>End-to-End Latency:</b> ${roundtripMs}ms\n❌ Backend: Unreachable`,
            { parse_mode: "HTML" }
          );
        }
      })();
    });

    // #146: Dashboard command
    this.bot.command("dashboard", async (ctx: Context) => {
      const userId = String(ctx.from?.id || "unknown");
      await withPerformanceProfiling(
        "/dashboard",
        "telegram",
        userId,
        async () => {
          await ctx.reply(
            `📊 <b>Chen Pilot Dashboard</b>\n\nAccess your admin dashboard here:\n🔗 <a href="${DASHBOARD_URL}">Open Dashboard</a>\n\n<i>Note: You must be logged in to view the dashboard.</i>`,
            { parse_mode: "HTML" }
          );
        }
      )();
    });

    // #148: /validate command for Stellar asset verification
    this.bot.command("validate", async (ctx: Context) => {
      const userId = String(ctx.from?.id || "unknown");
      const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
      const commandName = extractCommandName(text, "telegram");
      await withPerformanceProfiling(
        commandName,
        "telegram",
        userId,
        async () => {
          const args = text.split(" ").slice(1);
          if (args.length < 2) {
            return ctx.reply(
              "Usage: /validate <assetCode> <issuerAddress>\nExample: /validate USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5"
            );
          }
    this.bot.command('dashboard', async (ctx: Context) => {
      const userId = String(ctx.from?.id || 'unknown');
      await withPerformanceProfiling('/dashboard', 'telegram', userId, async () => {
        await ctx.reply(
          `📊 <b>Chen Pilot Dashboard</b>\n\nAccess your admin dashboard here:\n🔗 <a href="${DASHBOARD_URL}">Open Dashboard</a>\n\n<i>Note: You must be logged in to view the dashboard.</i>`,
          { parse_mode: 'HTML' }
        );
      })();
    });

    // Example buttons command
    this.bot.command('buttons', async (ctx: any) => {
      const userId = String(ctx.from?.id || 'unknown');
      await withPerformanceProfiling('/buttons', 'telegram', userId, async () => {
        // Example buttons
        const buttons: Button[] = [
          { label: 'Primary', id: 'primary-btn', style: 'primary' },
          { label: 'Success', id: 'success-btn', style: 'success' },
          { label: 'Open Dashboard', id: 'dashboard-btn', url: DASHBOARD_URL }
        ];

        // Register example handlers
        this.registerButtonHandler('primary-btn', async (interaction) => {
          await interaction.reply('Primary button pressed!');
        });
        this.registerButtonHandler('success-btn', async (interaction) => {
          await interaction.reply('Success button pressed!');
        });

        const chatId = String(ctx.chat?.id || '');
        await this.sendWithButtons(chatId, 'Try pressing these buttons!', buttons);
    // #122: Feedback command for automated bug reporting
    this.bot.command('feedback', async (ctx: any) => {
      const userId = String(ctx.from?.id || 'unknown');
      await withPerformanceProfiling('/feedback', 'telegram', userId, async () => {
        const args = ctx.message.text.split(' ').slice(1).join(' ');
        
        if (!args) {
          return ctx.reply(
            '📝 <b>Feedback Command</b>\n\nUsage: /feedback <your message>\n\nExample: /feedback The balance command is not working properly\n\n<i>Your feedback will be automatically forwarded to the development team.</i>',
            { parse_mode: 'HTML' }
          );
        }

        try {
          // Capture technical details
          const feedbackData = {
            userId,
            username: ctx.from?.username || 'unknown',
            message: args,
            timestamp: new Date().toISOString(),
            platform: 'telegram',
            chatId: ctx.chat?.id,
          };

          // Send feedback to backend
          const response = await fetch(`${BACKEND_URL}/api/feedback`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(feedbackData),
          });

          if (response.ok) {
            await ctx.reply(
              '✅ <b>Feedback Received</b>\n\nThank you for your feedback! It has been automatically forwarded to the development team.\n\n<i>We will review it and take appropriate action.</i>',
              { parse_mode: 'HTML' }
            );
          } else {
            await ctx.reply(
              '⚠️ <b>Feedback Submission Failed</b>\n\nSorry, we couldn\'t submit your feedback at this time. Please try again later.',
              { parse_mode: 'HTML' }
            );
          }
        } catch (error) {
          await ctx.reply(
            '❌ <b>Error</b>\n\nAn error occurred while submitting your feedback. Please try again later.',
            { parse_mode: 'HTML' }
          );
        }
      })();
    });

    // #148: /validate command for Stellar asset verification
    this.bot.command('validate', async (ctx: Context) => {
      const userId = String(ctx.from?.id || 'unknown');
      const commandName = extractCommandName(ctx.message.text, 'telegram');
      await withPerformanceProfiling(commandName, 'telegram', userId, async () => {
        const args = ctx.message.text.split(' ').slice(1);
        if (args.length < 2) {
          return ctx.reply('Usage: /validate <assetCode> <issuerAddress>\nExample: /validate USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
        }

          const [assetCode, issuerAddress] = args;
          await ctx.reply(
            `🔍 Verifying asset <b>${assetCode}</b> from issuer <code>${issuerAddress.slice(0, 8)}...</code>`,
            { parse_mode: "HTML" }
          );

          try {
            const result = await this.verificationService.verifyAsset(
              assetCode,
              issuerAddress
            );
            const statusEmoji =
              result.status === "VERIFIED"
                ? "✅"
                : result.status === "MALICIOUS"
                  ? "🚨"
                  : "⚠️";

            let reply = `${statusEmoji} <b>Asset Verification: ${result.status}</b>\n\n`;
            reply += `<b>Asset:</b> ${assetCode}\n`;
            reply += `<b>Issuer:</b> <code>${issuerAddress}</code>\n`;
            if (result.domain) reply += `<b>Domain:</b> ${result.domain}\n`;
            if (result.details) reply += `<b>Details:</b> ${result.details}\n`;
            reply += `\n<b>Safe to use:</b> ${result.isSafe ? "Yes ✅" : "No ❌"}`;

            await ctx.reply(reply, { parse_mode: "HTML" });
          } catch (error) {
            await ctx.reply(
              `❌ Verification error: ${error instanceof Error ? error.message : String(error)}`
            );
          }
        }
      )();
    });

    // #125: Multisig wizard command
    this.bot.command("multisig", async (ctx: Context) => {
      const userId = String(ctx.from?.id || "unknown");
      if (!isDM(ctx)) {
        await rejectPublicChannel(ctx);
        return;
      }

      const response = await botWorkflowManager.startWorkflow(
        userId,
        "telegram",
        "multisig_wizard"
      );
      await ctx.reply(response.message);
    });

    this.bot.command("swap", async (ctx: Context) => {
      const userId = String(ctx.from?.id || "unknown");
    this.bot.command('multisig', async (ctx: Context) => {
      const userId = String(ctx.from?.id || 'unknown');
      if (!isDM(ctx)) {
        await rejectPublicChannel(ctx);
        return;
      }

      const response = await botWorkflowManager.startWorkflow(
        userId,
        "telegram",
        "swap_wizard"
      );
      await ctx.reply(response.message);
    });

    this.bot.command("help", async (ctx: Context) => {
      const userId = String(ctx.from?.id || "unknown");
      const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";
      await withPerformanceProfiling("/help", "telegram", userId, async () => {
        const args = text.split(" ").slice(1);
        if (args.length > 0) {
          const query = args.join(" ");
          const features = searchFeatures(query);
          const helpMsg = formatHelpMessage(features, query);
          await ctx.reply(helpMsg, { parse_mode: "HTML" });
        } else {
          await ctx.reply(
            "Commands: /start, /balance, /swap, /trustline, /dashboard, /validate, /multisig, /ping\n\nTry /help <feature> to learn more about a specific feature."
          );
        }
      })();
    });

    // #125: Handle wizard input (for active wizard sessions)
    this.bot.use(async (ctx: Context, next: () => Promise<void>) => {
      const userId = String(ctx.from?.id || "unknown");
      const text = ctx.message && "text" in ctx.message ? ctx.message.text : "";

      const response = await botWorkflowManager.handleInput(
        userId,
        "telegram",
        text
      );
      if (response) {
      const userId = String(ctx.from?.id || 'unknown');
      const text = ctx.message?.text || '';
      const command = text.split(' ')[0];

      const wizardState = this.multisigWizard.getWizardState(userId, 'telegram');
      if (wizardState && !WIZARD_COMMANDS.includes(command)) {
        const response = this.multisigWizard.processInput(userId, 'telegram', text);
        await ctx.reply(response.message);
        return;
      }

      return next();
    });

    // #112: Inline query handler for asset search
    this.bot.on('inline_query', async (ctx: any) => {
      const query = ctx.inlineQuery.query.trim();
      const userId = String(ctx.from?.id || 'unknown');

      await withPerformanceProfiling('inline_query', 'telegram', userId, async () => {
        if (query.length < 2) {
          // Return empty results for very short queries
          return ctx.answerInlineQuery([]);
        }

        try {
          // Search for assets via backend API
          const searchUrl = `${BACKEND_URL}/api/assets/search?q=${encodeURIComponent(query)}&limit=5`;
          const response = await fetch(searchUrl);
          
          if (!response.ok) {
            return ctx.answerInlineQuery([]);
          }

          const assets = await response.json() as Array<{
            code: string;
            issuer?: string;
            domain?: string;
            price?: number;
            priceChange24h?: number;
          }>;

          // Format results as inline query results
          const results = assets.map((asset, index) => ({
            type: 'article',
            id: `${asset.code}-${asset.issuer || 'native'}-${index}`,
            title: `${asset.code}${asset.domain ? ` (${asset.domain})` : ''}`,
            description: asset.price 
              ? `Price: $${asset.price.toFixed(4)} ${asset.priceChange24h !== undefined ? `| 24h: ${asset.priceChange24h >= 0 ? '+' : ''}${asset.priceChange24h.toFixed(2)}%` : ''}`
              : 'Stellar asset',
            input_message_content: {
              message_text: this.formatAssetInlineResult(asset),
              parse_mode: 'HTML'
            },
            thumb_url: asset.domain ? `https://www.google.com/s2/favicons?domain=${asset.domain}` : undefined,
          }));

          await ctx.answerInlineQuery(results, {
            cache_time: 300, // Cache results for 5 minutes
          });
        } catch (error) {
          console.error('Error handling inline query:', error);
          // Return empty results on error
          return ctx.answerInlineQuery([]);
        }
      })();
    });

    // #109: Swap command
    this.bot.command('swap', async (ctx: any) => {
      const userId = String(ctx.from?.id || 'unknown');
      await withPerformanceProfiling('/swap', 'telegram', userId, async () => {
        if (!isDM(ctx)) {
          await rejectPublicChannel(ctx);
          return;
        }

        const args = ctx.message.text.split(' ').slice(1);
        if (args.length < 3) {
          return ctx.replyWithHTML('Usage: <code>/swap &lt;fromAsset&gt; &lt;toAsset&gt; &lt;amount&gt;</code>\nExample: <code>/swap XLM USDC 100</code>');
        }

        const [fromAsset, toAsset, amountStr] = args;
        const amount = parseFloat(amountStr);

        if (isNaN(amount) || amount <= 0) {
          return ctx.replyWithHTML('❌ Amount must be a positive number.');
        }

        try {
          await ctx.replyWithHTML('🔄 Initiating swap...');
          const response = await this.agentClient.query({
            userId,
            query: `swap ${amount} ${fromAsset} to ${toAsset}`
          });

          const result = response.result;
          if (typeof result === 'string') {
            await ctx.replyWithHTML(result);
          } else if ((result as any).successful) {
            let reply = '✅ <b>Swap Successful!</b>\n\n';
            reply += `<b>From:</b> ${(result as any).from} ${(result as any).amount}\n`;
            reply += `<b>To:</b> ${(result as any).to}\n`;
            reply += `<b>Estimated Output:</b> ${(result as any).estimatedOutput}\n`;
            reply += `<b>Tx Hash:</b> <code>${(result as any).txHash}</code>`;
            await ctx.replyWithHTML(reply);
          } else {
            await ctx.replyWithHTML(`❌ Swap failed: ${(result as any).message || 'Unknown error'}`);
          }
        } catch (error) {
          console.error('Swap command error:', error);
          await ctx.replyWithHTML('❌ Could not complete the swap. Please try again later.');
        }
      })();
    });

    // #115: Settings command with WebApp
    this.bot.command('settings', async (ctx: any) => {
      const userId = String(ctx.from?.id || 'unknown');
      await withPerformanceProfiling('/settings', 'telegram', userId, async () => {
        const settingsUrl = `${BACKEND_URL}/settings`;
        await ctx.replyWithHTML('⚙️ <b>Open Settings</b>', {
          reply_markup: {
            inline_keyboard: [
              [
                {
                  text: 'Open Settings',
                  web_app: { url: settingsUrl }
                }
              ]
            ]
          }
        });
      })();
    });

    // Set bot commands for mobile menu
    await this.bot.telegram.setMyCommands([
      { command: "start", description: "Start the bot" },
      { command: "balance", description: "Check wallet balance" },
      { command: "swap", description: "Swap assets" },
      { command: "trustline", description: "Add trustline" },
      { command: "multisig", description: "Setup multisig wallet" },
      { command: "feedback", description: "Send feedback or report bugs" },
      { command: "settings", description: "Open settings" },
      { command: "help", description: "Show help" },
    ]);

    this.bot.launch();
    console.log("✅ Telegram bot initialized.");
  }

  // #147: Announce a new GitHub release to a specific chat
  async announceRelease(
    chatId: string,
    release: { tag_name: string; name: string; html_url: string; body?: string }
  ): Promise<boolean> {
    if (!this.bot) {
      console.warn("⚠️ Telegram bot not initialized");
      return false;
    }

    const body = release.body
      ? `\n\n${release.body.slice(0, 500)}${release.body.length > 500 ? "..." : ""}`
      : "";
    const message = `🚀 <b>New Release: ${release.name || release.tag_name}</b>${body}\n\n🔗 <a href="${release.html_url}">View on GitHub</a>`;

    try {
      await this.bot.telegram.sendMessage(chatId, message, {
        parse_mode: "HTML",
      });
      return true;
    } catch (error) {
      console.error("Error sending release announcement:", error);
      return false;
    }
  }

  async registerUser(userId: string, chatId: string): Promise<boolean> {
    this.userChatIds.set(userId, chatId);
    return true;
  }

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

  // #112: Format asset result for inline query
  private formatAssetInlineResult(asset: {
    code: string;
    issuer?: string;
    domain?: string;
    price?: number;
    priceChange24h?: number;
  }): string {
    let message = `💎 <b>${asset.code}</b>\n\n`;
    
    if (asset.domain) {
      message += `<b>Issuer:</b> ${asset.domain}\n`;
    }
    
    if (asset.price !== undefined) {
      message += `<b>Price:</b> $${asset.price.toFixed(4)}\n`;
      
      if (asset.priceChange24h !== undefined) {
        const changeEmoji = asset.priceChange24h >= 0 ? '📈' : '📉';
        const changeSign = asset.priceChange24h >= 0 ? '+' : '';
        message += `<b>24h:</b> ${changeEmoji} ${changeSign}${asset.priceChange24h.toFixed(2)}%\n`;
      }
    }
    
    message += `\n<i>Data from Chen Pilot</i>`;
    return message;
  }

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

  /**
   * Register a handler for button interactions
   */
  registerButtonHandler(buttonId: string, handler: ButtonHandler): void {
    this.buttonHandlers.set(buttonId, handler);
  }

  /**
   * Send a message with buttons to a specific chat
   */
  async sendWithButtons(chatId: string, content: string, buttons: Button[]): Promise<boolean> {
    if (!this.bot) {
      console.warn("⚠️ Telegram bot not initialized");
      return false;
    }

    try {
      // Build inline keyboard
      const keyboard = buttons.map(btn => {
        if (btn.url) {
          return [{ text: btn.label, url: btn.url }];
        } else {
          return [{ text: btn.label, callback_data: btn.id }];
        }
      });

      await this.bot.telegram.sendMessage(chatId, content, {
        parse_mode: "HTML",
        reply_markup: {
          inline_keyboard: keyboard
        }
      });

      return true;
    } catch (error) {
      console.error("Error sending message with buttons:", error);
      return false;
    }
  }
}
