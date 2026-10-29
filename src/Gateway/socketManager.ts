import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import logger from "../config/logger";
import { EventEmitter } from "events";
import { randomUUID } from "crypto";
import { evaluateRealtimeAbusePolicy } from "../Security";
import { authorizeSocketOperation } from "../Security/authorization/channelAdapters";
import {
  propagateSocketContext,
  runWithSocketRequest,
} from "../observability/socketContext";
import { getExecutionContext } from "../observability/context";
import {
  DEFAULT_MAX_BUFFERED_EVENTS,
  DeliveryClass,
  SocketFlowController,
} from "./flowControl";
import { validateSubscriptionPayload } from "./socketValidation";
import { BOT_ALL_ROOM, RoomKind, tryBuildRoomName } from "./roomNames";
import { auditLogService } from "../AuditLog/auditLog.service";
import { AuditAction, AuditSeverity } from "../AuditLog/auditLog.entity";
import {
  resolveSubscriptionLimits,
  subscribeToBot,
  subscribeToTransaction,
  SubscriptionManager,
  unsubscribeFromBot,
  unsubscribeFromTransaction,
} from "./subscriptionManager";
import {
  DENIED_REASON,
  ResourceSubscription,
  roomName,
  SubscriptionAccess,
} from "./subscriptionAccess";

/**
 * Resolve the per-socket critical-event buffer bound from the environment.
 */
function resolveMaxBufferedEvents(value: string | undefined): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0
    ? parsed
    : DEFAULT_MAX_BUFFERED_EVENTS;
}

/**
 * Represents a connected client with metadata
 */
interface ConnectedClient {
  userId: string;
  socketId: string;
  connectedAt: Date;
  userAgent?: string;
  ip?: string;
  role: string;
}

/**
 * Real-time update event types
 */
export enum RealtimeEventType {
  TRANSACTION_STATUS_UPDATE = "transaction:status-update",
  TRANSACTION_CREATED = "transaction:created",
  TRANSACTION_CONFIRMED = "transaction:confirmed",
  TRANSACTION_FAILED = "transaction:failed",
  BOT_ALERT = "bot:alert",
  BOT_STATUS_CHANGE = "bot:status-change",
  BOT_ERROR = "bot:error",
  DEPLOYMENT_STATUS = "deployment:status",
  SWAP_STATUS = "swap:status",
  AGENT_EXECUTION_STARTED = "agent:execution-started",
  AGENT_STEP_COMPLETED = "agent:step-completed",
  AGENT_EXECUTION_COMPLETED = "agent:execution-completed",
  AGENT_EXECUTION_FAILED = "agent:execution-failed",
  AGENT_APPROVAL_REQUIRED = "agent:approval-required",
}

/**
 * Transaction status update payload
 */
export interface TransactionStatusUpdate {
  transactionId: string;
  transactionHash: string;
  status: "pending" | "confirmed" | "failed";
  timestamp: Date;
  ledger?: number;
  feeUsed?: number;
  memo?: string;
  userId?: string;
}

/**
 * Agent execution payload
 */
export interface AgentExecutionUpdate {
  executionId: string;
  planId: string;
  userId: string;
  status: string;
  currentStep?: number;
  totalSteps?: number;
  result?: unknown;
  error?: string;
  timestamp: Date;
}

/**
 * Bot alert payload
 */
export interface BotAlert {
  alertId: string;
  severity: "info" | "warning" | "error" | "critical";
  message: string;
  botId?: string;
  timestamp: Date;
  userId?: string;
  details?: Record<string, unknown>;
}

/**
 * Bot status change payload
 */
export interface BotStatusChange {
  botId: string;
  status: "active" | "inactive" | "error" | "paused";
  message: string;
  timestamp: Date;
  userId?: string;
}

/**
 * Deployment status payload
 */
export interface DeploymentStatus {
  deploymentId: string;
  status: "pending" | "in-progress" | "completed" | "failed";
  progress?: number;
  message: string;
  timestamp: Date;
  userId?: string;
  details?: Record<string, unknown>;
}

/**
 * Socket.io event emitter for managing real-time updates
 */
export class RealtimeEventEmitter extends EventEmitter {
  constructor() {
    super();
  }

  /**
   * Emit a transaction status update
   */
  emitTransactionUpdate(update: TransactionStatusUpdate): void {
    this.emit(RealtimeEventType.TRANSACTION_STATUS_UPDATE, update);
  }

  /**
   * Emit a transaction created event
   */
  emitTransactionCreated(update: TransactionStatusUpdate): void {
    this.emit(RealtimeEventType.TRANSACTION_CREATED, update);
  }

  /**
   * Emit a transaction confirmed event
   */
  emitTransactionConfirmed(update: TransactionStatusUpdate): void {
    this.emit(RealtimeEventType.TRANSACTION_CONFIRMED, update);
  }

  /**
   * Emit a transaction failed event
   */
  emitTransactionFailed(update: TransactionStatusUpdate): void {
    this.emit(RealtimeEventType.TRANSACTION_FAILED, update);
  }

