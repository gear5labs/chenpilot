import { Request } from "express";
import crypto from "crypto";
import { durableOperationService } from "../Reliability/DurableOperationService";

/**
 * Telegram webhook payload structure
 */
export interface TelegramWebhookPayload {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      type: string;
    };
    date: number;
    text?: string;
    voice?: {
      file_id: string;
      file_unique_id: string;
      duration: number;
      mime_type?: string;
      file_size?: number;
    };
  };
  callback_query?: {
    id: string;
    from: {
      id: number;
      first_name: string;
      username?: string;
    };
    data: string;
  };
}

/**
 * Discord webhook payload structure
 */
export interface DiscordWebhookPayload {
  id: string;
  type: number;
  timestamp: string;
  channel_id?: string;
  guild_id?: string;
  author?: {
    id: string;
    username: string;
    discriminator: string;
  };
  content?: string;
  embeds?: unknown[];
}

export interface WebhookProcessResult {
  success: boolean;
  message: string;
  isDuplicate?: boolean;
  data?: unknown;
}

/**
 * Service for handling Telegram and Discord webhooks with durable idempotency
 */
export class PlatformWebhookService {
  private readonly TELEGRAM_SECRET: string;
  private readonly DISCORD_PUBLIC_KEY: string;

  constructor() {
    this.TELEGRAM_SECRET = process.env.TELEGRAM_BOT_TOKEN || "";
    this.DISCORD_PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || "";

    // Register handlers for durable webhook processing
    durableOperationService.registerHandler("telegram_webhook", async (payload) => {
      return this.handleTelegramUpdate(payload);
    });

    durableOperationService.registerHandler("discord_webhook", async (payload) => {
      return this.handleDiscordUpdate(payload);
    });
  }

  /**
   * Process Telegram webhook
   */
  async processTelegramWebhook(req: Request): Promise<WebhookProcessResult> {
    try {
      const payload: TelegramWebhookPayload = req.body;
      if (!payload.update_id) return { success: false, message: "Invalid payload" };

      const idempotentKey = `telegram_${payload.update_id}`;

      // Execute as a durable operation
      await durableOperationService.execute({
        category: "telegram_webhook",
        idempotentKey,
        payload,
      });

      return {
        success: true,
        message: "Telegram webhook accepted for durable processing",
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "Internal error" };
    }
  }

  /**
   * Process Discord webhook
   */
  async processDiscordWebhook(req: Request): Promise<WebhookProcessResult> {
    try {
      const payload: DiscordWebhookPayload = req.body;
      if (!payload.id) return { success: false, message: "Invalid payload" };

      const idempotentKey = `discord_${payload.id}`;

      await durableOperationService.execute({
        category: "discord_webhook",
        idempotentKey,
        payload,
      });

      return {
        success: true,
        message: "Discord webhook accepted for durable processing",
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "Internal error" };
    }
  }

  private async handleTelegramUpdate(payload: TelegramWebhookPayload): Promise<any> {
    // Original business logic for telegram would go here
    console.log("Durable handling of telegram update", payload.update_id);
    return { status: "processed" };
  }

  private async handleDiscordUpdate(payload: DiscordWebhookPayload): Promise<any> {
    // Original business logic for discord would go here
    console.log("Durable handling of discord update", payload.id);
    return { status: "processed" };
  }
}

