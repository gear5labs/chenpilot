/**
 * Socket.io Real-Time Updates - Architecture Reference
 *
 * FILE STRUCTURE & RELATIONSHIPS
 */

/*
┌─────────────────────────────────────────────────────────────────────────┐
│                      PRESENTATION LAYER                                 │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐      │
│  │  Web Browser     │  │  Mobile App      │  │  Admin Dashboard │      │
│  │  (HTML/JS/React) │  │  (React Native)  │  │  (Vue/Angular)   │      │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘      │
│           │                     │                     │                 │
│           └─────────────────────┼─────────────────────┘                 │
│                                 │                                       │
│                    WebSocket/HTTP Long Polling                          │
│                                 │                                       │
└─────────────────────────────────┼─────────────────────────────────────┘
                                  │
                    ┌─────────────────────────┐
                    │   Socket.io Server      │
                    │   (PORT 3000)           │
                    └─────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
┌─────────────────────────────────────────────────────────────────────────┐
│                      GATEWAY LAYER (src/Gateway)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                 socketManager.ts                                 │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │  SocketManager Class                                       │ │  │
│  │  │  ├─ initializeSocketManager()     [Server Setup]          │ │  │
│  │  │  ├─ getSocketManager()            [Singleton Access]       │ │  │
│  │  │  ├─ io: SocketIOServer            [Socket.io Instance]    │ │  │
│  │  │  ├─ connectedClients: Map         [Client Tracking]        │ │  │
│  │  │  └─ eventEmitter: EventEmitter    [Event Bus]              │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │                           │                                       │  │
│  │                           ├─ Connection Handling                  │  │
│  │                           │  ├─ authenticate event               │  │
│  │                           │  ├─ subscribe:transactions event      │  │
│  │                           │  ├─ subscribe:bot-alerts event       │  │
│  │                           │  ├─ disconnect event                 │  │
│  │                           │  └─ error event                      │  │
│  │                           │                                       │  │
│  │                           └─ Broadcasting                         │  │
│  │                              ├─ to user:userId room              │  │
│  │                              ├─ to transaction:txId room          │  │
│  │                              ├─ to bot:botId room                │  │
│  │                              └─ to bot:all room                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                eventBridges.ts                                   │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │  TransactionEventBridge                                    │ │  │
│  │  │  ├─ notifyTransactionCreated()                            │ │  │
│  │  │  ├─ notifyTransactionConfirmed()                          │ │  │
│  │  │  ├─ notifyTransactionFailed()                             │ │  │
│  │  │  └─ notifySwapStatus()                                    │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │  BotEventBridge                                            │ │  │
│  │  │  ├─ notifyAlert()                                         │ │  │
│  │  │  ├─ notifyStatusChange()                                  │ │  │
│  │  │  └─ notifyError()                                         │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │  DeploymentEventBridge                                     │ │  │
│  │  │  ├─ notifyDeploymentStatus()                              │ │  │
│  │  │  ├─ notifyDeploymentStarted()                             │ │  │
│  │  │  ├─ notifyDeploymentProgress()                            │ │  │
│  │  │  └─ notifyDeploymentCompleted()                           │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                realtimeIntegration.ts                            │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │  TransactionUpdateHelper                                   │ │  │
│  │  │  ├─ notifyCreated()                                       │ │  │
│  │  │  ├─ notifyPending()                                       │ │  │
│  │  │  ├─ notifyConfirmed()                                     │ │  │
│  │  │  └─ notifyFailed()                                        │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │  SwapUpdateHelper                                          │ │  │
│  │  │  ├─ notifyStarted()                                       │ │  │
│  │  │  ├─ notifyProgress()                                      │ │  │
│  │  │  ├─ notifyCompleted()                                     │ │  │
│  │  │  └─ notifyFailed()                                        │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │  BotUpdateHelper                                           │ │  │
│  │  │  ├─ notifyInfo/Warning/Error/CriticalError()             │ │  │
│  │  │  ├─ notifyStatusActive/Inactive/Paused/Error()           │ │  │
│  │  │  └─ [Safe async wrappers via SafeUpdateEmitter]          │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │  DeploymentUpdateHelper                                    │ │  │
│  │  │  ├─ notifyStarted()                                       │ │  │
│  │  │  ├─ notifyProgress()                                      │ │  │
│  │  │  ├─ notifyCompleted()                                     │ │  │
│  │  │  └─ notifyFailed()                                        │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                realtimeClient.ts                                 │  │
│  │  ┌────────────────────────────────────────────────────────────┐ │  │
│  │  │  RealtimeClient Class                                      │ │  │
│  │  │  ├─ connect()                    [Establish Connection]    │ │  │
│  │  │  ├─ subscribeToTransaction()     [Join Transaction Room]   │ │  │
│  │  │  ├─ subscribeToBotAlerts()       [Join Bot Alert Room]     │ │  │
│  │  │  ├─ on(eventName, handler)      [Listen to Events]        │ │  │
│  │  │  ├─ off(eventName, handler)     [Stop Listening]          │ │  │
│  │  │  └─ disconnect()                 [Close Connection]        │ │  │
│  │  └────────────────────────────────────────────────────────────┘ │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                routes.ts                                         │  │
│  │  ├─ GET /api/realtime/stats       [Connection Statistics]      │  │
│  │  └─ GET /api/realtime/user/:userId/clients                     │  │
│  │                                     [User's Connected Clients]   │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │                index.ts                                          │  │
│  │  └─ initializeSocketManager(httpServer)  [Initialize on Startup]│  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
                                  │
          ┌───────────────────────┼───────────────────────┐
          │                       │                       │
┌─────────────────────────────────────────────────────────────────────────┐
│                    APPLICATION LAYER                                    │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────────────────┐  ┌──────────────────┐  ┌──────────────┐   │
│  │ Transaction Service     │  │ Bot Service      │  │ Deployment   │   │
│  │ (src/services/*)        │  │ (src/Agents/*)   │  │ Service      │   │
│  │                         │  │                  │  │ (src/*)      │   │
│  │ Uses:                   │  │ Uses:            │  │              │   │
│  │ TransactionUpdateHelper │  │ BotUpdateHelper  │  │ Deploy...    │   │
│  └─────────────────────────┘  └──────────────────┘  │ Helper       │   │
│           │                          │              └──────────────┘   │
│           │                          │                     │            │
│           └──────────────────────────┼─────────────────────┘            │
│                                      │                                  │
└──────────────────────────────────────┼──────────────────────────────────┘
                                       │
                          ┌────────────────────────┐
                          │  External Services     │
                          │  (Webhooks, APIs)      │
                          └────────────────────────┘

CONTROL FLOW EXAMPLE:
═══════════════════════════════════════════════════════════════════════════

1. User initiates transaction in frontend

2. Frontend sends request to Backend API
   └─> TransactionService.processTransaction(txData, userId)

3. Service emits events using helper
   └─> TransactionUpdateHelper.notifyCreated(txId, txHash, userId)

4. Helper delegates to EventBridge
   └─> TransactionEventBridge.notifyTransactionCreated(...)

5. EventBridge emits to EventEmitter
   └─> this.emit(RealtimeEventType.TRANSACTION_CREATED, update)

6. SocketManager listener picks up event
   └─> this.eventEmitter.on(TRANSACTION_CREATED, ...)

7. SocketManager broadcasts to clients
   └─> this.io.to(`user:${userId}`).emit("transaction:created", update)

8. Connected clients receive real-time update
   └─> RealtimeClient.on("transaction:created", (update) => {
       display update to user
       })

9. User sees live transaction status in UI

SCOPE OF EVENTS:
═══════════════════════════════════════════════════════════════════════════

┌─────────────────────────────────────────────────────────────┐
│ Socket.io Room Organization                                 │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│ user:user-123            (All events for user 123)         │
│ transaction:tx-456       (Events for transaction 456)       │
│ deployment:deploy-789    (Events for deployment 789)        │
│ bot:bot-999              (Events for bot 999)               │
│ bot:all                  (All bot-related events)           │
│                                                              │
└─────────────────────────────────────────────────────────────┘

EVENT TYPES:
═══════════════════════════════════════════════════════════════════════════

transaction:created      → Emitted when transaction is initiated
transaction:update       → Generic transaction status update
transaction:confirmed    → Emitted when transaction is confirmed on chain
transaction:failed       → Emitted when transaction fails

swap:status             → Emitted for swap operation status changes

bot:alert               → Bot alert (info/warning/error/critical)
bot:status-change       → Bot status changed (active/inactive/error/paused)
bot:error               → Bot error occurred

deployment:status       → Deployment progress update

PAYLOAD EXAMPLES:
═══════════════════════════════════════════════════════════════════════════

{
  "transactionId": "tx-123456",
  "transactionHash": "abc123...",
  "status": "confirmed",
  "timestamp": "2024-02-24T10:30:00Z",
  "ledger": 12345,
  "feeUsed": 1200,
  "userId": "user-123"
}

{
  "alertId": "alert-123",
  "severity": "warning",
  "message": "High volatility detected",
  "botId": "bot-789",
  "timestamp": "2024-02-24T10:30:00Z",
  "userId": "user-123",
  "details": { "volatilityIndex": 75 }
}

{
  "deploymentId": "deploy-456",
  "status": "in-progress",
  "progress": 50,
  "message": "Compiling WASM...",
  "timestamp": "2024-02-24T10:30:00Z",
  "userId": "user-123"
}
*/

export default "Architecture Reference - See comments above";