  /**
   * Emit a bot alert
   */
  emitBotAlert(alert: BotAlert): void {
    this.emit(RealtimeEventType.BOT_ALERT, alert);
  }

  /**
   * Emit a bot status change
   */
  emitBotStatusChange(statusChange: BotStatusChange): void {
    this.emit(RealtimeEventType.BOT_STATUS_CHANGE, statusChange);
  }

  /**
   * Emit a bot error
   */
  emitBotError(alert: BotAlert): void {
    this.emit(RealtimeEventType.BOT_ERROR, alert);
  }

  /**
   * Emit deployment status update
   */
  emitDeploymentStatus(status: DeploymentStatus): void {
    this.emit(RealtimeEventType.DEPLOYMENT_STATUS, status);
  }

  /**
   * Emit swap status update
   */
  emitSwapStatus(update: TransactionStatusUpdate): void {
    this.emit(RealtimeEventType.SWAP_STATUS, update);
  }

  /**
   * Emit agent execution update
   */
  emitAgentExecutionUpdate(
    type: RealtimeEventType,
    update: AgentExecutionUpdate
  ): void {
    this.emit(type, update);
  }
}

/**
 * Socket.io Server Manager
 * Handles real-time communication with connected clients
 */
export class SocketManager {
  private io: SocketIOServer;
  private connectedClients: Map<string, ConnectedClient>;
  private eventEmitter: RealtimeEventEmitter;
  private userSockets: Map<string, Set<string>>; // userId -> Set of socketIds
  private jwtService: JwtService;
  private flowController: SocketFlowController;
  private subscriptionManager: SubscriptionManager;
  private subscriptionAccess: SubscriptionAccess;

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.ALLOWED_ORIGINS || "*",
        credentials: true,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization"],
      },
      transports: ["websocket", "polling"],
      pingInterval: 25000,
      pingTimeout: 60000,
      maxHttpBufferSize: 1e6, // 1 MB max message size
    });

    this.connectedClients = new Map();
    this.userSockets = new Map();
    this.eventEmitter = new RealtimeEventEmitter();
    this.jwtService = container.resolve(JwtService);
    this.subscriptionManager = new SubscriptionManager(
      resolveSubscriptionLimits()
    );
    this.subscriptionAccess = new SubscriptionAccess();
    this.flowController = new SocketFlowController(
      {
        maxBufferedEventsPerSocket: resolveMaxBufferedEvents(
          process.env.REALTIME_MAX_BUFFERED_EVENTS
        ),
      },
      (slowSocket) => {
        logger.warn(
          `Evicting slow consumer ${slowSocket.id}: outbound event buffer exceeded`
        );
        slowSocket.emit("error", {
          code: "slow_consumer",
          message:
            "Disconnected: outbound event buffer exceeded. Reconnect to resume.",
        });
        slowSocket.disconnect(true);
      }
    );

    this.setupConnectionHandlers();
    this.setupEventListeners();
  }

  /**
   * Setup socket connection and disconnection handlers
   */
  private setupConnectionHandlers(): void {
    this.io.on("connection", async (socket: Socket) => {
      const ip =
        (socket.handshake.headers["x-forwarded-for"] as string) ||
        socket.handshake.address;
      const userAgent = socket.handshake.headers["user-agent"];

      logger.info(`Client connected: ${socket.id} (IP: ${ip})`);

      // Clear the per-socket backpressure counter whenever the transport drains.
      socket.conn.on("drain", () => {
        this.flowController.onDrain(socket.id);
      });

      // Listen for authentication immediately
      socket.once("authenticate", async (token: string) => {
        try {
          const payload = this.jwtService.verifyAccessToken(token);

          const client: ConnectedClient = {
            userId: payload.userId,
            socketId: socket.id,
            connectedAt: new Date(),
            userAgent,
            ip,
            role: payload.role,
          };

          this.connectedClients.set(socket.id, client);

          if (!this.userSockets.has(payload.userId)) {
            this.userSockets.set(payload.userId, new Set());
          }
          this.userSockets.get(payload.userId)!.add(socket.id);

          socket.join(`user:${payload.userId}`);
          socket.emit("authenticated", {
            success: true,
            userId: payload.userId,
          });

          await auditLogService.log({
            userId: payload.userId,
            action: AuditAction.SENSITIVE_DATA_ACCESS,
            severity: AuditSeverity.INFO,
            ipAddress: ip,
            userAgent,
            resource: "realtime:connection",
            metadata: {
              event: "connected",
              socketId: socket.id,
            },
            success: true,
          });

          logger.info(
            `Client ${socket.id} authenticated as user ${payload.userId}`
          );

          propagateSocketContext(socket, payload.userId, () => {
            this.setupAuthenticatedListeners(socket, client);
          });
        } catch (error) {
          logger.warn(`Authentication failed for client ${socket.id}:`, {
            error: (error as Error).message,
          });
          socket.emit("error", {
            message: "Authentication failed. Invalid token.",
          });
          socket.disconnect(true);
        }
      });

      // Handle subscription to transaction updates — requires prior authentication
      socket.on("subscribe:transactions", async (transactionId?: string) => {
        await runWithSocketRequest(socket, undefined, async () => {
          const client = this.connectedClients.get(socket.id);
          if (!client?.userId) {
            this.emitClientError(socket, {
              message: "Authentication required before subscribing.",
              code: "UNAUTHENTICATED",
            });
            logger.warn(
              `Unauthenticated client ${socket.id} attempted to subscribe to transactions`,
              { requestId: getExecutionContext()?.requestId }
            );
            return;
          }
          const abuseDecision = await evaluateRealtimeAbusePolicy(
            "subscribe:transactions",
            {
              userId: client.userId,
              sessionId: socket.id,
              ipAddress: socket.handshake.address,
            },
            { transactionId }
          );
          // Audit log denial
          await auditLogService.log({
            userId: 'anonymous',
            action: AuditAction.SENSITIVE_DATA_ACCESS,
            severity: AuditSeverity.WARNING,
            ipAddress: socket.handshake.address,
            resource: "realtime:subscription",
            metadata: {
              type: "transactions",
              reason: "unauthenticated",
              socketId: socket.id,
            },
            success: false,
          }).catch((err) => logger.error("Failed to log subscription denial audit event", { err }));
          return;
        }

        // Validate payload before any lookup or audit write
        const validation = validateSubscriptionPayload('transactions', transactionId);
        if (!validation.valid) {
          socket.emit("error", {
            message: validation.error || "Invalid subscription payload",
            code: validation.code,
          });
          logger.warn(
            `Subscription payload validation failed for client ${socket.id}: ${validation.code}`
          );
          // Audit log denial
          await auditLogService.log({
            userId: client.userId,
            action: AuditAction.SENSITIVE_DATA_ACCESS,
            severity: AuditSeverity.WARNING,
            ipAddress: client.ip,
            userAgent: client.userAgent,
            resource: "realtime:subscription",
            metadata: {
              type: "transactions",
              reason: `validation_failed:${validation.code}`,
              socketId: socket.id,
            },
            success: false,
          }).catch((err) => logger.error("Failed to log subscription denial audit event", { err }));
          return;
        }

        const abuseDecision = await evaluateRealtimeAbusePolicy(
          "subscribe:transactions",
          {
            userId: client.userId,
            sessionId: socket.id,
            ipAddress: socket.handshake.address,
          },
          { transactionId }
        );
        const authz = await authorizeSocketOperation(
          { userId: client.userId, role: client.role },
          "realtime:subscribe",
          "subscribe:transactions"
        );
        if (!authz.allowed) {
          socket.emit("error", {
            message: "Not authorized for this subscription.",
            code: authz.reason,
            decisionId: authz.decisionId,
          });
          // Audit log denial
          await auditLogService.log({
            userId: client.userId,
            action: AuditAction.SENSITIVE_DATA_ACCESS,
            severity: AuditSeverity.WARNING,
            ipAddress: client.ip,
            userAgent: client.userAgent,
            resource: "realtime:subscription",
            metadata: {
              type: "transactions",
              reason: `unauthorized:${authz.reason}`,
              decisionId: authz.decisionId,
              socketId: socket.id,
            },
            success: false,
          }).catch((err) => logger.error("Failed to log subscription denial audit event", { err }));
          return;
        }
        if (!abuseDecision.allowed) {
          socket.emit("error", {
            message: abuseDecision.reason,
            code: abuseDecision.policyId,
            retryAfterMs: abuseDecision.retryAfterMs,
          });
          // Audit log denial
          await auditLogService.log({
            userId: client.userId,
            action: AuditAction.SENSITIVE_DATA_ACCESS,
            severity: AuditSeverity.WARNING,
            ipAddress: client.ip,
            userAgent: client.userAgent,
            resource: "realtime:subscription",
            metadata: {
              type: "transactions",
              reason: `abuse_policy:${abuseDecision.policyId}`,
              policyId: abuseDecision.policyId,
              socketId: socket.id,
            },
            success: false,
          }).catch((err) => logger.error("Failed to log subscription denial audit event", { err }));
          return;
        }
        if (transactionId) {
          const decision = await this.subscriptionAccess.authorizeTransaction(
            client.userId,
            transactionId
          );
          if (!decision.allowed) {
            this.emitClientError(socket, {
              message: DENIED_REASON,
              code: "NOT_AUTHORIZED",
            });
            await auditLogService.log({
              userId: client.userId,
              action: AuditAction.SENSITIVE_DATA_ACCESS,
              severity: AuditSeverity.WARNING,
              ipAddress: client.ip,
              userAgent: client.userAgent,
              resource: "realtime:subscription",
              metadata: {
                type: "transactions",
                transactionId,
                reason: "ownership_denied",
                socketId: socket.id,
              },
              success: false,
            }).catch((err) => logger.error("Failed to log subscription denial audit event", { err }));
            return;
          }
          socket.join(`transaction:${transactionId}`);
          const authz = await authorizeSocketOperation(
            { userId: client.userId, role: client.role },
            "realtime:subscribe",
            "subscribe:transactions"
          );
          if (!authz.allowed) {
            this.emitClientError(socket, {
              message: "Not authorized for this subscription.",
              code: authz.reason,
              decisionId: authz.decisionId,
            });
            return;
          }
          if (!abuseDecision.allowed) {
            this.emitClientError(socket, {
              message: abuseDecision.reason,
              code: abuseDecision.policyId,
              retryAfterMs: abuseDecision.retryAfterMs,
            });
            return;
          }
          if (!transactionId) {
            return;
          }
          const result = subscribeToTransaction(
            socket,
            this.subscriptionManager,
            client.userId,
            transactionId
          );
          if (!result.ok) {
            this.emitClientError(socket, {
              message: result.message,
              code: result.code,
            });
            return;
          }
          this.subscriptionAccess.track(socket.id, client.userId, {
            kind: "transaction",
            resourceId: transactionId,
          });
          logger.info(
            `Client ${socket.id} subscribed to transaction ${transactionId}`,
            { requestId: getExecutionContext()?.requestId }
          );
        });
      });

      // Handle subscription to bot updates — requires prior authentication
      socket.on("subscribe:bot-alerts", async (botId?: string) => {
        await runWithSocketRequest(socket, undefined, async () => {
          const client = this.connectedClients.get(socket.id);
          if (!client?.userId) {
            this.emitClientError(socket, {
              message: "Authentication required before subscribing.",
              code: "UNAUTHENTICATED",
            });
            logger.warn(
              `Unauthenticated client ${socket.id} attempted to subscribe to bot alerts`,
              { requestId: getExecutionContext()?.requestId }
            );
            return;
          }
          const abuseDecision = await evaluateRealtimeAbusePolicy(
            "subscribe:bot-alerts",
            {
              userId: client.userId,
              sessionId: socket.id,
              ipAddress: socket.handshake.address,
            },
            { botId }
          );
          const authz = await authorizeSocketOperation(
            { userId: client.userId, role: client.role },
            "realtime:subscribe",
            "subscribe:bot-alerts"
          );
          if (!authz.allowed) {
            this.emitClientError(socket, {
              message: "Not authorized for this subscription.",
              code: authz.reason,
              decisionId: authz.decisionId,
            });
            return;
          }
          if (!abuseDecision.allowed) {
            this.emitClientError(socket, {
              message: abuseDecision.reason,
              code: abuseDecision.policyId,
              retryAfterMs: abuseDecision.retryAfterMs,
            });
            return;
          }
          if (botId) {
            const botDecision = await this.subscriptionAccess.authorizeBot(
              client.userId,
              botId
            );
            if (!botDecision.allowed) {
              this.emitClientError(socket, {
                message: DENIED_REASON,
                code: "NOT_AUTHORIZED",
              });
              await auditLogService.log({
                userId: client.userId,
                action: AuditAction.SENSITIVE_DATA_ACCESS,
                severity: AuditSeverity.WARNING,
                ipAddress: client.ip,
                userAgent: client.userAgent,
                resource: "realtime:subscription",
                metadata: {
                  type: "bot-alerts",
                  botId,
                  reason: "ownership_denied",
                  socketId: socket.id,
                },
                success: false,
              }).catch((err) => logger.error("Failed to log subscription denial audit event", { err }));
              return;
            }
          }
          const result = subscribeToBot(
            socket,
            this.subscriptionManager,
            client.userId,
            botId
          );
          if (!result.ok) {
            this.emitClientError(socket, {
              message: result.message,
              code: result.code,
            });
            return;
          }
          if (botId) {
            this.subscriptionAccess.track(socket.id, client.userId, {
              kind: "bot",
              resourceId: botId,
            });
          }
          logger.info(
            botId
              ? `Client ${socket.id} subscribed to bot ${botId}`
              : `Client ${socket.id} subscribed to all bot alerts`,
            { requestId: getExecutionContext()?.requestId }
          );
        });
      });

      // Explicit unsubscribe — removes only this socket from the selected room
      socket.on("unsubscribe:transactions", async (transactionId?: string) => {
        await runWithSocketRequest(socket, undefined, async () => {
          const client = this.connectedClients.get(socket.id);
          if (!client?.userId) {
            this.emitClientError(socket, {
              message: "Authentication required before unsubscribing.",
              code: "UNAUTHENTICATED",
            });
            return;
          }
          if (!transactionId) {
            this.emitClientError(socket, {
              message: "transactionId is required to unsubscribe.",
              code: "INVALID_IDENTIFIER",
            });
            return;
          }
          const result = unsubscribeFromTransaction(
            socket,
            this.subscriptionManager,
            transactionId
          );
          if (!result.ok) {
            this.emitClientError(socket, {
              message: result.message,
              code: result.code,
            });
            return;
          }
          this.subscriptionAccess.untrack(socket.id, {
            kind: "transaction",
            resourceId: transactionId,
          });
          socket.emit("unsubscribed", {
            channel: "transactions",
            transactionId,
            wasSubscribed: result.wasSubscribed,
            requestId: getExecutionContext()?.requestId,
          });
          logger.info(
            `Client ${socket.id} unsubscribed from transaction ${transactionId}`,
            { requestId: getExecutionContext()?.requestId }
          );
        });
      });

      socket.on("unsubscribe:bot-alerts", async (botId?: string) => {
        await runWithSocketRequest(socket, undefined, async () => {
          const client = this.connectedClients.get(socket.id);
          if (!client?.userId) {
            this.emitClientError(socket, {
              message: "Authentication required before unsubscribing.",
              code: "UNAUTHENTICATED",
            });
            return;
          }
          const result = unsubscribeFromBot(
            socket,
            this.subscriptionManager,
            botId
          );
          if (!result.ok) {
            this.emitClientError(socket, {
              message: result.message,
              code: result.code,
            });
            return;
          }
          if (botId) {
            this.subscriptionAccess.untrack(socket.id, {
              kind: "bot",
              resourceId: botId,
            });
          }
          socket.emit("unsubscribed", {
            channel: "bot-alerts",
            botId: botId ?? null,
            wasSubscribed: result.wasSubscribed,
            requestId: getExecutionContext()?.requestId,
          });
          logger.info(
            botId
              ? `Client ${socket.id} unsubscribed from bot ${botId}`
              : `Client ${socket.id} unsubscribed from all bot alerts`,
            { requestId: getExecutionContext()?.requestId }
          );
        });
      });

      // Handle disconnection
      socket.on("disconnect", async (reason) => {
        clearTimeout(authTimeout);
        this.subscriptionManager.clearSocket(socket.id);
        this.subscriptionAccess.clearSocket(socket.id);
        const disconnectedClient = this.connectedClients.get(socket.id);
        if (disconnectedClient?.userId) {
          const userSockets = this.userSockets.get(disconnectedClient.userId);
          if (userSockets) {
            userSockets.delete(socket.id);
            if (userSockets.size === 0) {
              this.userSockets.delete(disconnectedClient.userId);
            }
          }

          // Audit log disconnection
          await auditLogService.log({
            userId: disconnectedClient.userId,
            action: AuditAction.SENSITIVE_DATA_ACCESS,
            severity: AuditSeverity.INFO,
            ipAddress: disconnectedClient.ip,
            userAgent: disconnectedClient.userAgent,
            resource: "realtime:connection",
            metadata: {
              event: "disconnected",
              socketId: socket.id,
              reason,
            },
            success: true,
          });
        }
        this.connectedClients.delete(socket.id);
        this.flowController.onDrain(socket.id);
        logger.info(`Client disconnected: ${socket.id} (Reason: ${reason})`);
      });

      // Handle errors
      socket.on("error", (error: Error) => {
        logger.error(`Socket error for ${socket.id}:`, {
          error: error.message,
        });
      });
    });
  }

  /**
   * Emit an error to a single client, always tagged with the request id of
   * the inbound socket event so support can correlate it with server logs.
   */
  private emitClientError(
    socket: Socket,
    payload: Record<string, unknown>
  ): void {
    const requestId =
      getExecutionContext()?.requestId ||
      (payload.requestId as string | undefined) ||
      randomUUID();
    socket.emit("error", { ...payload, requestId });
  }

  /**
   * Setup event listeners for authenticated clients
   */
  private setupAuthenticatedListeners(
    socket: Socket,
    client: ConnectedClient
  ): void {
    // Handle subscription to transaction updates
    socket.on("subscribe:transactions", async (transactionId?: string) => {
      try {
        // Validate payload before any lookup or audit write
        const validation = validateSubscriptionPayload('transactions', transactionId);
        if (!validation.valid) {
          socket.emit("error", {
            message: validation.error || "Invalid subscription payload",
            code: validation.code,
          });
          logger.warn(
            `Subscription payload validation failed for client ${socket.id}: ${validation.code}`
          );
          // Audit log denial
          await auditLogService.log({
            userId: client.userId,
            action: AuditAction.SENSITIVE_DATA_ACCESS,
            severity: AuditSeverity.WARNING,
            ipAddress: client.ip,
            userAgent: client.userAgent,
            resource: "realtime:subscription",
            metadata: {
              type: "transactions",
              reason: `validation_failed:${validation.code}`,
              socketId: socket.id,
            },
            success: false,
          }).catch((err) => logger.error("Failed to log subscription denial audit event", { err }));
          return;
        }

        if (transactionId) {
          const decision = await this.subscriptionAccess.authorizeTransaction(
            client.userId,
            transactionId
          );
          if (!decision.allowed) {
            this.emitClientError(socket, {
              message: DENIED_REASON,
              code: "NOT_AUTHORIZED",
            });
            await auditLogService.log({
              userId: client.userId,
              action: AuditAction.SENSITIVE_DATA_ACCESS,
              severity: AuditSeverity.WARNING,
              ipAddress: client.ip,
              userAgent: client.userAgent,
              resource: "realtime:subscription",
              metadata: {
                type: "transactions",
                transactionId,
                reason: "ownership_denied",
                socketId: socket.id,
              },
              success: false,
            }).catch((err) => logger.error("Failed to log subscription denial audit event", { err }));
            return;
          }
          this.subscriptionAccess.track(socket.id, client.userId, {
            kind: "transaction",
            resourceId: transactionId,
          });
          const result = subscribeToTransaction(
            socket,
            this.subscriptionManager,
            client.userId,
            transactionId
          );
          if (!result.ok) {
            this.emitClientError(socket, {
              message: result.message,
              code: result.code,
            });
            return;
          }
          logger.info(
            `Client ${socket.id} (user: ${client.userId}) subscribed to transaction ${transactionId}`,
            { requestId: getExecutionContext()?.requestId }
          );

          // Audit log subscription
          await auditLogService.log({
            userId: client.userId,
            action: AuditAction.SENSITIVE_DATA_ACCESS,
            severity: AuditSeverity.INFO,
            ipAddress: client.ip,
            userAgent: client.userAgent,
            resource: "realtime:subscription",
            metadata: {
              type: "transactions",
              transactionId,
              requestId: getExecutionContext()?.requestId,
            },
            success: true,
          });
        }
      } catch (error) {
        logger.error(`Failed to subscribe to transactions:`, { error });
        this.emitClientError(socket, { message: "Failed to subscribe." });
      }
    });

    // Handle subscription to bot updates
    socket.on("subscribe:bot-alerts", async (botId?: string) => {
      try {
        // Validate payload before any lookup or audit write
        const validation = validateSubscriptionPayload('bot-alerts', botId);
        if (!validation.valid) {
          socket.emit("error", {
            message: validation.error || "Invalid subscription payload",
            code: validation.code,
          });
          logger.warn(
            `Subscription payload validation failed for client ${socket.id}: ${validation.code}`
          );
          // Audit log denial
          await auditLogService.log({
            userId: client.userId,
            action: AuditAction.SENSITIVE_DATA_ACCESS,
            severity: AuditSeverity.WARNING,
            ipAddress: client.ip,
            userAgent: client.userAgent,
            resource: "realtime:subscription",
            metadata: {
              type: "bot-alerts",
              reason: `validation_failed:${validation.code}`,
              socketId: socket.id,
            },
            success: false,
          }).catch((err) => logger.error("Failed to log subscription denial audit event", { err }));
          return;
        }

        if (botId) {
          const decision = await this.subscriptionAccess.authorizeBot(
            client.userId,
            botId
          );
          if (!decision.allowed) {
            this.emitClientError(socket, {
              message: DENIED_REASON,
              code: "NOT_AUTHORIZED",
            });
            await auditLogService.log({
              userId: client.userId,
              action: AuditAction.SENSITIVE_DATA_ACCESS,
              severity: AuditSeverity.WARNING,
              ipAddress: client.ip,
              userAgent: client.userAgent,
              resource: "realtime:subscription",
              metadata: {
                type: "bot-alerts",
                botId,
                reason: "ownership_denied",
                socketId: socket.id,
              },
              success: false,
            }).catch((err) => logger.error("Failed to log subscription denial audit event", { err }));
            return;
          }
        }
        const result = subscribeToBot(
          socket,
          this.subscriptionManager,
          client.userId,
          botId
        );
        if (!result.ok) {
          this.emitClientError(socket, {
            message: result.message,
            code: result.code,
          });
          return;
        }
        if (botId) {
          this.subscriptionAccess.track(socket.id, client.userId, {
            kind: "bot",
            resourceId: botId,
          });
        }
        logger.info(
          botId
            ? `Client ${socket.id} (user: ${client.userId}) subscribed to bot ${botId}`
            : `Client ${socket.id} (user: ${client.userId}) subscribed to all bot alerts`,
          { requestId: getExecutionContext()?.requestId }
        );

        await auditLogService.log({
          userId: client.userId,
          action: AuditAction.SENSITIVE_DATA_ACCESS,
          severity: AuditSeverity.INFO,
          ipAddress: client.ip,
          userAgent: client.userAgent,
          resource: "realtime:subscription",
          metadata: {
            type: "bot-alerts",
            botId: botId ?? null,
            requestId: getExecutionContext()?.requestId,
          },
          success: true,
        });
      } catch (error) {
        logger.error(`Failed to subscribe to bot alerts:`, { error });
        this.emitClientError(socket, { message: "Failed to subscribe." });
      }
    });
  }

  /**
   * Setup event listeners from the event emitter
   */
  private setupEventListeners(): void {
    // Transaction updates
    this.eventEmitter.on(
      RealtimeEventType.TRANSACTION_STATUS_UPDATE,
      (update: TransactionStatusUpdate) => {
        this.broadcastTransactionUpdate(update);
      }
    );

    this.eventEmitter.on(
      RealtimeEventType.TRANSACTION_CREATED,
      (update: TransactionStatusUpdate) => {
        this.broadcastTransactionEvent("created", update);
      }
    );

    this.eventEmitter.on(
      RealtimeEventType.TRANSACTION_CONFIRMED,
      (update: TransactionStatusUpdate) => {
        this.broadcastTransactionEvent("confirmed", update);
      }
    );

    this.eventEmitter.on(
      RealtimeEventType.TRANSACTION_FAILED,
      (update: TransactionStatusUpdate) => {
        this.broadcastTransactionEvent("failed", update);
      }
    );

    this.eventEmitter.on(
      RealtimeEventType.SWAP_STATUS,
      (update: TransactionStatusUpdate) => {
        this.broadcastSwapStatus(update);
      }
    );

    // Bot alerts
    this.eventEmitter.on(RealtimeEventType.BOT_ALERT, (alert: BotAlert) => {
      this.broadcastBotAlert(alert);
    });

    this.eventEmitter.on(
      RealtimeEventType.BOT_STATUS_CHANGE,
      (statusChange: BotStatusChange) => {
        this.broadcastBotStatusChange(statusChange);
      }
    );

    this.eventEmitter.on(RealtimeEventType.BOT_ERROR, (alert: BotAlert) => {
      this.broadcastBotError(alert);
    });

    // Deployment status
    this.eventEmitter.on(
      RealtimeEventType.DEPLOYMENT_STATUS,
      (status: DeploymentStatus) => {
        this.broadcastDeploymentStatus(status);
      }
    );

    // Agent execution updates
    [
      RealtimeEventType.AGENT_EXECUTION_STARTED,
      RealtimeEventType.AGENT_STEP_COMPLETED,
      RealtimeEventType.AGENT_EXECUTION_COMPLETED,
      RealtimeEventType.AGENT_EXECUTION_FAILED,
      RealtimeEventType.AGENT_APPROVAL_REQUIRED,
    ].forEach((eventType) => {
      this.eventEmitter.on(eventType, (update: AgentExecutionUpdate) => {
        this.broadcastAgentUpdate(eventType, update);
      });
    });
  }

  /**
   * Emit an event to every socket in `room`, applying per-socket flow control.
   *
   * Bypasses `io.to(room).emit` so each recipient is checked against its own
   * bounded buffer and can be evicted independently under backpressure.
   */
  private emitBounded(
    room: string,
    event: string,
    payload: unknown,
    delivery: DeliveryClass
  ): void {
    const members = this.io.sockets.adapter.rooms.get(room);
    if (!members || members.size === 0) {
      return;
    }

    for (const socketId of members) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        this.flowController.send(socket, event, payload, delivery);
      }
    }
  }

  /**
   * Emit to a room built through the canonical room-name helper.
   * Invalid or missing identifiers skip the fan-out instead of throwing.
   */
  private emitToRoom(
    kind: RoomKind,
    id: string | undefined,
    event: string,
    payload: unknown,
    delivery: DeliveryClass
  ): void {
    const room = tryBuildRoomName(kind, id);
    if (!room) {
      return;
    }
    this.emitBounded(room, event, payload, delivery);
  }

  /**
   * Broadcast transaction status update.
   *
   * Lossy: interim status updates are superseded by the next update, so they are
   * dropped rather than buffered for a slow consumer.
   */
  private broadcastTransactionUpdate(update: TransactionStatusUpdate): void {
    if (update.userId) {
      this.emitToRoom("user", update.userId, "transaction:update", update, DeliveryClass.Lossy);
    }
    this.emitToRoom(
      "transaction",
      update.transactionId,
      "transaction:update",
      update,
      DeliveryClass.Lossy
    );
  }

  /**
   * Broadcast transaction event (created, confirmed, failed)
   */
  private broadcastTransactionEvent(
    eventType: "created" | "confirmed" | "failed",
    update: TransactionStatusUpdate
  ): void {
    const eventName = `transaction:${eventType}`;
    if (update.userId) {
      // Critical: terminal lifecycle transitions must not be silently dropped.
      this.emitToRoom("user", update.userId, eventName, update, DeliveryClass.Critical);
    }
  }

  /**
   * Broadcast swap status update
   */
  private broadcastSwapStatus(update: TransactionStatusUpdate): void {
    if (update.userId) {
      this.emitToRoom("user", update.userId, "swap:status", update, DeliveryClass.Lossy);
    }
    this.emitToRoom(
      "transaction",
      update.transactionId,
      "swap:status",
      update,
      DeliveryClass.Lossy
    );
  }

  /**
   * Broadcast bot alert
   */
  private broadcastBotAlert(alert: BotAlert): void {
    if (alert.userId) {
      // Critical: alerts are actionable and must not be dropped silently.
      this.emitToRoom("user", alert.userId, "bot:alert", alert, DeliveryClass.Critical);
    }
    if (alert.botId) {
      this.emitToRoom("bot", alert.botId, "bot:alert", alert, DeliveryClass.Critical);
    }
  }

  /**
   * Broadcast bot status change
   */
  private broadcastBotStatusChange(statusChange: BotStatusChange): void {
    if (statusChange.userId) {
      this.emitToRoom(
        "user",
        statusChange.userId,
        "bot:status-change",
        statusChange,
        DeliveryClass.Lossy
      );
    }
    this.emitToRoom(
      "bot",
      statusChange.botId,
      "bot:status-change",
      statusChange,
      DeliveryClass.Lossy
    );
    this.emitBounded(BOT_ALL_ROOM, "bot:status-change", statusChange, DeliveryClass.Lossy);
  }

  /**
   * Broadcast bot error
   */
  private broadcastBotError(alert: BotAlert): void {
    if (alert.userId) {
      this.emitToRoom("user", alert.userId, "bot:error", alert, DeliveryClass.Critical);
    }
    if (alert.botId) {
      this.emitToRoom("bot", alert.botId, "bot:error", alert, DeliveryClass.Critical);
    }
  }

  /**
   * Broadcast deployment status
   */
  private broadcastDeploymentStatus(status: DeploymentStatus): void {
    if (status.userId) {
      // Critical: deployment outcome is a terminal state change.
      this.emitToRoom(
        "user",
        status.userId,
        "deployment:status",
        status,
        DeliveryClass.Critical
      );
    }
  }

  /**
   * Broadcast agent execution update
   */
  private broadcastAgentUpdate(
    eventType: string,
    update: AgentExecutionUpdate
  ): void {
    // Terminal agent states are critical; intermediate progress is lossy.
    const delivery =
      eventType === RealtimeEventType.AGENT_EXECUTION_COMPLETED ||
      eventType === RealtimeEventType.AGENT_EXECUTION_FAILED ||
      eventType === RealtimeEventType.AGENT_APPROVAL_REQUIRED
        ? DeliveryClass.Critical
        : DeliveryClass.Lossy;

    if (update.userId) {
      this.emitToRoom("user", update.userId, eventType, update, delivery);
    }
    this.emitToRoom("execution", update.executionId, eventType, update, delivery);
  }

  /**
   * Get the event emitter for external use
   */
  public getEventEmitter(): RealtimeEventEmitter {
    return this.eventEmitter;
  }

  /**
   * Get connected clients count
   */
  public getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }

  /**
   * Get connected clients for a specific user
   */
  public getUserClients(userId: string): ConnectedClient[] {
    const socketIds = this.userSockets.get(userId) || new Set();
    return Array.from(socketIds)
      .map((socketId) => this.connectedClients.get(socketId))
      .filter((client) => client !== undefined) as ConnectedClient[];
  }

  /**
   * Get all connected clients
   */
  public getAllConnectedClients(): ConnectedClient[] {
    return Array.from(this.connectedClients.values());
  }

  /**
   * Get Socket.io server instance
   */
  public getIO(): SocketIOServer {
    return this.io;
  }

  /**
   * Revoke room membership for a resource whose ownership or grants changed.
   * Affected sockets leave the room immediately without requiring reconnect.
   */
  public revokeAccess(userId: string, sub: ResourceSubscription): void {
    const sockets = this.subscriptionAccess.findForResource(userId, sub);
    const room = roomName(sub);
    for (const socketId of sockets) {
      const socket = this.io.sockets.sockets.get(socketId);
      if (socket) {
        socket.leave(room);
      }
      this.subscriptionAccess.untrack(socketId, sub);
      this.subscriptionManager.tryUnsubscribe(socketId, room);
      logger.info(
        `Revoked ${sub.kind}:${sub.resourceId} access for socket ${socketId}`
      );
    }
  }

  /**
   * Close the socket server
   */
  public async close(): Promise<void> {
    return new Promise((resolve) => {
      this.io.close(() => {
        logger.info("Socket.io server closed");
        resolve();
      });
    });
  }
}

// Global instance
let socketManagerInstance: SocketManager | null = null;

/**
 * Initialize Socket Manager (to be called during server startup)
 */
export function initializeSocketManager(httpServer: HTTPServer): SocketManager {
  if (socketManagerInstance) {
    logger.warn("SocketManager already initialized");
    return socketManagerInstance;
  }
  socketManagerInstance = new SocketManager(httpServer);
  logger.info("SocketManager initialized");
  return socketManagerInstance;
}

/**
 * Get the global Socket Manager instance
 */
export function getSocketManager(): SocketManager {
  if (!socketManagerInstance) {
    throw new Error(
      "SocketManager not initialized. Call initializeSocketManager first."
    );
  }
  return socketManagerInstance;
}
