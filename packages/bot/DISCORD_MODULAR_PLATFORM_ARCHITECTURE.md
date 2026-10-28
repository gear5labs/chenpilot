# Discord Modular Command Platform Architecture

## Overview

Break the Discord adapter into a modular command platform with typed interaction handling, safer thread/channel operations, clearer role gating, and better integration boundaries with backend services.

## Architecture Goals

1. **Modular Design**: Separate concerns into distinct modules
2. **Typed Interactions**: Strongly typed interaction handlers
3. **Thread/Channel Safety**: Safe operations on threads and channels
4. **Role Gating**: Clear and flexible role-based access control
5. **Integration Boundaries**: Better separation from backend services
6. **Scam Detection**: Integrated scam detection for asset operations
7. **Audit Logging**: Comprehensive audit trail for operations

## Module Structure

```
packages/bot/src/discord/
├── index.ts                     # Main Discord adapter entry point
├── modules/                    # Modular components
│   ├── command/               # Command handling
│   │   ├── CommandHandler.ts  # Base command handler
│   │   ├── SlashCommandHandler.ts # Slash command specific
│   │   ├── LegacyCommandHandler.ts # Legacy ! command handler
│   │   └── registry.ts        # Command registry
│   ├── interaction/           # Interaction handling
│   │   ├── ButtonHandler.ts   # Button interaction handler
│   │   ├── ModalHandler.ts    # Modal interaction handler
│   │   ├── SelectHandler.ts   # Select menu handler
│   │   └── types.ts          # Interaction types
│   ├── thread/                # Thread operations
│   │   ├── ThreadManager.ts   # Thread lifecycle management
│   │   ├── ThreadSafety.ts    # Thread safety checks
│   │   └── ThreadLogger.ts   # Thread operation logging
│   ├── channel/               # Channel operations
│   │   ├── ChannelManager.ts # Channel operations
│   │   ├── ChannelSafety.ts  # Channel safety checks
│   │   └── ChannelPermissions.ts # Permission checks
│   ├── role/                  # Role management
│   │   ├── RoleGate.ts       # Role gating system
│   │   ├── RoleManager.ts    # Role management
│   │   └── RoleCache.ts      # Role caching
│   ├── scam/                  # Scam detection
│   │   ├── ScamDetector.ts   # Scam detection logic
│   │   ├── ScamDatabase.ts   # Scam database
│   │   └── ScamActions.ts    # Scam response actions
│   └── audit/                 # Audit logging
│       ├── AuditLogger.ts    # Audit logger
│       ├── AuditStore.ts     # Audit storage
│       └── AuditTypes.ts     # Audit event types
├── adapters/                  # Platform adapters
│   ├── DiscordAdapter.ts     # Main adapter
│   ├── CommandAdapter.ts     # Command adapter
│   └── InteractionAdapter.ts # Interaction adapter
└── types.ts                   # Discord-specific types
```

## Core Type Definitions

### Interaction Types

```typescript
interface DiscordInteraction {
  type: 'command' | 'button' | 'modal' | 'select';
  id: string;
  userId: string;
  guildId?: string;
  channelId: string;
  data: any;
  metadata: {
    timestamp: number;
    threadId?: string;
    parentChannelId?: string;
  };
}

interface InteractionHandler<TInput, TOutput> {
  type: string;
  handler: (interaction: DiscordInteraction, input: TInput) => Promise<InteractionResult<TOutput>>;
  permissions?: Permission[];
  rateLimit?: RateLimitConfig;
  scamCheck?: boolean;
}

interface InteractionResult<TOutput> {
  success: boolean;
  data?: TOutput;
  error?: InteractionError;
  response?: DiscordResponse;
}
```

### Thread Safety Types

```typescript
interface ThreadOperation {
  type: 'create' | 'archive' | 'delete' | 'send' | 'pin';
  threadId: string;
  channelId: string;
  userId: string;
  permissions: string[];
  metadata: Record<string, any>;
}

interface ThreadSafetyCheck {
  allowed: boolean;
  reason?: string;
  requiredPermissions?: string[];
  warnings?: string[];
}
```

### Role Gating Types

```typescript
interface RoleGate {
  command: string;
  requiredRoles: string[];
  requireAll?: boolean;
  allowAdminOverride?: boolean;
  customCheck?: (userId: string, roles: string[]) => Promise<boolean>;
}

interface RoleCacheEntry {
  userId: string;
  roles: string[];
  guildId: string;
  cachedAt: number;
  ttl: number;
}
```

## Command Module

### Command Handler

