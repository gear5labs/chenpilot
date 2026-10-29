import { describe, expect, it, jest } from '@jest/globals';
import { RoleGate } from './RoleGate';

function createGate(fetchRoles: (userId: string, guildId: string) => Promise<string[]>) {
  const roleGate = new RoleGate({ fetchRoles });
  roleGate.registerGate({ command: 'moderate', requiredRoles: ['moderator'] });
  return roleGate;
}

describe('RoleGate', () => {
  it('fetches authoritative membership and denies a revoked role after invalidation', async () => {
    let currentRoles: string[] = [];
    const fetchRoles = jest.fn(async () => currentRoles);
    const roleGate = createGate(fetchRoles);

    expect(await roleGate.checkGate('moderate', 'user-1', 'guild-1')).toBe(false);
    currentRoles = ['moderator'];
    roleGate.invalidateCache('user-1', 'guild-1');
    expect(await roleGate.checkGate('moderate', 'user-1', 'guild-1')).toBe(true);
    currentRoles = [];
    roleGate.invalidateCache('user-1', 'guild-1');

    expect(await roleGate.checkGate('moderate', 'user-1', 'guild-1')).toBe(false);
    expect(fetchRoles).toHaveBeenCalledTimes(3);
  });

  it('refreshes membership when the cache TTL expires', async () => {
    let now = 0;
    let fetchCount = 0;
    const roleGate = new RoleGate({
      cacheTtlMs: 100,
      now: () => now,
      fetchRoles: async () => (++fetchCount === 1 ? ['moderator'] : []),
    });
    roleGate.registerGate({ command: 'moderate', requiredRoles: ['moderator'] });

    expect(await roleGate.checkGate('moderate', 'user-1', 'guild-1')).toBe(true);
    now = 100;
    expect(await roleGate.checkGate('moderate', 'user-1', 'guild-1')).toBe(false);
    expect(fetchCount).toBe(2);
  });

  it('fails closed on a Discord lookup error and does not cache the failure', async () => {
    let fetchCount = 0;
    const roleGate = createGate(async () => {
      fetchCount += 1;
      throw new Error('Discord unavailable');
    });

    expect(await roleGate.checkGate('moderate', 'user-1', 'guild-1')).toBe(false);
    expect(await roleGate.checkGate('moderate', 'user-1', 'guild-1')).toBe(false);
    expect(fetchCount).toBe(2);
  });

  it('denies a gated command without a guild and does not query Discord', async () => {
    const fetchRoles = jest.fn(async () => ['moderator']);
    const roleGate = createGate(fetchRoles);

    expect(await roleGate.checkGate('moderate', 'user-1', '')).toBe(false);
    expect(fetchRoles).not.toHaveBeenCalled();
  });

  it('fails closed when the Discord lookup times out', async () => {
    jest.useFakeTimers();
    try {
      const roleGate = new RoleGate({
        fetchTimeoutMs: 10,
        fetchRoles: () => new Promise<string[]>(() => {}),
      });
      roleGate.registerGate({ command: 'moderate', requiredRoles: ['moderator'] });

      const check = roleGate.checkGate('moderate', 'user-1', 'guild-1');
      await jest.advanceTimersByTimeAsync(10);
      expect(await check).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('invalidates membership on guild and role-gate configuration changes', async () => {
    let fetchCount = 0;
    const roleGate = new RoleGate({
      fetchRoles: async () => {
        fetchCount += 1;
        return ['moderator'];
      },
    });
    roleGate.registerGate({ command: 'moderate', requiredRoles: ['moderator'] });
    await roleGate.checkGate('moderate', 'user-1', 'guild-1');
    roleGate.invalidateGuildCache('guild-1');
    await roleGate.checkGate('moderate', 'user-1', 'guild-1');
    roleGate.setAdminRoleIds(['admin']);
    await roleGate.checkGate('moderate', 'user-1', 'guild-1');

    expect(fetchCount).toBe(3);
  });
});