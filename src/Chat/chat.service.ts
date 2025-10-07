import { injectable } from "tsyringe";
import { Repository } from "typeorm";
import { Conversation } from "./conversation.entity";
import { Message } from "./message.entity";
import AppDataSource from "../config/Datasource";

@injectable()
export class ChatService {
  private conversationRepository: Repository<Conversation>;
  private messageRepository: Repository<Message>;

  constructor() {
    this.conversationRepository = AppDataSource.getRepository(Conversation);
    this.messageRepository = AppDataSource.getRepository(Message);
  }

  async createConversation(title: string, description?: string, userId?: string): Promise<Conversation> {
    const conversation = this.conversationRepository.create({
      title,
      description,
      userId,
      isActive: true,
    });
    return this.conversationRepository.save(conversation);
  }

  async getConversations(limit: number = 50, userId?: string): Promise<Conversation[]> {
    const queryBuilder = this.conversationRepository
      .createQueryBuilder("conversation")
      .leftJoinAndSelect("conversation.messages", "messages")
      .orderBy("conversation.updatedAt", "DESC")
      .limit(limit);

    if (userId) {
      queryBuilder.where("conversation.userId = :userId", { userId });
    }

    return queryBuilder.getMany();
  }

  async getConversationById(conversationId: string): Promise<Conversation | null> {
    return this.conversationRepository.findOne({
      where: { id: conversationId },
      relations: ["messages"],
    });
  }

  async updateConversation(conversationId: string, data: Partial<Conversation>): Promise<Conversation | null> {
    await this.conversationRepository.update(conversationId, data);
    return this.getConversationById(conversationId);
  }

  async deleteConversation(conversationId: string): Promise<void> {
    await this.conversationRepository.delete(conversationId);
  }

  async getOrCreateActiveConversation(userId?: string): Promise<Conversation> {
    // First, try to find an active conversation
    let activeConversation = await this.conversationRepository.findOne({
      where: { isActive: true, userId },
      relations: ["messages"],
    });

    // If no active conversation exists, create a new one
    if (!activeConversation) {
      activeConversation = await this.createConversation(
        "New Conversation",
        "Auto-generated conversation",
        userId
      );
    }

    return activeConversation;
  }

  async createMessage(
    conversationId: string,
    role: "user" | "agent",
    content: string,
    metadata?: any
  ): Promise<Message> {
    const message = this.messageRepository.create({
      conversationId,
      role,
      content,
      metadata,
    });
    return this.messageRepository.save(message);
  }

  async getMessages(conversationId: string, limit: number = 100): Promise<Message[]> {
    return this.messageRepository.find({
      where: { conversationId },
      order: { createdAt: "ASC" },
      take: limit,
    });
  }

  async deleteMessage(messageId: string): Promise<void> {
    await this.messageRepository.delete(messageId);
  }
}