```typescript
class CommandHandler {
  private slashHandler: SlashCommandHandler;
  private legacyHandler: LegacyCommandHandler;
  private registry: CommandRegistry;

  async handleCommand(interaction: DiscordInteraction): Promise<void>;
  async registerCommand(command: CommandDefinition): Promise<void>;
  async unregisterCommand(commandId: string): Promise<void>;
}
```

### Slash Command Handler & Option DTO Mapping

The adapter decodes and validates incoming `interaction.options.data` into a versioned, platform-neutral `DiscordCommandDto` before dispatching to backend commands. This decouples backend handlers from discord.js object shapes and nested option trees.

The deployed slash-command definitions in `src/slashCommands.ts` are checked against the command cases and option getters in `src/adapters/discord.ts`. Run `pnpm run discord:commands:check` before deployment; it fails with separate missing, stale, and incompatible command reports. Focused contract tests are available with `pnpm run discord:commands:test`, and both checks run in the deployment workflow.

```typescript
class SlashCommandHandler {
  async handleSlashCommand(interaction: ChatInputCommandInteraction): Promise<void>;
  private validatePermissions(interaction: ChatInputCommandInteraction): Promise<boolean>;
  private executeCommand(command: string, options: DiscordCommandDto): Promise<CommandResult>;
}
```

#### Versioned Adapter DTO Contract (`v1.0.0`)

```typescript
export interface DiscordCommandDto {
  readonly version: '1.0.0';
  readonly commandName: string;
  readonly subcommandGroup?: string;
  readonly subcommand?: string;
  readonly options: Record<string, unknown>;
  readonly details: Record<string, ValidatedOptionDto>;
}
```

#### Supported Option Types

| Discord Option Type | Normalized Type | Validation & Resolved Value |
|---------------------|-----------------|-----------------------------|
| `STRING` (3)        | `string`        | `typeof value === 'string'` |
| `INTEGER` (4)       | `integer`       | `typeof value === 'number' && Number.isInteger(value)` |
| `NUMBER` (10)       | `number`        | `typeof value === 'number' && Number.isFinite(value)` |
| `BOOLEAN` (5)       | `boolean`       | `typeof value === 'boolean'` |
| `USER` (6)          | `user`          | User ID string; resolved `{ id, username, bot }` |
| `CHANNEL` (7)       | `channel`       | Channel ID string; resolved `{ id, name, type }` |
| `ROLE` (8)          | `role`          | Role ID string; resolved `{ id, name }` |
| `MENTIONABLE` (9)   | `mentionable`   | Mentionable entity ID string |
| `ATTACHMENT` (11)   | `attachment`    | Resolved `{ id, name, url, contentType, size }` |
| `SUB_COMMAND` (1)   | Hierarchy       | Flattened into `subcommand` + leaf options |
| `SUB_COMMAND_GROUP` (2) | Hierarchy   | Flattened into `subcommandGroup` + `subcommand` + leaf options |

- **Optional Values**: Missing or explicitly `null`/`undefined` optional options map to `null` with `isOptional: true`.
- **Validation Errors**: Unsupported option types throw `CommandOptionValidationError` with code `UNSUPPORTED_OPTION_TYPE`; invalid values throw `INVALID_OPTION_VALUE`; malformed subcommand groups throw `MALFORMED_SUBCOMMAND_STRUCTURE`. The adapter intercepts these errors and responds with an ephemeral user notice.

### Interaction Deferral & Response Window Lifecycle

Discord enforces a 3-second initial response deadline for slash command interactions. Backend command execution can exceed this window due to network round-trips, transaction simulations, or service coordination, causing Discord to reject responses with `10062 Unknown interaction`.

To ensure reliability across fast and slow execution paths:
1. **Pre-execution Deferral**: The adapter defers eligible interactions (`interaction.deferReply()`) immediately after role checks and option mapping, but before dispatching backend requests to `backendClient.executeCommand`.
2. **Follow-Up Response Completion**: Once backend execution completes (or fails), completion responses are sent via follow-up responses (`interaction.editReply` or `interaction.followUp`) rather than initial replies.
3. **Exactly-Once Acknowledgment Guarantee**:
   - Eligible unacknowledged interactions (`!interaction.deferred && !interaction.replied`) are deferred exactly once.
   - Already acknowledged interactions preserve their state and skip duplicate deferrals to prevent Discord `40060 Interaction has already been acknowledged` errors.
   - Early validation failures (role gating, option validation) reject immediately with ephemeral replies without deferring or invoking the backend.
   - Interactions lacking deferral capability safely fall back to direct replies.

### Legacy Command Handler

```typescript
class LegacyCommandHandler {
  async handleLegacyCommand(message: Message): Promise<void>;
  private parseCommand(content: string): { command: string; args: string[] };
  private checkScamDetection(message: Message): Promise<ScamCheckResult>;
}
```

