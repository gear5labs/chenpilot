import { Router } from "express";
import { container } from "tsyringe";
import { ChatController } from "./chat.controller";
import { ChatService } from "./chat.service";

const router = Router();

// Create instances using tsyringe container
const chatService = container.resolve(ChatService);
const chatController = container.resolve(ChatController);

// Conversation routes
router.post("/conversations", chatController.createConversation.bind(chatController));
router.get("/conversations", chatController.getConversations.bind(chatController));
router.get("/conversations/active", chatController.getOrCreateActiveConversation.bind(chatController));
router.get("/conversations/:conversationId", chatController.getConversationById.bind(chatController));
router.put("/conversations/:conversationId", chatController.updateConversation.bind(chatController));
router.delete("/conversations/:conversationId", chatController.deleteConversation.bind(chatController));

// Message routes
router.post("/messages", chatController.createMessage.bind(chatController));
router.get("/conversations/:conversationId/messages", chatController.getMessages.bind(chatController));
router.delete("/messages/:messageId", chatController.deleteMessage.bind(chatController));

export default router;