/**
 * Modular Discord Adapter
 * Main Discord adapter using modular components
 */

import {
  Client,
  GatewayIntentBits,
  Message,
  TextChannel,
  ChannelType,
  Interaction,
  ButtonInteraction,
  ChatInputCommandInteraction,
} from 'discord.js';
import { ButtonHandler } from './modules/interaction/ButtonHandler';
import { ThreadSafety } from './modules/thread/ThreadSafety';
import { RoleGate } from './modules/role/RoleGate';
import { SafeBackendClient } from '../commands/services/BackendClient';
import {
  ModerationPolicyEngine,
  InMemoryAuditSink,
  JsonLinesAuditSink,
  createDefaultModerationPolicy,
  isModerationEnabled,
  discordMessageToModerationEvent,
  type ModerationAuditSink,
  type ModerationResult,
} from '../moderation/index';
import { mapDiscordCommandOptions } from './commandOptionsMapper';
import {
  CommandOptionValidationError,
  DiscordCommandDto,
} from './dto/commandOptions.dto';

/**
 * Channels that can receive a plain-text follow-up (warning notice or
 * mod-log escalation). Threads and regular text channels both expose
 * `.send()`; other channel types (voice, forum, category, …) do not.
 */
type SendableChannel = TextChannel;

function isSendableChannel(channel: unknown): channel is SendableChannel {
  const type = (channel as { type?: ChannelType } | null)?.type;
  return (
    type === ChannelType.GuildText ||
    type === ChannelType.GuildPublicThread ||
    type === ChannelType.GuildPrivateThread ||
    type === ChannelType.GuildAnnouncement
  );
}

export interface DiscordAdapterConfig {
  token: string;
  backendUrl: string;
  adminRoleIds: string[];
  intents?: GatewayIntentBits[];
  /**
   * Channel that receives moderation audit notices for "escalate" decisions.
   * Falls back to MODERATION_LOG_CHANNEL_ID, then DISCORD_AUDIT_LOG_CHANNEL_ID
   * (shared with the legacy adapter's audit log) when omitted.
   */
  moderationLogChannelId?: string;
  /** Optional append-only JSONL file for durable moderation audit records. */
  moderationAuditFilePath?: string;
  /** Optional custom audit sink; takes precedence over moderationAuditFilePath. */
  moderationAuditSink?: ModerationAuditSink;
}

export class DiscordAdapter {
  private client: Client;
  private buttonHandler: ButtonHandler;
  private threadSafety: ThreadSafety;
  private roleGate: RoleGate;
  private backendClient: SafeBackendClient;
  private moderationEngine: ModerationPolicyEngine;
  private moderationAuditSink: ModerationAuditSink;
  private moderationEnabled: boolean;
  private moderationLogChannelId?: string;
  private config: DiscordAdapterConfig;