export const platformWebhookService = new PlatformWebhookService();

      // Handle Discord ping (type 1)
      if (payload.type === 1) {
        return {
          success: true,
          message: "pong",
          data: { type: 1 },
        };
      }

      // Validate payload structure
      if (!payload.id) {
        return {
          success: false,
          message: "Invalid Discord webhook payload",
        };
      }

      // Verify signature
      if (this.DISCORD_PUBLIC_KEY && signature && timestamp) {
        const isValid = this.verifyDiscordSignature(
          JSON.stringify(req.body),
          signature,
          timestamp
        );

        if (!isValid) {
          return {
            success: false,
            message: "Invalid Discord signature",
          };
        }
      }

      // Generate unique webhook ID
      const webhookId = `discord_${payload.id}`;

      // Check for duplicate
      const isDuplicate = await webhookIdempotencyService.isDuplicate(
        webhookId,
        "discord"
      );

      if (isDuplicate) {
        return {
          success: true,
          message: "Webhook already processed (idempotent)",
          isDuplicate: true,
        };
      }

      // Mark as processed
      await webhookIdempotencyService.markProcessed(webhookId, "discord", {
        type: payload.type,
        channelId: payload.channel_id,
        guildId: payload.guild_id,
        authorId: payload.author?.id,
      });

      // Process the webhook
      const result = await this.handleDiscordInteraction(payload);

      return {
        success: true,
        message: "Discord webhook processed successfully",
        data: result,
      };
    } catch (error) {
      console.error("Error processing Discord webhook:", error);
      return {
        success: false,
        message:
          error instanceof Error ? error.message : "Internal server error",
      };
    }
  }

  /**
   * Download voice file from Telegram
   */
  private async downloadTelegramVoiceFile(
    fileId: string
  ): Promise<Buffer | null> {
    try {
      const botToken = this.TELEGRAM_SECRET;
      if (!botToken) {
        console.error("Telegram bot token not configured");
        return null;
      }

      // Get file info from Telegram
      const fileInfoResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/getFile?file_id=${fileId}`
      );
      const fileInfo = await fileInfoResponse.json();

      if (!fileInfo.ok) {
        console.error("Failed to get Telegram file info:", fileInfo);
        return null;
      }

      // Download the file
      const fileUrl = `https://api.telegram.org/file/bot${botToken}/${fileInfo.result.file_path}`;
      const fileResponse = await fetch(fileUrl);

      if (!fileResponse.ok) {
        console.error("Failed to download Telegram voice file");
        return null;
      }

      const arrayBuffer = await fileResponse.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (error) {
      console.error("Error downloading Telegram voice file:", error);
      return null;
    }
  }

  /**
   * Handle Telegram voice message
   */
  private async handleVoiceMessage(
    payload: TelegramWebhookPayload
  ): Promise<unknown> {
    const voice = payload.message?.voice;
    if (!voice) {
      return { error: "No voice data found" };
    }

    console.log(
      `Processing voice message from ${payload.message?.from.username}, duration: ${voice.duration}s`
    );

    // Download voice file
    const audioBuffer = await this.downloadTelegramVoiceFile(voice.file_id);
    if (!audioBuffer) {
      return { error: "Failed to download voice file" };
    }

    // Transcribe audio
    const transcriptionResult = await voiceTranscriptionService.transcribeAudio(
      audioBuffer,
      voice.mime_type || "audio/ogg"
    );

    if (!transcriptionResult.success || !transcriptionResult.text) {
      return { error: "Failed to transcribe voice message" };
    }

    console.log(`Transcribed text: ${transcriptionResult.text}`);

    // Process transcribed text with agent for intent parsing
    const userId = String(payload.message?.from.id);
    try {
      const agentResult = await agentLLM.callLLM(
        userId,
        "You are a helpful AI assistant. Parse the user's intent from their voice message and respond appropriately.",
        transcriptionResult.text,
        false
      );

      return {
        type: "voice",
        transcription: transcriptionResult.text,
        agentResponse: agentResult,
        processed: true,
      };
    } catch (error) {
      console.error("Error processing voice message with agent:", error);
      return {
        type: "voice",
        transcription: transcriptionResult.text,
        error: "Failed to process with agent",
      };
    }
  }

  /**
   * Handle Telegram update - implement your business logic here
   */
  private async handleTelegramUpdate(
    payload: TelegramWebhookPayload
  ): Promise<unknown> {
    console.log("Processing Telegram update:", payload.update_id);

    // Handle voice messages
    if (payload.message?.voice) {
      return this.handleVoiceMessage(payload);
    }

    // Handle text messages
    if (payload.message?.text) {
      console.log(
        `Message from ${payload.message.from.username}: ${payload.message.text}`
      );
      
      // Process text message with agent
      const userId = String(payload.message.from.id);
      try {
        const agentResult = await agentLLM.callLLM(
          userId,
          "You are a helpful AI assistant. Respond to the user's message appropriately.",
          payload.message.text,
          false
        );

        return {
          type: "text",
          text: payload.message.text,
          agentResponse: agentResult,
          processed: true,
        };
      } catch (error) {
        console.error("Error processing text message with agent:", error);
        return {
          type: "text",
          text: payload.message.text,
          error: "Failed to process with agent",
        };
      }
    }

    // Handle callback queries
    if (payload.callback_query) {
      console.log(
        `Callback query from ${payload.callback_query.from.username}: ${payload.callback_query.data}`
      );
      return { processed: true, type: "callback" };
    }

    return { processed: true };
  }

  /**
   * Handle Discord interaction - implement your business logic here
   */
  private async handleDiscordInteraction(
    payload: DiscordWebhookPayload
  ): Promise<unknown> {
    console.log("Processing Discord interaction:", payload.id);

    // TODO: Implement your Discord interaction handling logic
    // Examples:
    // - Process slash commands
    // - Handle button clicks
    // - Process messages
    // - Integrate with your AI agent

    if (payload.content) {
      console.log(
        `Message from ${payload.author?.username}: ${payload.content}`
      );
    }

    return { processed: true };
  }
}

export const platformWebhookService = new PlatformWebhookService();