## Interaction Module

### Button Handler

```typescript
class ButtonHandler {
  private handlers: Map<string, ButtonCallback>;

  registerButton(customId: string, callback: ButtonCallback): void;
  async handleButton(interaction: ButtonInteraction): Promise<void>;
  private validateButtonInteraction(interaction: ButtonInteraction): Promise<boolean>;
}
```

### Modal Handler

```typescript
class ModalHandler {
  private handlers: Map<string, ModalCallback>;

  registerModal(customId: string, callback: ModalCallback): void;
  async handleModal(interaction: ModalSubmitInteraction): Promise<void>;
  private validateModalData(data: any): boolean;
}
```

### Select Handler

```typescript
class SelectHandler {
  private handlers: Map<string, SelectCallback>;

  registerSelect(customId: string, callback: SelectCallback): void;
  async handleSelect(interaction: StringSelectMenuInteraction): Promise<void>;
}
```

## Thread Module

### Thread Manager

```typescript
class ThreadManager {
  private threadSafety: ThreadSafety;
  private threadLogger: ThreadLogger;

  async createThread(channelId: string, options: ThreadOptions): Promise<ThreadChannel>;
  async archiveThread(threadId: string): Promise<void>;
  async deleteThread(threadId: string): Promise<void>;
  async getThreadInfo(threadId: string): Promise<ThreadInfo>;
  async listThreads(channelId: string): Promise<ThreadChannel[]>;
}
```

### Thread Safety

```typescript
class ThreadSafety {
  async checkOperation(operation: ThreadOperation): Promise<ThreadSafetyCheck>;
  async validatePermissions(operation: ThreadOperation): Promise<boolean>;
  async checkRateLimit(userId: string): Promise<boolean>;
  async checkScamSafety(content: string): Promise<ScamCheckResult>;
}
```

### Thread Logger

```typescript
class ThreadLogger {
  async logOperation(operation: ThreadOperation): Promise<void>;
  async logThreadCreation(thread: ThreadChannel): Promise<void>;
  async logThreadDeletion(threadId: string): Promise<void>;
  async getThreadLogs(threadId: string): Promise<ThreadLog[]>;
}
```

## Channel Module

### Channel Manager

```typescript
class ChannelManager {
  private channelSafety: ChannelSafety;
  private channelPermissions: ChannelPermissions;

  async createChannel(options: ChannelOptions): Promise<TextChannel>;
  async deleteChannel(channelId: string): Promise<void>;
  async getChannelInfo(channelId: string): Promise<ChannelInfo>;
  async listChannels(guildId: string): Promise<TextChannel[]>;
}
```

### Channel Safety

```typescript
class ChannelSafety {
  async checkOperation(operation: ChannelOperation): Promise<ChannelSafetyCheck>;
  async validatePermissions(operation: ChannelOperation): Promise<boolean>;
  async checkRateLimit(userId: string, channelId: string): Promise<boolean>;
}
```

### Channel Permissions

```typescript
class ChannelPermissions {
  async checkPermission(userId: string, permission: string, channelId: string): Promise<boolean>;
  async getRequiredPermissions(operation: string): Promise<string[]>;
  async cachePermissions(userId: string, permissions: string[]): Promise<void>;
}
```

## Role Module

### Role Gate

```typescript
class RoleGate {
  private roleManager: RoleManager;
  private roleCache: RoleCache;
  private gates: Map<string, RoleGate>;

  registerGate(gate: RoleGate): void;
  async checkGate(command: string, userId: string, guildId: string): Promise<boolean>;
  async getRequiredRoles(command: string): Promise<string[]>;
  async checkCustomGate(command: string, userId: string, roles: string[]): Promise<boolean>;
}
```

### Role Manager

```typescript
class RoleManager {
  async getUserRoles(userId: string, guildId: string): Promise<string[]>;
  async hasRole(userId: string, roleId: string, guildId: string): Promise<boolean>;
  async hasAnyRole(userId: string, roleIds: string[], guildId: string): Promise<boolean>;
  async grantRole(userId: string, roleId: string, guildId: string): Promise<void>;
  async revokeRole(userId: string, roleId: string, guildId: string): Promise<void>;
}
```

### Role Cache

The Discord adapter resolves command-gate membership through the guild member API. Lookups time out after five seconds, successful role lists are cached for at most five minutes and 10,000 entries, and lookup failures deny gated commands without caching a result. Member updates invalidate that member; role and guild updates invalidate that guild. Gate/admin-role configuration changes clear the cache. Call `invalidateCache`, `invalidateGuildCache`, or `clearCache` after out-of-band changes.