  constructor(config: DiscordAdapterConfig) {
    this.config = config;

    // Initialize Discord client
    this.client = new Client({
      intents: config.intents || [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });

    // Initialize modular components
    this.buttonHandler = new ButtonHandler();
    this.threadSafety = new ThreadSafety();
    this.roleGate = new RoleGate({
      fetchRoles: async (userId, guildId) => {
        const guild = await this.client.guilds.fetch(guildId);
        const member = await guild.members.fetch({ user: userId, force: true });
        return member.roles.cache.map((role) => role.id);
      },
    });
    this.backendClient = new SafeBackendClient(config.backendUrl);

    // Configure role gate
    this.roleGate.setAdminRoleIds(config.adminRoleIds);

    // Initialize the shared moderation policy engine. Audit sink failures
    // never propagate — see ModerationPolicyEngine.audit().
    this.moderationEnabled = isModerationEnabled();
    this.moderationLogChannelId =
      config.moderationLogChannelId ||
      process.env.MODERATION_LOG_CHANNEL_ID ||
      process.env.DISCORD_AUDIT_LOG_CHANNEL_ID;
    this.moderationAuditSink =
      config.moderationAuditSink ??
      (config.moderationAuditFilePath
        ? new JsonLinesAuditSink(config.moderationAuditFilePath)
        : new InMemoryAuditSink());
    const { rules, escalation } = createDefaultModerationPolicy();
    this.moderationEngine = new ModerationPolicyEngine({
      rules,
      escalation,
      auditSinks: [this.moderationAuditSink],
    });

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Start the Discord adapter
   */
  async start(): Promise<void> {
    await this.client.login(this.config.token);
  }

  /**
   * Stop the Discord adapter
   */
  async stop(): Promise<void> {
    await this.client.destroy();
    this.threadSafety.clearAllHistory();
    this.roleGate.clearCache();
  }

  /**
   * Setup Discord event handlers
   */
  private setupEventHandlers(): void {
    this.client.on('ready', () => {
      // TODO: Log ready state
    });

    this.client.on('interactionCreate', async (interaction) => {
      await this.handleInteraction(interaction);
    });

    this.client.on('messageCreate', async (message) => {
      await this.handleMessage(message);
    });

    this.client.on('guildMemberUpdate', (_oldMember, member) => {
      this.roleGate.invalidateCache(member.id, member.guild.id);
    });
    this.client.on('guildMemberAdd', (member) => {
      this.roleGate.invalidateCache(member.id, member.guild.id);
    });
    this.client.on('guildMemberRemove', (member) => {
      this.roleGate.invalidateCache(member.id, member.guild.id);
    });
    this.client.on('roleCreate', (role) => {
      this.roleGate.invalidateGuildCache(role.guild.id);
    });
    this.client.on('roleUpdate', (_oldRole, role) => {
      this.roleGate.invalidateGuildCache(role.guild.id);
    });
    this.client.on('roleDelete', (role) => {
      this.roleGate.invalidateGuildCache(role.guild.id);
    });
    this.client.on('guildUpdate', (_oldGuild, guild) => {
      this.roleGate.invalidateGuildCache(guild.id);
    });
  }

  /**
   * Handle Discord interactions
   */
  private async handleInteraction(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isButton()) {
        await this.handleButtonInteraction(interaction);
      } else if (interaction.isModalSubmit()) {
        await this.handleModalInteraction();
      } else if (interaction.isStringSelectMenu()) {
        await this.handleSelectInteraction();
      } else if (interaction.isChatInputCommand()) {
        await this.handleCommandInteraction(interaction);
      }
    } catch (error) {
      // Keep diagnostics structured and exclude raw interaction data or error messages.
      const interactionType = typeof interaction?.isButton === 'function' && interaction.isButton()
        ? 'button'
        : typeof interaction?.isModalSubmit === 'function' && interaction.isModalSubmit()
          ? 'modal'
          : typeof interaction?.isStringSelectMenu === 'function' && interaction.isStringSelectMenu()
            ? 'select'
            : typeof interaction?.isChatInputCommand === 'function' && interaction.isChatInputCommand()
              ? 'command'
              : 'unknown';
      console.error('[DiscordAdapter] Interaction failed', {
        errorClass: error instanceof Error ? error.name : 'UnknownError',
        interactionType,
        commandName: typeof interaction?.commandName === 'string' ? interaction.commandName : undefined,
        correlationId: typeof interaction?.id === 'string' ? interaction.id : 'unknown',
      });
    }
  }

  /**
   * Handle button interaction
   */
  private async handleButtonInteraction(interaction: ButtonInteraction): Promise<void> {
    const discordInteraction = {
      type: 'button' as const,
      id: interaction.id,
      userId: interaction.user.id,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      data: {
        customId: interaction.customId,
      },
      metadata: {
        timestamp: Date.now(),
        threadId: interaction.channel?.isThread() ? interaction.channelId : undefined,
        parentChannelId: interaction.channel?.parentId,
      },
    };

    const result = await this.buttonHandler.handleButton(discordInteraction);

    if (result.success) {
      await interaction.reply({
        content: result.response?.content || 'Success',
        ephemeral: result.response?.ephemeral,
      });
    } else {
      await interaction.reply({
        content: result.error?.userMessage || result.error?.message || 'An error occurred',
        ephemeral: true,
      });
    }
  }

  /**
   * Handle modal interaction
   */
  private async handleModalInteraction(): Promise<void> {
    // TODO: Implement modal handling
  }

  /**
   * Handle select interaction
   */
  private async handleSelectInteraction(): Promise<void> {
    // TODO: Implement select handling
  }

  /**
   * Handle command interaction
   */
  private async handleCommandInteraction(interaction: ChatInputCommandInteraction): Promise<void> {
    const commandName = interaction.commandName;

    // Check role gate
    const canExecute = await this.roleGate.checkGate(
      commandName,
      interaction.user.id,
      interaction.guildId ?? '',
    );

    if (!canExecute) {
      await interaction.reply({
        content: 'You do not have permission to use this command',
        ephemeral: true,
      });
      return;
    }

    // Validate and map raw options into versioned DTO
    let commandDto: DiscordCommandDto;
    try {
      commandDto = mapDiscordCommandOptions(commandName, interaction.options?.data);
    } catch (error) {
      if (error instanceof CommandOptionValidationError) {
        await interaction.reply({
          content: `Invalid command options: ${error.message}`,
          ephemeral: true,
        });
        return;
      }
      throw error;
    }

    // Defer eligible interactions before backend work to avoid Discord 3s initial response timeout
    let isDeferred = Boolean(interaction.deferred);
    if (!isDeferred && !interaction.replied && typeof interaction.deferReply === 'function') {
      try {
        await interaction.deferReply();
        isDeferred = true;
      } catch (error) {
        console.error('[DiscordAdapter] Failed to defer command interaction:', error);
      }
    }

    try {
      const result = await this.backendClient.executeCommand(
        commandName,
        commandDto,
        interaction.user.id
      );

      await this.sendInteractionResponse(
        interaction,
        JSON.stringify(result),
        false,
        isDeferred
      );
    } catch {
      await this.sendInteractionResponse(
        interaction,
        'Failed to execute command',
        true,
        isDeferred
      );
    }
  }

