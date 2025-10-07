import { injectable } from "tsyringe";
import { Request, Response } from "express";
import { ChatService } from "./chat.service";

@injectable()
export class ChatController {
  constructor(private chatService: ChatService) {}

  async createConversation(req: Request, res: Response): Promise<void> {
    try {
      const { title, description } = req.body;
      const userId = req.body.userId; 

      if (!title) {
        res.status(400).json({
          success: false,
          message: "Title is required",
        });
        return;
      }

      const conversation = await this.chatService.createConversation(title, description, userId);
      
      res.json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      console.error("Error creating conversation:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create conversation",
      });
    }
  }

  async getConversations(req: Request, res: Response): Promise<void> {
    try {
      const limit = parseInt(req.query.limit as string) || 50;
      const userId = req.query.userId as string;

      const conversations = await this.chatService.getConversations(limit, userId);
      
      res.json({
        success: true,
        data: conversations,
      });
    } catch (error) {
      console.error("Error getting conversations:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get conversations",
      });
    }
  }

  async getConversationById(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const conversation = await this.chatService.getConversationById(conversationId);

      if (!conversation) {
        res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
        return;
      }

      res.json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      console.error("Error getting conversation:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get conversation",
      });
    }
  }

  async updateConversation(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const updateData = req.body;

      const conversation = await this.chatService.updateConversation(conversationId, updateData);

      if (!conversation) {
        res.status(404).json({
          success: false,
          message: "Conversation not found",
        });
        return;
      }

      res.json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      console.error("Error updating conversation:", error);
      res.status(500).json({
        success: false,
        message: "Failed to update conversation",
      });
    }
  }

  async deleteConversation(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      await this.chatService.deleteConversation(conversationId);

      res.json({
        success: true,
        data: { message: "Conversation deleted successfully" },
      });
    } catch (error) {
      console.error("Error deleting conversation:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete conversation",
      });
    }
  }

  async getOrCreateActiveConversation(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.query.userId as string;
      const conversation = await this.chatService.getOrCreateActiveConversation(userId);

      res.json({
        success: true,
        data: conversation,
      });
    } catch (error) {
      console.error("Error getting/creating active conversation:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get/create active conversation",
      });
    }
  }

  async createMessage(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId, role, content, metadata } = req.body;

      if (!conversationId || !role || !content) {
        res.status(400).json({
          success: false,
          message: "conversationId, role, and content are required",
        });
        return;
      }

      if (role !== "user" && role !== "agent") {
        res.status(400).json({
          success: false,
          message: "Role must be either 'user' or 'agent'",
        });
        return;
      }

      const message = await this.chatService.createMessage(conversationId, role, content, metadata);

      res.json({
        success: true,
        data: message,
      });
    } catch (error) {
      console.error("Error creating message:", error);
      res.status(500).json({
        success: false,
        message: "Failed to create message",
      });
    }
  }

  async getMessages(req: Request, res: Response): Promise<void> {
    try {
      const { conversationId } = req.params;
      const limit = parseInt(req.query.limit as string) || 100;

      const messages = await this.chatService.getMessages(conversationId, limit);

      res.json({
        success: true,
        data: messages,
      });
    } catch (error) {
      console.error("Error getting messages:", error);
      res.status(500).json({
        success: false,
        message: "Failed to get messages",
      });
    }
  }

  async deleteMessage(req: Request, res: Response): Promise<void> {
    try {
      const { messageId } = req.params;
      await this.chatService.deleteMessage(messageId);

      res.json({
        success: true,
        data: { message: "Message deleted successfully" },
      });
    } catch (error) {
      console.error("Error deleting message:", error);
      res.status(500).json({
        success: false,
        message: "Failed to delete message",
      });
    }
  }
}