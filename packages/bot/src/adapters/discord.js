"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.DiscordAdapter = void 0;
const discord_js_1 = require("discord.js");
const slashCommands_1 = require("../slashCommands");
const sdk_core_1 = require("@chen-pilot/sdk-core");
const helpProvider_1 = require("../services/helpProvider");
const assetVerification_1 = require("../assetVerification");
const rateLimiter_1 = require("../rateLimiter");
const performanceProfiler_1 = require("../performanceProfiler");
const multisigWizard_1 = require("../multisigWizard");
const scamDetection_1 = require("../scamDetection");
const marketOverview_1 = require("../marketOverview");
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const DASHBOARD_URL = process.env.DASHBOARD_URL || `${BACKEND_URL}/dashboard`;
const HORIZON_URL = process.env.STELLAR_HORIZON_URL || 'https://horizon-testnet.stellar.org';
const DEBOUNCE_MS = 2000;
// Role names required for advanced commands (#120)
const ADVANCED_ROLE_NAMES = (process.env.DISCORD_ADVANCED_ROLES || 'DeFi Pro,Whale,Admin').split(',').map(r => r.trim());
// Supported currencies for reports (#118)
const SUPPORTED_CURRENCIES = ['USD', 'XLM', 'BTC'];
// Commands that involve personal account data and must only be used in DMs
const DM_ONLY_COMMANDS = ['!balance', '!sponsor', '!swap'];
// Commands that start a wizard
const WIZARD_COMMANDS = ['!multisig'];
// Commands that require stricter rate limiting
const SENSITIVE_COMMANDS = ['!sponsor', '!trustline', '!validate'];
// #124: Scam detection configuration
const SCAM_DETECTION_ENABLED = process.env.DISCORD_SCAM_DETECTION_ENABLED !== 'false';
const SCAM_DETECTION_ACTION = (process.env.DISCORD_SCAM_DETECTION_ACTION || 'flag');
const SCAM_DETECTION_CHANNELS = (process.env.DISCORD_SCAM_DETECTION_CHANNELS || '').split(',').filter(c => c.trim());
// #128: Daily market overview digest configuration
const MARKET_OVERVIEW_ENABLED = process.env.DISCORD_MARKET_OVERVIEW_ENABLED === 'true';
const MARKET_OVERVIEW_CHANNEL_ID = process.env.DISCORD_MARKET_OVERVIEW_CHANNEL_ID || '';
const MARKET_OVERVIEW_TIME = process.env.DISCORD_MARKET_OVERVIEW_TIME || '09:00'; // Format: HH:MM in UTC
// Transaction thread logging (#113)
const TRANSACTION_THREAD_LOGGING_ENABLED = process.env.DISCORD_TRANSACTION_LOG_THREADS_ENABLED !== 'false';
const TRANSACTION_LOG_CHANNEL_ID = process.env.DISCORD_TRANSACTION_LOG_CHANNEL_ID || '';
const TRANSACTION_THREAD_ARCHIVE_MINUTES = Number(process.env.DISCORD_TRANSACTION_THREAD_ARCHIVE_MINUTES || '10080'); // default 7 days
function isDM(message) {
    return message.channel.type === discord_js_1.ChannelType.DM;
}
function rejectPublicChannel(message) {
    return __awaiter(this, void 0, void 0, function* () {
        yield message.reply('🔒 This command contains sensitive account data and can only be used in a Direct Message (DM) with the bot.');
    });
}
class DiscordAdapter {
    constructor(token, auditLogChannelId) {
        this.userChannels = new Map(); // userId -> channelId
        // #145: Track last command timestamp per user
        this.lastCommandTime = new Map();
        // #118: User preferred currency (userId -> currency)
        this.userCurrency = new Map();
        // #113: Map of userId -> threadId for transaction logs
        this.transactionThreads = new Map();
        // #119: Active price alerts
        this.priceAlerts = new Map();
        this.token = token;
        this.auditLogChannelId = auditLogChannelId || process.env.DISCORD_AUDIT_LOG_CHANNEL_ID;
        this.client = new discord_js_1.Client({
            intents: [
                discord_js_1.GatewayIntentBits.Guilds,
                discord_js_1.GatewayIntentBits.GuildMessages,
                discord_js_1.GatewayIntentBits.MessageContent,
            ],
        });
        this.verificationService = new assetVerification_1.AssetVerificationService(HORIZON_URL);
        // #125: Initialize multisig wizard
        this.multisigWizard = new multisigWizard_1.MultisigWizard();
        // #123: Initialize rate limiters
        this.defaultRateLimiter = new rateLimiter_1.RateLimiter(rateLimiter_1.DEFAULT_RATE_LIMIT);
        this.strictRateLimiter = new rateLimiter_1.RateLimiter(rateLimiter_1.STRICT_RATE_LIMIT);
        // #124: Initialize scam detection service
        this.scamDetectionService = new scamDetection_1.ScamDetectionService();
        // #128: Initialize market overview service
        this.marketOverviewService = new marketOverview_1.MarketOverviewService();
        // #114: Initialize AI agent client
        this.agentClient = new sdk_core_1.AgentClient({ baseUrl: BACKEND_URL });
    }
    // #145: Returns true if the user is flooding (within debounce window)
    isFlooding(userId) {
        var _a;
        const now = Date.now();
        const last = (_a = this.lastCommandTime.get(userId)) !== null && _a !== void 0 ? _a : 0;
        if (now - last < DEBOUNCE_MS)
            return true;
        this.lastCommandTime.set(userId, now);
        return false;
    }
    // #123: Check rate limit for a user and command
    checkRateLimit(userId, command) {
        // Determine which rate limiter to use based on command
        const isSensitive = SENSITIVE_COMMANDS.some(cmd => command.startsWith(cmd));
        const rateLimiter = isSensitive ? this.strictRateLimiter : this.defaultRateLimiter;
        const status = rateLimiter.check(userId);
        if (!status.allowed) {
            const retryAfter = status.retryAfter || 60;
            return {
                allowed: false,
                message: `⏳ Rate limit exceeded. Please wait ${retryAfter} seconds before trying again.`
            };
        }
        return { allowed: true };
    }
    // #124: Check if scam detection should be applied to a channel
    shouldScanForScams(message) {
        if (!SCAM_DETECTION_ENABLED)
            return false;
        if (isDM(message))
            return false; // Don't scan DMs
        // If specific channels are configured, only scan those
        if (SCAM_DETECTION_CHANNELS.length > 0) {
            return SCAM_DETECTION_CHANNELS.includes(message.channelId);
        }
        // Otherwise, scan all public channels
        return true;
    }
    // #124: Handle detected scam links
    handleScamDetection(message, result) {
        return __awaiter(this, void 0, void 0, function* () {
            const warningMessage = `🚨 **Potential Scam Link Detected**\n\n` +
                `**Reason:** ${result.reason}\n` +
                `**Pattern:** \`${result.matchedPattern}\`\n\n` +
                `This message has been ${SCAM_DETECTION_ACTION === 'block' ? 'blocked' : 'flagged'} for your safety.`;
            if (SCAM_DETECTION_ACTION === 'block') {
                yield message.delete();
                // Cast to TextChannel since we only scan public channels
                if (message.channel.type === discord_js_1.ChannelType.GuildText || message.channel.type === discord_js_1.ChannelType.GuildPublicThread || message.channel.type === discord_js_1.ChannelType.GuildPrivateThread) {
                    yield message.channel.send(warningMessage);
                }
            }
            else {
                yield message.reply(warningMessage);
            }
            // Log to audit channel if configured
            yield this.logAuditAction({
                action: 'SCAM_LINK_DETECTED',
                triggeredBy: message.author.id,
                details: `Reason: ${result.reason}, Pattern: ${result.matchedPattern}, Action: ${SCAM_DETECTION_ACTION}`,
                success: true,
                timestamp: new Date().toISOString(),
            });
        });
    }
    // #128: Calculate milliseconds until next scheduled market overview post
    getTimeUntilNextSchedule() {
        const [hours, minutes] = MARKET_OVERVIEW_TIME.split(':').map(Number);
        const now = new Date();
        const scheduledTime = new Date();
        scheduledTime.setUTCHours(hours, minutes, 0, 0);
        // If the scheduled time has already passed today, schedule for tomorrow
        if (scheduledTime <= now) {
            scheduledTime.setDate(scheduledTime.getDate() + 1);
        }
        return scheduledTime.getTime() - now.getTime();
    }
    // #128: Post daily market overview to configured channel
    postMarketOverview() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!MARKET_OVERVIEW_CHANNEL_ID) {
                console.warn('⚠️ Market overview channel ID not configured, skipping digest');
                return;
            }
            try {
                console.log('📊 Fetching daily market overview...');
                const marketData = yield this.marketOverviewService.fetchMarketOverview();
                const message = this.marketOverviewService.formatMarketOverviewMessage(marketData);
                const channel = this.client.channels.cache.get(MARKET_OVERVIEW_CHANNEL_ID);
                if (!channel) {
                    console.error(`❌ Market overview channel ${MARKET_OVERVIEW_CHANNEL_ID} not found`);
                    return;
                }
                yield channel.send(message);
                console.log('✅ Daily market overview posted successfully');
                yield this.logAuditAction({
                    action: 'MARKET_OVERVIEW_POSTED',
                    triggeredBy: 'system',
                    details: `Channel: ${MARKET_OVERVIEW_CHANNEL_ID}`,
                    success: true,
                    timestamp: new Date().toISOString(),
                });
            }
            catch (error) {
                console.error('❌ Error posting market overview:', error);
                yield this.logAuditAction({
                    action: 'MARKET_OVERVIEW_FAILED',
                    triggeredBy: 'system',
                    details: `Error: ${error instanceof Error ? error.message : String(error)}`,
                    success: false,
                    timestamp: new Date().toISOString(),
                });
            }
        });
    }
    // #128: Start the daily market overview scheduler
    startMarketOverviewScheduler() {
        if (!MARKET_OVERVIEW_ENABLED || !MARKET_OVERVIEW_CHANNEL_ID) {
            console.log('ℹ️ Market overview digest disabled or not configured');
            return;
        }
        const initialDelay = this.getTimeUntilNextSchedule();
        console.log(`📅 Market overview digest scheduled for ${MARKET_OVERVIEW_TIME} UTC (next post in ${Math.round(initialDelay / 1000 / 60)} minutes)`);
        // Schedule the first post
        setTimeout(() => __awaiter(this, void 0, void 0, function* () {
            yield this.postMarketOverview();
            // Then schedule daily posts (24 hours = 86400000 ms)
            this.marketOverviewInterval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
                yield this.postMarketOverview();
            }), 24 * 60 * 60 * 1000);
        }), initialDelay);
    }
    // Register slash commands with Discord via REST API
    deploySlashCommands() {
        return __awaiter(this, void 0, void 0, function* () {
            const token = process.env.DISCORD_BOT_TOKEN || this.token;
            const clientId = process.env.DISCORD_CLIENT_ID;
            if (!token || !clientId) {
                console.warn("⚠️ Discord: DISCORD_CLIENT_ID or token missing, skipping slash command deployment.");
                return;
            }
            const rest = new discord_js_1.REST({ version: "10" }).setToken(token);
            try {
                console.log("🔄 Deploying slash commands...");
                yield rest.put(discord_js_1.Routes.applicationCommands(clientId), {
                    body: slashCommands_1.slashCommandDefinitions,
                });
                console.log(`✅ Deployed ${slashCommands_1.slashCommandDefinitions.length} slash commands.`);
            }
            catch (error) {
                console.error("❌ Failed to deploy slash commands:", error);
            }
        });
    }
    init() {
        return __awaiter(this, void 0, void 0, function* () {
            const token = process.env.DISCORD_BOT_TOKEN || this.token;
            if (!token) {
                console.warn("⚠️ Discord: No token provided, skipping initialization.");
                return;
            }
            this.client.once("ready", () => {
                var _a;
                console.log(`✅ Discord bot logged in as ${(_a = this.client.user) === null || _a === void 0 ? void 0 : _a.tag}`);
                this.startStatusUpdates();
            });
            // Slash command interaction handler
            this.client.on("interactionCreate", (interaction) => __awaiter(this, void 0, void 0, function* () {
                if (!interaction.isChatInputCommand())
                    return;
                yield this.handleSlashCommand(interaction);
            }));
            this.client.on("messageCreate", (0, performanceProfiler_1.withPerformanceProfiling)('messageCreate', 'discord', 'system', (message) => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f;
                if (message.author.bot)
                    return;
                // Legacy ! prefix commands are deprecated. Please use slash commands (/) instead.
                const isLegacyCommand = message.content.startsWith('!');
                if (isLegacyCommand) {
                    yield message.reply('⚠️ **Deprecation Notice:** `!` prefix commands are deprecated. Please use `/` slash commands instead (e.g. `/help`, `/ping`).');
                    return;
                }
                // #124: Scan for scam links in public channels
                if (this.shouldScanForScams(message)) {
                    const scamResult = this.scamDetectionService.detectScamLinks(message.content);
                    if (scamResult.isScam) {
                        yield this.handleScamDetection(message, scamResult);
                        return; // Stop processing if scam is detected and blocked
                    }
                }
                const userId = message.author.id;
                const command = message.content.split(' ')[0];
                const commandName = (0, performanceProfiler_1.extractCommandName)(message.content, 'discord');
                // #145: Anti-flood check for all commands
                if (this.isFlooding(userId)) {
                    yield message.reply("⏳ Please wait a moment before sending another command.");
                    return;
                }
                // #123: Rate limit check
                const rateLimitResult = this.checkRateLimit(userId, command);
                if (!rateLimitResult.allowed) {
                    yield message.reply((_a = rateLimitResult.message) !== null && _a !== void 0 ? _a : '⏳ Rate limit exceeded. Please try again later.');
                    return;
                }
                // Wrap each command handler with performance profiling
                if (message.content === "!start") {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)('!start', 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        yield message.reply("Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant. Type !help to see what I can do!");
                    }))();
                }
                // #134: Ping command — measure end-to-end latency
                if (message.content === '!ping') {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)('!ping', 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        const startTime = Date.now();
                        try {
                            const controller = new AbortController();
                            const timeout = setTimeout(() => controller.abort(), 5000);
                            const response = yield fetch(`${BACKEND_URL}/api/health`, {
                                method: 'GET',
                                signal: controller.signal,
                            });
                            clearTimeout(timeout);
                            const roundtripMs = Date.now() - startTime;
                            if (response.ok) {
                                yield message.reply(`🏓 **Pong!**\n\n📡 **End-to-End Latency:** ${roundtripMs}ms\n✅ Backend: Online`);
                            }
                            else {
                                yield message.reply(`🏓 **Pong!**\n\n📡 **End-to-End Latency:** ${roundtripMs}ms\n⚠️ Backend: Returned HTTP ${response.status}`);
                            }
                        }
                        catch (_a) {
                            const roundtripMs = Date.now() - startTime;
                            yield message.reply(`🏓 **Pong!**\n\n📡 **End-to-End Latency:** ${roundtripMs}ms\n❌ Backend: Unreachable`);
                        }
                    }))();
                }
                if (message.content.startsWith("!help")) {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)(commandName, 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        const query = message.content.replace("!help", "").trim();
                        if (query.length > 0) {
                            // Check if it's a natural language question vs keyword search
                            const isNaturalLanguage = query.includes(" ") && !["swap", "balance", "trustline", "sponsor", "notify", "status", "price", "help"].includes(query.toLowerCase());
                            if (isNaturalLanguage) {
                                try {
                                    yield message.reply("🤖 Thinking... Let me get you some help with that.");
                                    const response = yield this.agentClient.query({
                                        userId,
                                        query,
                                    });
                                    // Assume AgentResponse has a message field, or use result directly
                                    const aiResponse = typeof response.result === 'string' ? response.result : response.result.message || "Sorry, I couldn't help with that.";
                                    yield message.reply((0, helpProvider_1.formatAiHelpMessage)(aiResponse, "markdown"));
                                }
                                catch (error) {
                                    // Fallback to keyword search if AI fails
                                    console.error("AI help failed, falling back to keyword search:", error);
                                    const results = (0, helpProvider_1.searchFeatures)(query);
                                    yield message.reply((0, helpProvider_1.formatHelpMessage)(results, true, "markdown"));
                                }
                            }
                            else {
                                // Keyword search
                                const results = (0, helpProvider_1.searchFeatures)(query);
                                yield message.reply((0, helpProvider_1.formatHelpMessage)(results, true, "markdown"));
                            }
                        }
                        else {
                            // Show all commands
                            const results = (0, helpProvider_1.searchFeatures)(query);
                            yield message.reply((0, helpProvider_1.formatHelpMessage)(results, false, "markdown"));
                        }
                    }))();
                }
                if (message.content === "!thread") {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)('!thread', 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        if (message.channel.type === discord_js_1.ChannelType.GuildText) {
                            try {
                                const thread = yield message.startThread({
                                    name: `Chen Pilot Session - ${message.author.username}`,
                                    autoArchiveDuration: 60,
                                });
                                yield thread.send(`👋 Hello ${message.author.username}! I've started this thread to keep our conversation organized. How can I help you with Stellar DeFi today?`);
                            }
                            catch (error) {
                                console.error("Error creating thread:", error);
                                yield message.reply("❌ I couldn't start a thread. Please make sure I have the 'Create Public Threads' permission.");
                            }
                        }
                        else if (message.channel.isThread()) {
                            yield message.reply("🧵 We are already in a thread! I'm ready to assist you here.");
                        }
                        else {
                            yield message.reply("❌ Threads can only be started in text channels.");
                        }
                    }))();
                }
                if (message.content === "!sponsor") {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)('!sponsor', 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        yield message.reply("⏳ Requesting account sponsorship...");
                        try {
                            const response = yield fetch(`${BACKEND_URL}/api/account/${userId}/sponsor`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                            });
                            const data = (yield response.json());
                            if (data.success) {
                                yield message.reply(`✅ Account sponsored successfully!\n📬 Address: \`${data.address}\``);
                                yield this.logAuditAction({
                                    action: 'SPONSOR_ACCOUNT',
                                    triggeredBy: userId,
                                    details: `Address: ${data.address}`,
                                    success: true,
                                    timestamp: new Date().toISOString(),
                                });
                            }
                            else {
                                yield message.reply(`❌ Sponsorship failed: ${data.message}`);
                                yield this.logAuditAction({
                                    action: 'SPONSOR_ACCOUNT',
                                    triggeredBy: userId,
                                    details: `Failed: ${data.message}`,
                                    success: false,
                                    timestamp: new Date().toISOString(),
                                });
                            }
                        }
                        catch (error) {
                            console.error("Sponsor command error:", error);
                            yield message.reply("❌ Could not reach the sponsorship service. Please try again later.");
                        }
                    }))();
                }
                if (message.content.startsWith("!trustline")) {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)(commandName, 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        const args = message.content.split(" ").slice(1);
                        if (args.length < 1) {
                            return message.reply("Usage: !trustline <assetCode> [issuerDomain|issuerAddress]\nExample: !trustline USDC circle.com");
                        }
                        const assetCode = args[0];
                        const assetIssuer = args[1];
                        if (!assetIssuer) {
                            return message.reply(`Please provide an issuer domain or address for ${assetCode}.`);
                        }
                        try {
                            yield message.reply(`🔍 Looking up asset ${assetCode} from ${assetIssuer}...`);
                            const op = yield (0, sdk_core_1.createTrustlineOperation)(assetCode, assetIssuer);
                            let response = `✅ Found asset ${assetCode}!\n\n`;
                            response += `To add this trustline, you can use the following details in your wallet:\n`;
                            response += `**Asset:** ${assetCode}\n`;
                            response += `**Issuer:** \`${op.asset.issuer}\`\n\n`;
                            response += `*Note: In a future update, I will provide a direct signing link.*`;
                            yield message.reply(response);
                            yield this.logAuditAction({
                                action: 'TRUSTLINE_LOOKUP',
                                triggeredBy: message.author.id,
                                details: `Asset: ${assetCode}, Issuer: ${assetIssuer}`,
                                success: true,
                                timestamp: new Date().toISOString(),
                            });
                        }
                        catch (error) {
                            yield message.reply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }))();
                }
                // #109: Swap command
                if (message.content.startsWith('!swap')) {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)('!swap', 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        if (!isDM(message)) {
                            yield rejectPublicChannel(message);
                            return;
                        }
                        const args = message.content.split(' ').slice(1);
                        if (args.length < 3) {
                            return message.reply('Usage: !swap <fromAsset> <toAsset> <amount>\nExample: !swap XLM USDC 100');
                        }
                        const [fromAsset, toAsset, amountStr] = args;
                        const amount = parseFloat(amountStr);
                        if (isNaN(amount) || amount <= 0) {
                            return message.reply('❌ Amount must be a positive number.');
                        }
                        try {
                            yield message.reply('🔄 Initiating swap...');
                            const response = yield this.agentClient.query({
                                userId,
                                query: `swap ${amount} ${fromAsset} to ${toAsset}`
                            });
                            const result = response.result;
                            if (typeof result === 'string') {
                                yield message.reply(result);
                            }
                            else if (result.successful) {
                                let reply = '✅ **Swap Successful!**\n\n';
                                reply += `**From:** ${result.from} ${result.amount}\n`;
                                reply += `**To:** ${result.to}\n`;
                                reply += `**Estimated Output:** ${result.estimatedOutput}\n`;
                                reply += `**Tx Hash:** \`${result.txHash}\``;
                                yield message.reply(reply);
                            }
                            else {
                                yield message.reply(`❌ Swap failed: ${result.message || 'Unknown error'}`);
                            }
                        }
                        catch (error) {
                            console.error('Swap command error:', error);
                            yield message.reply('❌ Could not complete the swap. Please try again later.');
                        }
                    }))();
                }
                // #146: Dashboard command
                if (message.content === '!dashboard') {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)('!dashboard', 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        yield message.reply(`📊 **Chen Pilot Dashboard**\n\nAccess your admin dashboard here:\n🔗 ${DASHBOARD_URL}\n\n*Note: You must be logged in to view the dashboard.*`);
                    }))();
                }
                // #148: /validate command for Stellar asset verification
                if (message.content.startsWith('!validate')) {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)(commandName, 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        const args = message.content.split(' ').slice(1);
                        if (args.length < 2) {
                            return message.reply('Usage: !validate <assetCode> <issuerAddress>\nExample: !validate USDC GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5');
                        }
                        const [assetCode, issuerAddress] = args;
                        yield message.reply(`🔍 Verifying asset **${assetCode}** from issuer \`${issuerAddress.slice(0, 8)}...\``);
                        try {
                            const result = yield this.verificationService.verifyAsset(assetCode, issuerAddress);
                            const statusEmoji = result.status === 'VERIFIED' ? '✅' : result.status === 'MALICIOUS' ? '🚨' : '⚠️';
                            let reply = `${statusEmoji} **Asset Verification: ${result.status}**\n\n`;
                            reply += `**Asset:** ${assetCode}\n`;
                            reply += `**Issuer:** \`${issuerAddress}\`\n`;
                            if (result.domain)
                                reply += `**Domain:** ${result.domain}\n`;
                            if (result.details)
                                reply += `**Details:** ${result.details}\n`;
                            reply += `\n**Safe to use:** ${result.isSafe ? 'Yes ✅' : 'No ❌'}`;
                            yield message.reply(reply);
                        }
                        catch (error) {
                            yield message.reply(`❌ Verification error: ${error instanceof Error ? error.message : String(error)}`);
                        }
                    }))();
                }
                // #125: Multisig wizard command
                if (message.content === '!multisig') {
                    if (!isDM(message)) {
                        yield rejectPublicChannel(message);
                        return;
                    }
                    const response = this.multisigWizard.startWizard(userId, 'discord');
                    yield message.reply(response.message);
                }
                // Handle wizard input (for active wizard sessions)
                const wizardState = this.multisigWizard.getWizardState(userId, 'discord');
                if (wizardState && !WIZARD_COMMANDS.includes(message.content.split(' ')[0])) {
                    const response = this.multisigWizard.processInput(userId, 'discord', message.content);
                    yield message.reply(response.message);
                }
                // #118: !currency command — set preferred report currency
                if (message.content.startsWith('!currency')) {
                    const arg = (_b = message.content.split(' ')[1]) === null || _b === void 0 ? void 0 : _b.toUpperCase();
                    if (!arg || !SUPPORTED_CURRENCIES.includes(arg)) {
                        return message.reply(`Usage: !currency <USD|XLM|BTC>\nCurrent: **${(_c = this.userCurrency.get(userId)) !== null && _c !== void 0 ? _c : 'USD'}**`);
                    }
                    this.userCurrency.set(userId, arg);
                    return message.reply(`✅ Report currency set to **${arg}**`);
                }
                // #118: !report command — portfolio report in preferred currency
                if (message.content.startsWith('!report')) {
                    const currency = (_d = this.userCurrency.get(userId)) !== null && _d !== void 0 ? _d : 'USD';
                    yield message.reply(`⏳ Fetching portfolio report in **${currency}**...`);
                    try {
                        const res = yield fetch(`${BACKEND_URL}/api/portfolio/${userId}?currency=${currency}`);
                        if (!res.ok)
                            throw new Error(`HTTP ${res.status}`);
                        const data = yield res.json();
                        let reply = `📊 **Portfolio Report (${currency})**\n\n`;
                        reply += `**Total Value:** ${data.totalValue.toFixed(4)} ${currency}\n\n`;
                        for (const a of data.assets) {
                            reply += `• **${a.code}**: ${a.balance} ≈ ${a.value.toFixed(4)} ${currency}\n`;
                        }
                        return message.reply(reply);
                    }
                    catch (_g) {
                        return message.reply(`❌ Could not fetch portfolio. Make sure your account is registered.`);
                    }
                }
                // #119: !alert command — set a price alert
                if (message.content.startsWith('!alert')) {
                    const args = message.content.split(' ').slice(1);
                    if (args.length < 3) {
                        return message.reply('Usage: !alert <assetCode> <above|below> <price> [USD|XLM|BTC]\nExample: !alert XLM above 0.15 USD');
                    }
                    const [assetCode, conditionRaw, priceRaw, currencyRaw] = args;
                    const condition = conditionRaw.toLowerCase();
                    if (condition !== 'above' && condition !== 'below') {
                        return message.reply('❌ Condition must be `above` or `below`.');
                    }
                    const targetPrice = parseFloat(priceRaw);
                    if (isNaN(targetPrice) || targetPrice <= 0) {
                        return message.reply('❌ Price must be a positive number.');
                    }
                    const currency = ((_f = (_e = currencyRaw === null || currencyRaw === void 0 ? void 0 : currencyRaw.toUpperCase()) !== null && _e !== void 0 ? _e : this.userCurrency.get(userId)) !== null && _f !== void 0 ? _f : 'USD');
                    if (!SUPPORTED_CURRENCIES.includes(currency)) {
                        return message.reply(`❌ Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`);
                    }
                    const alertId = `${userId}-${assetCode}-${Date.now()}`;
                    const alert = { id: alertId, userId, assetCode: assetCode.toUpperCase(), targetPrice, currency, condition, createdAt: new Date().toISOString(), triggered: false };
                    this.priceAlerts.set(alertId, alert);
                    // Register channel for DM delivery
                    if (!this.userChannels.has(userId))
                        this.userChannels.set(userId, message.channelId);
                    return message.reply(`🔔 Alert set: notify me when **${assetCode.toUpperCase()}** is ${condition} **${targetPrice} ${currency}**`);
                }
                // #119: !alerts — list active alerts
                if (message.content === '!alerts') {
                    const userAlerts = [...this.priceAlerts.values()].filter(a => a.userId === userId && !a.triggered);
                    if (userAlerts.length === 0)
                        return message.reply('📭 You have no active price alerts. Use `!alert` to set one.');
                    let reply = `🔔 **Your Active Alerts**\n\n`;
                    for (const a of userAlerts) {
                        reply += `• **${a.assetCode}** ${a.condition} ${a.targetPrice} ${a.currency} (ID: \`${a.id.slice(-6)}\`)\n`;
                    }
                    return message.reply(reply);
                }
                // #120: !advanced — role-gated command example
                if (message.content.startsWith('!advanced')) {
                    if (!this.hasAdvancedRole(message)) {
                        return message.reply(`🔒 This command requires one of the following roles: **${ADVANCED_ROLE_NAMES.join(', ')}**`);
                    }
                    return message.reply('✅ Advanced command executed. (Role check passed)');
                }
                // #121: !discover — suggest trending Stellar assets
                if (message.content === '!discover') {
                    if (!this.hasAdvancedRole(message)) {
                        return message.reply(`🔒 \`!discover\` requires one of the following roles: **${ADVANCED_ROLE_NAMES.join(', ')}**`);
                    }
                    yield message.reply('🔍 Discovering trending Stellar assets...');
                    try {
                        const res = yield fetch(`${BACKEND_URL}/api/assets/trending`);
                        if (!res.ok)
                            throw new Error(`HTTP ${res.status}`);
                        const assets = yield res.json();
                        if (!assets.length)
                            return message.reply('📭 No trending assets found at this time.');
                        let reply = `🌟 **Trending Stellar Assets**\n\n`;
                        for (const a of assets.slice(0, 5)) {
                            const change = a.priceChange24h >= 0 ? `+${a.priceChange24h.toFixed(2)}%` : `${a.priceChange24h.toFixed(2)}%`;
                            const emoji = a.priceChange24h >= 0 ? '📈' : '📉';
                            reply += `${emoji} **${a.assetCode}**${a.domain ? ` (${a.domain})` : ''}\n`;
                            reply += `  24h Change: ${change} | Volume: ${a.volume24h.toLocaleString()} | Holders: ${a.holders.toLocaleString()}\n\n`;
                        }
                        return message.reply(reply);
                    }
                    catch (_h) {
                        return message.reply('❌ Could not fetch trending assets. Please try again later.');
                    }
                }
                // Price chart command - generate static price chart for an asset
                if (message.content.startsWith('!price')) {
                    yield (0, performanceProfiler_1.withPerformanceProfiling)(commandName, 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                        var _a, _b, _c, _d;
                        const args = message.content.split(' ').slice(1);
                        if (args.length < 1) {
                            return message.reply('Usage: !price <assetCode> [currency] [days]\nExample: !price XLM USD 7\n\nSupported currencies: USD, XLM, BTC\nDefault: USD, 7 days');
                        }
                        const assetCode = args[0].toUpperCase();
                        const currency = ((_c = (_b = (_a = args[1]) === null || _a === void 0 ? void 0 : _a.toUpperCase()) !== null && _b !== void 0 ? _b : this.userCurrency.get(userId)) !== null && _c !== void 0 ? _c : 'USD');
                        const days = parseInt((_d = args[2]) !== null && _d !== void 0 ? _d : '7', 10);
                        if (!SUPPORTED_CURRENCIES.includes(currency)) {
                            return message.reply(`❌ Currency must be one of: ${SUPPORTED_CURRENCIES.join(', ')}`);
                        }
                        if (isNaN(days) || days < 1 || days > 90) {
                            return message.reply('❌ Days must be between 1 and 90');
                        }
                        yield message.reply(`📊 Generating price chart for **${assetCode}** (${days} days)...`);
                        try {
                            // Fetch current price and price change
                            const currentPrice = yield this.priceChartService.getCurrentPrice(assetCode, currency);
                            const priceChange = yield this.priceChartService.getPriceChange(assetCode, currency, 24);
                            // Generate the chart
                            const chartBuffer = yield this.priceChartService.generatePriceChart(assetCode, currency, days);
                            // Create message with chart and price info
                            const changeEmoji = priceChange >= 0 ? '📈' : '📉';
                            const changeText = priceChange >= 0 ? `+${priceChange.toFixed(2)}%` : `${priceChange.toFixed(2)}%`;
                            let reply = `${changeEmoji} **${assetCode} Price Chart**\n\n`;
                            reply += `**Current Price:** ${currentPrice.toFixed(6)} ${currency}\n`;
                            reply += `**24h Change:** ${changeText}\n`;
                            reply += `**Period:** Last ${days} days\n\n`;
                            // Send the chart as an attachment
                            yield message.reply({
                                content: reply,
                                files: [{
                                        attachment: chartBuffer,
                                        name: `${assetCode}_price_chart.png`
                                    }]
                            });
                        }
                        catch (error) {
                            console.error('Price chart generation error:', error);
                            yield message.reply(`❌ Could not generate price chart for **${assetCode}**. The asset may not be supported or the API is unavailable.`);
                        }
                    }))();
                }
            })));
            yield this.client.login(token);
            yield this.deploySlashCommands();
            this.startAlertPolling();
            // #128: Start market overview scheduler
            this.startMarketOverviewScheduler();
            console.log("✅ Discord bot initialized.");
        });
    }
    // Route slash command interactions to the appropriate handler
    handleSlashCommand(interaction) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const userId = interaction.user.id;
            const cmd = interaction.commandName;
            // Anti-flood check
            if (this.isFlooding(userId)) {
                yield interaction.reply({ content: "⏳ Please wait a moment before sending another command.", ephemeral: true });
                return;
            }
            // Rate limit check
            const rateLimitResult = this.checkRateLimit(userId, `/${cmd}`);
            if (!rateLimitResult.allowed) {
                yield interaction.reply({ content: (_a = rateLimitResult.message) !== null && _a !== void 0 ? _a : "⏳ Rate limit exceeded.", ephemeral: true });
                return;
            }
            yield (0, performanceProfiler_1.withPerformanceProfiling)(`/${cmd}`, 'discord', userId, () => __awaiter(this, void 0, void 0, function* () {
                var _a, _b, _c, _d, _e, _f;
                switch (cmd) {
                    case "start":
                        yield interaction.reply("Welcome to Chen Pilot! I am your AI-powered Stellar DeFi assistant. Type `/help` to see what I can do!");
                        break;
                    case "ping": {
                        yield interaction.deferReply();
                        const startTime = Date.now();
                        try {
                            const controller = new AbortController();
                            const timeout = setTimeout(() => controller.abort(), 5000);
                            const response = yield fetch(`${BACKEND_URL}/api/health`, { method: "GET", signal: controller.signal });
                            clearTimeout(timeout);
                            const ms = Date.now() - startTime;
                            yield interaction.editReply(response.ok
                                ? `🏓 **Pong!**\n\n📡 **End-to-End Latency:** ${ms}ms\n✅ Backend: Online`
                                : `🏓 **Pong!**\n\n📡 **End-to-End Latency:** ${ms}ms\n⚠️ Backend: HTTP ${response.status}`);
                        }
                        catch (_g) {
                            yield interaction.editReply(`🏓 **Pong!**\n\n📡 **End-to-End Latency:** ${Date.now() - startTime}ms\n❌ Backend: Unreachable`);
                        }
                        break;
                    }
                    case "help": {
                        const query = (_a = interaction.options.getString("query")) !== null && _a !== void 0 ? _a : "";
                        const results = (0, helpProvider_1.searchFeatures)(query);
                        yield interaction.reply((0, helpProvider_1.formatHelpMessage)(results, query.length > 0, "markdown"));
                        break;
                    }
                    case "thread": {
                        if (((_b = interaction.channel) === null || _b === void 0 ? void 0 : _b.type) === discord_js_1.ChannelType.GuildText) {
                            try {
                                const thread = yield interaction.channel.threads.create({
                                    name: `Chen Pilot Session - ${interaction.user.username}`,
                                    autoArchiveDuration: 60,
                                });
                                yield thread.send(`👋 Hello ${interaction.user.username}! I've started this thread. How can I help you with Stellar DeFi today?`);
                                yield interaction.reply({ content: `🧵 Thread created: ${thread}`, ephemeral: true });
                            }
                            catch (_h) {
                                yield interaction.reply({ content: "❌ Couldn't start a thread. Check my permissions.", ephemeral: true });
                            }
                        }
                        else if ((_c = interaction.channel) === null || _c === void 0 ? void 0 : _c.isThread()) {
                            yield interaction.reply({ content: "🧵 We are already in a thread!", ephemeral: true });
                        }
                        else {
                            yield interaction.reply({ content: "❌ Threads can only be started in text channels.", ephemeral: true });
                        }
                        break;
                    }
                    case "sponsor": {
                        if (!interaction.channel || interaction.channel.type !== discord_js_1.ChannelType.DM) {
                            yield interaction.reply({ content: "🔒 This command can only be used in a Direct Message (DM) with the bot.", ephemeral: true });
                            return;
                        }
                        yield interaction.deferReply({ ephemeral: true });
                        try {
                            const response = yield fetch(`${BACKEND_URL}/api/account/${userId}/sponsor`, { method: "POST", headers: { "Content-Type": "application/json" } });
                            const data = yield response.json();
                            if (data.success) {
                                yield interaction.editReply(`✅ Account sponsored!\n📬 Address: \`${data.address}\``);
                                yield this.logAuditAction({ action: "SPONSOR_ACCOUNT", triggeredBy: userId, details: `Address: ${data.address}`, success: true, timestamp: new Date().toISOString() });
                            }
                            else {
                                yield interaction.editReply(`❌ Sponsorship failed: ${data.message}`);
                                yield this.logAuditAction({ action: "SPONSOR_ACCOUNT", triggeredBy: userId, details: `Failed: ${data.message}`, success: false, timestamp: new Date().toISOString() });
                            }
                        }
                        catch (_j) {
                            yield interaction.editReply("❌ Could not reach the sponsorship service. Please try again later.");
                        }
                        break;
                    }
                    case "trustline": {
                        const assetCode = interaction.options.getString("asset", true);
                        const assetIssuer = interaction.options.getString("issuer", true);
                        yield interaction.deferReply();
                        try {
                            const op = yield (0, sdk_core_1.createTrustlineOperation)(assetCode, assetIssuer);
                            const issuer = op.asset.issuer;
                            const reply = `✅ Found asset **${assetCode}**!\n\n**Asset:** ${assetCode}\n**Issuer:** \`${issuer}\`\n\n*Note: In a future update, I will provide a direct signing link.*`;
                            yield interaction.editReply(reply);
                            yield this.logAuditAction({ action: "TRUSTLINE_LOOKUP", triggeredBy: userId, details: `Asset: ${assetCode}, Issuer: ${assetIssuer}`, success: true, timestamp: new Date().toISOString() });
                        }
                        catch (error) {
                            yield interaction.editReply(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
                        }
                        break;
                    }
                    case "dashboard":
                        yield interaction.reply({ content: `📊 **Chen Pilot Dashboard**\n\n🔗 ${DASHBOARD_URL}\n\n*You must be logged in to view the dashboard.*`, ephemeral: true });
                        break;
                    case "validate": {
                        const assetCode = interaction.options.getString("asset", true);
                        const issuerAddress = interaction.options.getString("issuer", true);
                        yield interaction.deferReply();
                        try {
                            const result = yield this.verificationService.verifyAsset(assetCode, issuerAddress);
                            const statusEmoji = result.status === "VERIFIED" ? "✅" : result.status === "MALICIOUS" ? "🚨" : "⚠️";
                            let reply = `${statusEmoji} **Asset Verification: ${result.status}**\n\n**Asset:** ${assetCode}\n**Issuer:** \`${issuerAddress}\`\n`;
                            if (result.domain)
                                reply += `**Domain:** ${result.domain}\n`;
                            if (result.details)
                                reply += `**Details:** ${result.details}\n`;
                            reply += `\n**Safe to use:** ${result.isSafe ? "Yes ✅" : "No ❌"}`;
                            yield interaction.editReply(reply);
                        }
                        catch (error) {
                            yield interaction.editReply(`❌ Verification error: ${error instanceof Error ? error.message : String(error)}`);
                        }
                        break;
                    }
                    case "multisig": {
                        if (!interaction.channel || interaction.channel.type !== discord_js_1.ChannelType.DM) {
                            yield interaction.reply({ content: "🔒 This command can only be used in a Direct Message (DM) with the bot.", ephemeral: true });
                            return;
                        }
                        const response = this.multisigWizard.startWizard(userId, "discord");
                        yield interaction.reply({ content: response.message, ephemeral: true });
                        break;
                    }
                    case "currency": {
                        const currency = interaction.options.getString("currency", true);
                        this.userCurrency.set(userId, currency);
                        yield interaction.reply({ content: `✅ Report currency set to **${currency}**`, ephemeral: true });
                        break;
                    }
                    case "report": {
                        const currency = (_d = this.userCurrency.get(userId)) !== null && _d !== void 0 ? _d : "USD";
                        yield interaction.deferReply({ ephemeral: true });
                        try {
                            const res = yield fetch(`${BACKEND_URL}/api/portfolio/${userId}?currency=${currency}`);
                            if (!res.ok)
                                throw new Error(`HTTP ${res.status}`);
                            const data = yield res.json();
                            let reply = `📊 **Portfolio Report (${currency})**\n\n**Total Value:** ${data.totalValue.toFixed(4)} ${currency}\n\n`;
                            for (const a of data.assets) {
                                reply += `• **${a.code}**: ${a.balance} ≈ ${a.value.toFixed(4)} ${currency}\n`;
                            }
                            yield interaction.editReply(reply);
                        }
                        catch (_k) {
                            yield interaction.editReply("❌ Could not fetch portfolio. Make sure your account is registered.");
                        }
                        break;
                    }
                    case "alert": {
                        const assetCode = interaction.options.getString("asset", true).toUpperCase();
                        const condition = interaction.options.getString("condition", true);
                        const targetPrice = interaction.options.getNumber("price", true);
                        const currency = ((_f = (_e = interaction.options.getString("currency")) !== null && _e !== void 0 ? _e : this.userCurrency.get(userId)) !== null && _f !== void 0 ? _f : "USD");
                        const alertId = `${userId}-${assetCode}-${Date.now()}`;
                        const alert = { id: alertId, userId, assetCode, targetPrice, currency, condition, createdAt: new Date().toISOString(), triggered: false };
                        this.priceAlerts.set(alertId, alert);
                        if (!this.userChannels.has(userId))
                            this.userChannels.set(userId, interaction.channelId);
                        yield interaction.reply({ content: `🔔 Alert set: notify me when **${assetCode}** is ${condition} **${targetPrice} ${currency}**`, ephemeral: true });
                        break;
                    }
                    case "alerts": {
                        const userAlerts = [...this.priceAlerts.values()].filter(a => a.userId === userId && !a.triggered);
                        if (!userAlerts.length) {
                            yield interaction.reply({ content: "📭 You have no active price alerts. Use `/alert` to set one.", ephemeral: true });
                            return;
                        }
                        let reply = "🔔 **Your Active Alerts**\n\n";
                        for (const a of userAlerts) {
                            reply += `• **${a.assetCode}** ${a.condition} ${a.targetPrice} ${a.currency} (ID: \`${a.id.slice(-6)}\`)\n`;
                        }
                        yield interaction.reply({ content: reply, ephemeral: true });
                        break;
                    }
                    case "advanced": {
                        if (!interaction.member || !interaction.guild) {
                            yield interaction.reply({ content: "❌ This command must be used in a server.", ephemeral: true });
                            return;
                        }
                        const member = yield interaction.guild.members.fetch(userId);
                        const hasRole = member.roles.cache.some((r) => ADVANCED_ROLE_NAMES.includes(r.name));
                        if (!hasRole) {
                            yield interaction.reply({ content: `🔒 This command requires one of the following roles: **${ADVANCED_ROLE_NAMES.join(", ")}**`, ephemeral: true });
                            return;
                        }
                        yield interaction.reply({ content: "✅ Advanced command executed. (Role check passed)", ephemeral: true });
                        break;
                    }
                    case "discover": {
                        if (!interaction.member || !interaction.guild) {
                            yield interaction.reply({ content: "❌ This command must be used in a server.", ephemeral: true });
                            return;
                        }
                        const member = yield interaction.guild.members.fetch(userId);
                        const hasRole = member.roles.cache.some((r) => ADVANCED_ROLE_NAMES.includes(r.name));
                        if (!hasRole) {
                            yield interaction.reply({ content: `🔒 \`/discover\` requires one of the following roles: **${ADVANCED_ROLE_NAMES.join(", ")}**`, ephemeral: true });
                            return;
                        }
                        yield interaction.deferReply();
                        try {
                            const res = yield fetch(`${BACKEND_URL}/api/assets/trending`);
                            if (!res.ok)
                                throw new Error(`HTTP ${res.status}`);
                            const assets = yield res.json();
                            if (!assets.length) {
                                yield interaction.editReply("📭 No trending assets found at this time.");
                                return;
                            }
                            let reply = "🌟 **Trending Stellar Assets**\n\n";
                            for (const a of assets.slice(0, 5)) {
                                const change = a.priceChange24h >= 0 ? `+${a.priceChange24h.toFixed(2)}%` : `${a.priceChange24h.toFixed(2)}%`;
                                const emoji = a.priceChange24h >= 0 ? "📈" : "📉";
                                reply += `${emoji} **${a.assetCode}**${a.domain ? ` (${a.domain})` : ""}\n  24h Change: ${change} | Volume: ${a.volume24h.toLocaleString()} | Holders: ${a.holders.toLocaleString()}\n\n`;
                            }
                            yield interaction.editReply(reply);
                        }
                        catch (_l) {
                            yield interaction.editReply("❌ Could not fetch trending assets. Please try again later.");
                        }
                        break;
                    }
                    default:
                        yield interaction.reply({ content: "❓ Unknown command.", ephemeral: true });
                }
            }))();
        });
    }
    // #120: Check if message author has an advanced role
    hasAdvancedRole(message) {
        if (!message.member)
            return false;
        return message.member.roles.cache.some((r) => ADVANCED_ROLE_NAMES.includes(r.name));
    }
    // #119: Poll prices and fire triggered alerts via DM
    startAlertPolling() {
        this.alertCheckInterval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
            const pending = [...this.priceAlerts.values()].filter(a => !a.triggered);
            if (!pending.length)
                return;
            for (const alert of pending) {
                try {
                    const res = yield fetch(`${BACKEND_URL}/api/price/${alert.assetCode}?currency=${alert.currency}`);
                    if (!res.ok)
                        continue;
                    const { price } = yield res.json();
                    const triggered = alert.condition === 'above' ? price >= alert.targetPrice : price <= alert.targetPrice;
                    if (!triggered)
                        continue;
                    alert.triggered = true;
                    const channelId = this.userChannels.get(alert.userId);
                    if (!channelId)
                        continue;
                    const channel = this.client.channels.cache.get(channelId);
                    if (!channel)
                        continue;
                    yield channel.send(`🔔 **Price Alert Triggered!**\n**${alert.assetCode}** is now ${alert.condition} **${alert.targetPrice} ${alert.currency}** (current: ${price} ${alert.currency})`);
                }
                catch ( /* ignore per-alert errors */_a) { /* ignore per-alert errors */ }
            }
        }), 60000); // check every minute
    }
    logAuditAction(entry) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!this.auditLogChannelId || !this.client)
                return;
            try {
                const ch = this.client.channels.cache.get(this.auditLogChannelId);
                if (ch && typeof ch.send === 'function') {
                    yield ch.send(`📝 Audit: ${entry.action} by ${entry.triggeredBy} — ${(_a = entry.details) !== null && _a !== void 0 ? _a : ''}`);
                }
            }
            catch (e) {
                console.error('Audit log failed', e);
            }
        });
    }
    // #147: Announce a new GitHub release to all registered announcement channels
    announceRelease(channelId, release) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            if (!((_a = this.client) === null || _a === void 0 ? void 0 : _a.user)) {
                console.warn("⚠️ Discord bot not initialized");
                return false;
            }
            const channel = this.client.channels.cache.get(channelId);
            if (!channel) {
                console.warn(`⚠️ Announcement channel ${channelId} not found`);
                return false;
            }
            const body = release.body ? `\n\n${release.body.slice(0, 500)}${release.body.length > 500 ? '...' : ''}` : '';
            const message = `🚀 **New Release: ${release.name || release.tag_name}**${body}\n\n🔗 ${release.html_url}`;
            try {
                yield channel.send(message);
                return true;
            }
            catch (error) {
                console.error("Error sending release announcement:", error);
                return false;
            }
        });
    }
    registerUser(userId, channelId) {
        return __awaiter(this, void 0, void 0, function* () {
            this.userChannels.set(userId, channelId);
            return true;
        });
    }
    sendTransactionNotification(userId, data) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.client || !this.client.user) {
                console.warn("⚠️ Discord bot not initialized");
                return false;
            }
            const channelId = this.userChannels.get(userId);
            if (!channelId) {
                console.warn(`⚠️ No channel ID found for user ${userId}`);
                return false;
            }
            const channel = this.client.channels.cache.get(channelId);
            if (!channel) {
                console.warn(`⚠️ Channel or Thread ${channelId} not found`);
                return false;
            }
            const message = this.formatTransactionMessage(data);
            try {
                yield channel.send(message);
                // Additionally log to a dedicated transaction thread if configured
                if (TRANSACTION_THREAD_LOGGING_ENABLED && TRANSACTION_LOG_CHANNEL_ID) {
                    try {
                        const thread = yield this.getOrCreateTransactionThread(userId, data.from);
                        if (thread) {
                            const detailed = this.formatDetailedTransactionLog(data);
                            yield thread.send(detailed);
                        }
                    }
                    catch (e) {
                        console.error('Error logging transaction to thread:', e);
                    }
                }
                yield this.logAuditAction({
                    action: 'SEND_TRANSACTION_NOTIFICATION',
                    triggeredBy: userId,
                    details: `Hash: ${data.hash.slice(0, 8)}...${data.hash.slice(-8)}, Success: ${data.successful}`,
                    success: true,
                    timestamp: new Date().toISOString(),
                });
                return true;
            }
            catch (error) {
                console.error("Error sending Discord notification:", error);
                return false;
            }
        });
    }
    getOrCreateTransactionThread(userId, username) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!TRANSACTION_THREAD_LOGGING_ENABLED || !TRANSACTION_LOG_CHANNEL_ID)
                return null;
            try {
                const ch = this.client.channels.cache.get(TRANSACTION_LOG_CHANNEL_ID);
                if (!ch)
                    return null;
                const existingThreadId = this.transactionThreads.get(userId);
                if (existingThreadId) {
                    const existing = this.client.channels.cache.get(existingThreadId);
                    if (existing)
                        return existing;
                    this.transactionThreads.delete(userId);
                }
                // Fetch active threads in the channel and look for one matching the user
                const fetched = yield ch.threads.fetch();
                const threadName = `tx-log-${userId}`;
                const found = fetched.threads.find(t => t.name === threadName);
                if (found) {
                    this.transactionThreads.set(userId, found.id);
                    return found;
                }
                // Create a starter message then start a thread from it
                const starter = yield ch.send(`🔐 Starting transaction log thread for <@${userId}> (${username !== null && username !== void 0 ? username : userId})`);
                const thread = yield starter.startThread({ name: threadName, autoArchiveDuration: TRANSACTION_THREAD_ARCHIVE_MINUTES });
                this.transactionThreads.set(userId, thread.id);
                return thread;
            }
            catch (e) {
                console.error('getOrCreateTransactionThread error', e);
                return null;
            }
        });
    }
    formatDetailedTransactionLog(data) {
        const timestamp = new Date(data.timestamp).toISOString();
        let msg = `**Detailed Transaction Log` + `**\n`;
        msg += `• Hash: \`${data.hash}\`\n`;
        msg += `• Successful: ${data.successful}\n`;
        msg += `• From: \`${data.from}\`\n`;
        msg += `• To: \`${data.to}\`\n`;
        msg += `• Amount: ${data.amount} ${data.asset}\n`;
        if (data.fee)
            msg += `• Fee: ${data.fee} XLM\n`;
        if (data.memo)
            msg += `• Memo: ${data.memo}\n`;
        msg += `• Timestamp: ${timestamp}\n`;
        if (data.raw) {
            msg += `\nRaw Payload:\n` + '```json\n' + JSON.stringify(data.raw, null, 2) + '\n```';
        }
        return msg;
    }
    formatTransactionMessage(data) {
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
    sendNotification(userId, message) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.client || !this.client.user) {
                console.warn("⚠️ Discord bot not initialized");
                return false;
            }
            const channelId = this.userChannels.get(userId);
            if (!channelId) {
                return false;
            }
            const channel = this.client.channels.cache.get(channelId);
            if (!channel) {
                return false;
            }
            try {
                yield channel.send(message);
                return true;
            }
            catch (error) {
                console.error("Error sending Discord notification:", error);
                return false;
            }
        });
    }
    getClient() {
        return this.client;
    }
    /**
     * Start periodic status updates
     */
    startStatusUpdates() {
        // Initial update
        this.updateBotStatus();
        // Update every 5 minutes
        setInterval(() => {
            this.updateBotStatus();
        }, 5 * 60 * 1000);
    }
    /**
     * Update the bot's Discord activity status
     */
    updateBotStatus() {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.client.user)
                return;
            try {
                // Toggle between network status and a welcoming message
                const useNetworkStatus = Math.random() > 0.5;
                if (useNetworkStatus) {
                    const status = yield (0, sdk_core_1.getNetworkStatus)({ network: "mainnet" });
                    const healthEmoji = status.health.isHealthy ? "🟢" : "🔴";
                    const ledgerInfo = `L:${status.health.latestLedger}`;
                    this.client.user.setActivity(`${healthEmoji} Stellar Network | ${ledgerInfo}`, {
                        type: discord_js_1.ActivityType.Watching,
                    });
                }
                else {
                    this.client.user.setActivity("🚀 Stellar DeFi | !help", {
                        type: discord_js_1.ActivityType.Playing,
                    });
                }
            }
            catch (error) {
                console.error("Error updating bot status:", error);
                // Fallback status
                this.client.user.setActivity("Stellar DeFi Assistant", {
                    type: discord_js_1.ActivityType.Custom,
                });
            }
        });
    }
}
exports.DiscordAdapter = DiscordAdapter;