  /**
   * Send interaction response using follow-up (editReply / followUp) if deferred/replied,
   * or initial reply if not yet acknowledged. Ensures each interaction is acknowledged exactly once.
   */
  private async sendInteractionResponse(
    interaction: ChatInputCommandInteraction,
    content: string,
    ephemeral = false,
    deferredState = false
  ): Promise<void> {
    const isDeferred = deferredState || Boolean(interaction.deferred);

    if (isDeferred) {
      if (typeof interaction.editReply === 'function') {
        await interaction.editReply({ content });
      } else if (typeof interaction.followUp === 'function') {
        await interaction.followUp({ content, ephemeral });
      }
    } else if (interaction.replied) {
      if (typeof interaction.followUp === 'function') {
        await interaction.followUp({ content, ephemeral });
      } else if (typeof interaction.editReply === 'function') {
        await interaction.editReply({ content });
      }
    } else if (typeof interaction.reply === 'function') {
      await interaction.reply({
        content,
        ephemeral,
      });
    }
  }

  /**
   * Handle message
   */
  private async handleMessage(message: Message): Promise<void> {
    // Ignore bot messages
    if (message.author.bot) return;

    await this.runModeration(message);

    // TODO: Handle legacy commands
  }

  /**
   * Run the shared moderation policy engine against an incoming message and
   * enforce its decision. Never throws — a moderation failure must not take
   * down message handling for the rest of the bot.
   */
  private async runModeration(message: Message): Promise<void> {
    if (!this.moderationEnabled) return;

    try {
      const event = discordMessageToModerationEvent({
        id: message.id,
        content: message.content,
        channelId: message.channelId,
        guildId: message.guildId,
        createdTimestamp: message.createdTimestamp,
        author: { id: message.author.id, bot: message.author.bot },
      });

      const result = await this.moderationEngine.moderate(event);
      if (result.decision === 'allow') return;

      await this.enforceModerationDecision(message, result);
    } catch (error) {
      // Moderation must never break normal message handling.
      console.error('[DiscordAdapter] Moderation error:', error);
    }
  }

  /**
   * Apply the engine's decision to the originating Discord message:
   *  - warn:     reply in-channel with the notice, message stays.
   *  - delete:   delete the message, then post the notice in-channel.
   *  - escalate: delete the message and forward a report to the mod-log
   *              channel in addition to the in-channel notice.
   */
  private async enforceModerationDecision(
    message: Message,
    result: ModerationResult
  ): Promise<void> {
    const notice = result.userMessage ?? 'This message violates our moderation policy.';

    if (result.decision === 'delete' || result.decision === 'escalate') {
      try {
        await message.delete();
      } catch (error) {
        // Message may already be gone, or the bot may lack permissions —
        // still proceed to notify/escalate so moderators see the flag.
        console.error('[DiscordAdapter] Failed to delete moderated message:', error);
      }
    }

    if (isSendableChannel(message.channel)) {
      await message.channel.send(notice);
    }

    if (result.decision === 'escalate') {
      await this.postToModerationLog(message, result);
    }
  }

  /**
   * Forward an escalated moderation decision to the configured mod-log
   * channel. Silently no-ops when no channel is configured or the channel
   * can't be resolved — audit failures must not affect enforcement.
   */
  private async postToModerationLog(
    message: Message,
    result: ModerationResult
  ): Promise<void> {
    if (!this.moderationLogChannelId) return;

    try {
      const channel = await this.client.channels.fetch(this.moderationLogChannelId);
      if (!isSendableChannel(channel)) return;

      const report =
        `🚨 **Moderation Escalation**\n` +
        `**User:** <@${message.author.id}> (\`${message.author.id}\`)\n` +
        `**Channel:** <#${message.channelId}>\n` +
        `**Rule:** \`${result.ruleId ?? 'unknown'}\`\n` +
        `**Reason:** ${result.reason ?? 'Policy violation'}\n` +
        `**Strikes:** ${result.strikes}\n` +
        `**Content:** ${message.content.slice(0, 500)}`;

      await channel.send(report);
    } catch (error) {
      console.error('[DiscordAdapter] Failed to post moderation escalation log:', error);
    }
  }

  /**
   * Read-only access to the moderation audit trail — used by tests and
   * admin tooling that needs to inspect recent decisions.
   */
  getModerationAuditSink(): ModerationAuditSink {
    return this.moderationAuditSink;
  }

  /**
   * Get button handler for registration
   */
  getButtonHandler(): ButtonHandler {
    return this.buttonHandler;
  }

  /**
   * Get thread safety module
   */
  getThreadSafety(): ThreadSafety {
    return this.threadSafety;
  }

  /**
   * Get role gate module
   */
  getRoleGate(): RoleGate {
    return this.roleGate;
  }

  /**
   * Get backend client
   */
  getBackendClient(): SafeBackendClient {
    return this.backendClient;
  }

  /**
   * Get Discord client
   */
  getClient(): Client {
    return this.client;
  }
}
