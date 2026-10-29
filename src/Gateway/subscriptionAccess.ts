/**
 * Ownership / grant resolution for realtime Socket.IO room subscriptions.
 *
 * Subscriptions must be authorized before a client is admitted to a resource
 * room. Lookups are injected so tests can run without a database.
 */

export type SubscriptionKind = "transaction" | "bot";

export interface ResourceSubscription {
  kind: SubscriptionKind;
  resourceId: string;
}

export interface AccessDecision {
  allowed: boolean;
  /** Uniform denial reason; never reveals whether the resource exists. */
  reason?: string;
}

export const DENIED_REASON = "Not authorized for this subscription.";

/** Room name a subscription maps to in Socket.IO. */
export function roomName(sub: ResourceSubscription): string {
  return `${sub.kind}:${sub.resourceId}`;
}

export interface TransactionOwnerLookup {
  /** Returns the owning userId, or null when the transaction is unknown. */
  (transactionId: string): Promise<string | null>;
}

export interface BotOwnerLookup {
  /** Returns the owning userId, or null when the bot is unknown. */
  (botId: string): Promise<string | null>;
}

export interface BotAccessGrantLookup {
  /** Returns true when an explicit, non-revoked shared-access grant exists. */
  (userId: string, botId: string): Promise<boolean>;
}

export interface SubscriptionAccessDeps {
  findTransactionOwner: TransactionOwnerLookup;
  findBotOwner: BotOwnerLookup;
  hasBotAccessGrant: BotAccessGrantLookup;
}

const defaultFindTransactionOwner: TransactionOwnerLookup = async (
  transactionId
) => {
  const { AppDataSource } = await import("../config/Datasource");
  if (!AppDataSource.isInitialized) return null;
  const { TransactionLifecycle } = await import(
    "../transactions/TransactionLifecycle.entity"
  );
  const record = await AppDataSource.getRepository(TransactionLifecycle).findOne(
    { where: { id: transactionId } }
  );
  return record?.userId ?? null;
};

const defaultFindBotOwner: BotOwnerLookup = async (botId) => {
  const { AppDataSource } = await import("../config/Datasource");
  if (!AppDataSource.isInitialized) return null;
  const { BotSession } = await import("../Bot/botSession.entity");
  const record = await AppDataSource.getRepository(BotSession).findOne({
    where: { id: botId },
  });
  return record?.userId ?? null;
};

const defaultHasBotAccessGrant: BotAccessGrantLookup = async () => false;

export class SubscriptionAccess {
  private readonly findTransactionOwner: TransactionOwnerLookup;
  private readonly findBotOwner: BotOwnerLookup;
  private readonly hasBotAccessGrant: BotAccessGrantLookup;

  constructor(deps: Partial<SubscriptionAccessDeps> = {}) {
    this.findTransactionOwner =
      deps.findTransactionOwner ?? defaultFindTransactionOwner;
    this.findBotOwner = deps.findBotOwner ?? defaultFindBotOwner;
    this.hasBotAccessGrant =
      deps.hasBotAccessGrant ?? defaultHasBotAccessGrant;
  }

  /**
   * Transaction subscriptions require ownership of the transaction.
   * Missing and unauthorized transactions are indistinguishable to the caller.
   */
  async authorizeTransaction(
    userId: string,
    transactionId: string
  ): Promise<AccessDecision> {
    const owner = await this.findTransactionOwner(transactionId);
    if (!owner || owner !== userId) {
      return { allowed: false, reason: DENIED_REASON };
    }
    return { allowed: true };
  }

  /**
   * Bot-alert subscriptions require bot ownership or an explicit shared-access
   * grant. Missing, foreign, and revoked bots are indistinguishable to the caller.
   */
  async authorizeBot(userId: string, botId: string): Promise<AccessDecision> {
    const owner = await this.findBotOwner(botId);
    if (owner && owner === userId) {
      return { allowed: true };
    }
    const granted = await this.hasBotAccessGrant(userId, botId);
    if (granted) {
      return { allowed: true };
    }
    return { allowed: false, reason: DENIED_REASON };
  }

  private readonly bySocket = new Map<string, Set<string>>();
  private readonly byResource = new Map<string, Set<string>>();
  private readonly socketUser = new Map<string, string>();

  private static key(sub: ResourceSubscription): string {
    return `${sub.kind}:${sub.resourceId}`;
  }

  private static parseKey(key: string): ResourceSubscription {
    const idx = key.indexOf(":");
    return {
      kind: key.slice(0, idx) as SubscriptionKind,
      resourceId: key.slice(idx + 1),
    };
  }

  /** Record that `socketId` (owned by `userId`) watches `sub`. */
  track(socketId: string, userId: string, sub: ResourceSubscription): void {
    const key = SubscriptionAccess.key(sub);
    if (!this.bySocket.has(socketId)) this.bySocket.set(socketId, new Set());
    this.bySocket.get(socketId)!.add(key);
    this.socketUser.set(socketId, userId);
    const rk = `${userId}|${key}`;
    if (!this.byResource.has(rk)) this.byResource.set(rk, new Set());
    this.byResource.get(rk)!.add(socketId);
  }

  /** Stop tracking `sub` for `socketId`. */
  untrack(socketId: string, sub: ResourceSubscription): void {
    const key = SubscriptionAccess.key(sub);
    this.bySocket.get(socketId)?.delete(key);
    const userId = this.socketUser.get(socketId);
    if (userId !== undefined) {
      this.byResource.get(`${userId}|${key}`)?.delete(socketId);
      if (this.byResource.get(`${userId}|${key}`)?.size === 0) {
        this.byResource.delete(`${userId}|${key}`);
      }
    }
  }

  /** All subscriptions currently held by `socketId`. */
  listSubscriptions(socketId: string): ResourceSubscription[] {
    return [...(this.bySocket.get(socketId) ?? [])].map(
      SubscriptionAccess.parseKey
    );
  }

  /**
   * Sockets (for `userId`) currently watching `sub`. Used to revoke room
   * membership when ownership or grants change.
   */
  findForResource(userId: string, sub: ResourceSubscription): string[] {
    return [...(this.byResource.get(`${userId}|${SubscriptionAccess.key(sub)}`) ?? [])];
  }

  /** Drop every subscription held by `socketId` (disconnect cleanup). */
  clearSocket(socketId: string): ResourceSubscription[] {
    const subs = this.listSubscriptions(socketId);
    const userId = this.socketUser.get(socketId);
    for (const sub of subs) {
      const rk = `${userId}|${SubscriptionAccess.key(sub)}`;
      this.byResource.get(rk)?.delete(socketId);
      if (this.byResource.get(rk)?.size === 0) this.byResource.delete(rk);
    }
    this.bySocket.delete(socketId);
    this.socketUser.delete(socketId);
    return subs;
  }
}
