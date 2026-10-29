/**
 * Role Gate
 * Role-based access control system for Discord
 */

export interface RoleGate {
  command: string;
  requiredRoles: string[];
  requireAll?: boolean;
  allowAdminOverride?: boolean;
  customCheck?: (userId: string, roles: string[]) => Promise<boolean>;
}

export interface RoleCacheEntry {
  userId: string;
  roles: string[];
  guildId: string;
  cachedAt: number;
  ttl: number;
}

export interface RoleGateOptions {
  fetchRoles?: (userId: string, guildId: string) => Promise<string[]>;
  cacheTtlMs?: number;
  maxCacheEntries?: number;
  fetchTimeoutMs?: number;
  now?: () => number;
}

export class RoleGate {
  private gates: Map<string, RoleGate>;
  private roleCache: Map<string, RoleCacheEntry>;
  private adminRoleIds: Set<string>;
  private readonly fetchRoles: (userId: string, guildId: string) => Promise<string[]>;
  private readonly cacheTtlMs: number;
  private readonly maxCacheEntries: number;
  private readonly fetchTimeoutMs: number;
  private readonly now: () => number;

  constructor(options: RoleGateOptions = {}) {
    this.gates = new Map();
    this.roleCache = new Map();
    this.adminRoleIds = new Set();
    this.fetchRoles = options.fetchRoles ?? (async () => []);
    this.cacheTtlMs = Math.max(0, Math.min(options.cacheTtlMs ?? 300_000, 300_000));
    this.maxCacheEntries = Math.max(1, Math.min(options.maxCacheEntries ?? 10_000, 10_000));
    this.fetchTimeoutMs = Math.max(1, Math.min(options.fetchTimeoutMs ?? 5_000, 30_000));
    this.now = options.now ?? Date.now;
  }

  /**
   * Register a role gate for a command
   */
  registerGate(gate: RoleGate): void {
    this.gates.set(gate.command, gate);
    this.clearCache();
  }

  /**
   * Unregister a role gate
   */
  unregisterGate(command: string): void {
    this.gates.delete(command);
    this.clearCache();
  }

  /**
   * Check if user can execute command based on roles
   */
  async checkGate(command: string, userId: string, guildId: string): Promise<boolean> {
    const gate = this.gates.get(command);
    if (!gate) {
      // No gate means command is public
      return true;
    }

    const userRoles = await this.getUserRoles(userId, guildId);

    // Check admin override
    if (gate.allowAdminOverride && this.hasAdminRole(userRoles)) {
      return true;
    }

    // Check custom check if provided
    if (gate.customCheck) {
      return await gate.customCheck(userId, userRoles);
    }

    // Check required roles
    if (gate.requireAll) {
      return gate.requiredRoles.every(role => userRoles.includes(role));
    } else {
      return gate.requiredRoles.some(role => userRoles.includes(role));
    }
  }

  /**
   * Get required roles for a command
   */
  getRequiredRoles(command: string): string[] {
    const gate = this.gates.get(command);
    return gate?.requiredRoles || [];
  }

  /**
   * Check custom gate condition
   */
  async checkCustomGate(command: string, userId: string, roles: string[]): Promise<boolean> {
    const gate = this.gates.get(command);
    if (!gate || !gate.customCheck) {
      return true;
    }
    return await gate.customCheck(userId, roles);
  }

  /**
   * Get user roles with caching
   */
  private async getUserRoles(userId: string, guildId: string): Promise<string[]> {
    if (!guildId) return [];

    const cacheKey = `${userId}:${guildId}`;
    const cached = this.roleCache.get(cacheKey);

    if (cached && this.now() - cached.cachedAt < cached.ttl) {
      return cached.roles;
    }
    this.roleCache.delete(cacheKey);

    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const roles = await Promise.race([
        this.fetchRoles(userId, guildId),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Discord role lookup timed out')), this.fetchTimeoutMs);
        }),
      ]);

      const cachedAt = this.now();
      for (const [key, entry] of this.roleCache.entries()) {
        if (cachedAt - entry.cachedAt >= entry.ttl) this.roleCache.delete(key);
      }
      if (!this.roleCache.has(cacheKey) && this.roleCache.size >= this.maxCacheEntries) {
        const oldestKey = this.roleCache.keys().next().value;
        if (oldestKey !== undefined) this.roleCache.delete(oldestKey);
      }
      this.roleCache.set(cacheKey, {
        userId,
        roles: [...roles],
        guildId,
        cachedAt,
        ttl: this.cacheTtlMs,
      });
      return roles;
    } catch {
      return [];
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /**
   * Check if user has admin role
   */
  private hasAdminRole(roles: string[]): boolean {
    return roles.some(role => this.adminRoleIds.has(role));
  }

  /**
   * Set admin role IDs
   */
  setAdminRoleIds(roleIds: string[]): void {
    this.adminRoleIds = new Set(roleIds);
    this.clearCache();
  }

  /**
   * Add admin role ID
   */
  addAdminRoleId(roleId: string): void {
    this.adminRoleIds.add(roleId);
    this.clearCache();
  }

  /**
   * Invalidate cache for user
   */
  invalidateCache(userId: string, guildId: string): void {
    const cacheKey = `${userId}:${guildId}`;
    this.roleCache.delete(cacheKey);
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.roleCache.clear();
  }

  /** Invalidate membership cached for every user in one guild. */
  invalidateGuildCache(guildId: string): void {
    for (const [key, entry] of this.roleCache.entries()) {
      if (entry.guildId === guildId) this.roleCache.delete(key);
    }
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache(): void {
    const now = this.now();
    for (const [key, entry] of this.roleCache.entries()) {
      if (now - entry.cachedAt >= entry.ttl) {
        this.roleCache.delete(key);
      }
    }
  }

  /**
   * Get all registered gates
   */
  getAllGates(): RoleGate[] {
    return Array.from(this.gates.values());
  }
}