```typescript
class RoleCache {
  private cache: Map<string, RoleCacheEntry>;

  get(userId: string, guildId: string): string[] | null;
  set(userId: string, guildId: string, roles: string[]): void;
  invalidate(userId: string, guildId: string): void;
  clear(): void;
  cleanup(): void; // Remove expired entries
}
```

### Moderation Audit Persistence

The Discord adapter uses a bounded in-memory audit sink by default. Set `moderationAuditFilePath` to append non-allow moderation records as JSONL across restarts, or provide `moderationAuditSink` to use another sink (it takes precedence over the file path). Audit sink errors are swallowed by the policy engine and do not change enforcement decisions. JSONL files are append-only and are not automatically pruned or rotated; operators must set access controls and apply their own archival and retention policy.

## Scam Detection Module

### Scam Detector

```typescript
class ScamDetector {
  private scamDatabase: ScamDatabase;
  private scamActions: ScamActions;

  async checkMessage(message: string): Promise<ScamCheckResult>;
  async checkAsset(asset: string): Promise<ScamCheckResult>;
  async checkUrl(url: string): Promise<ScamCheckResult>;
  async reportScam(report: ScamReport): Promise<void>;
}
```

### Scam Database

```typescript
class ScamDatabase {
  private knownScams: Map<string, ScamEntry>;

  addScam(entry: ScamEntry): void;
  removeScam(id: string): void;
  getScam(id: string): ScamEntry | null;
  search(pattern: string): ScamEntry[];
  isScam(asset: string): boolean;
}
```

### Scam Actions

```typescript
class ScamActions {
  async warnUser(userId: string, reason: string): Promise<void>;
  async blockUser(userId: string, reason: string): Promise<void>;
  async deleteMessage(messageId: string): Promise<void>;
  async reportToAdmins(scam: ScamReport): Promise<void>;
  async quarantineChannel(channelId: string): Promise<void>;
}
```

## Audit Module

### Audit Logger

```typescript
class AuditLogger {
  private auditStore: AuditStore;

  async logEvent(event: AuditEvent): Promise<void>;
  async logCommand(command: string, userId: string, result: CommandResult): Promise<void>;
  async logInteraction(interaction: DiscordInteraction, result: InteractionResult): Promise<void>;
  async logThreadOperation(operation: ThreadOperation): Promise<void>;
  async getAuditLogs(filters: AuditFilters): Promise<AuditEvent[]>;
}
```

### Audit Store

```typescript
class AuditStore {
  private events: AuditEvent[];

  add(event: AuditEvent): void;
  query(filters: AuditFilters): AuditEvent[];
  export(format: 'json' | 'csv'): string;
  clear(): void;
}
```

## Integration with Backend

### Backend Integration

```typescript
class DiscordBackendIntegration {
  private backendClient: SafeBackendClient;

  async executeCommand<TInput, TOutput>(
    command: string,
    input: TInput,
    context: DiscordContext
  ): Promise<TOutput>;

  async executeWorkflow<TState>(
    workflow: string,
    state: TState,
    step: string,
    context: DiscordContext
  ): Promise<WorkflowTransitionResult<TState>>;
}
```

## Migration Strategy

### Phase 1: Create Module Structure
- Create module directories
- Define core types
- Implement base classes

### Phase 2: Migrate Command Handling
- Migrate slash commands to new handler
- Migrate legacy commands to new handler
- Test command execution

### Phase 3: Implement Interaction Handlers
- Implement button handler
- Implement modal handler
- Implement select handler
- Test interactions

### Phase 4: Implement Thread/Channel Safety
- Implement thread manager
- Implement channel manager
- Add safety checks
- Test operations

### Phase 5: Implement Role Gating
- Implement role gate
- Implement role manager
- Add role caching
- Test permissions

### Phase 6: Implement Scam Detection
- Implement scam detector
- Implement scam database
- Add scam actions
- Test detection

### Phase 7: Implement Audit Logging
- Implement audit logger
- Implement audit store
- Add logging to all operations
- Test audit trail

### Phase 8: Update Main Adapter
- Update Discord adapter to use modules
- Remove old code
- Test integration

### Phase 9: Testing & Cleanup
- Comprehensive testing
- Remove deprecated code
- Update documentation

## Benefits

1. **Modularity**: Clear separation of concerns
2. **Reusability**: Modules can be reused across platforms
3. **Testability**: Easy to test modules in isolation
4. **Maintainability**: Clear structure and organization
5. **Safety**: Built-in safety checks for operations
6. **Audit**: Comprehensive audit trail
7. **Security**: Integrated scam detection and role gating
8. **Performance**: Role caching and rate limiting
