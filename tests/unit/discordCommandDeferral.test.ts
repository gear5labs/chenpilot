import { describe, it, expect, jest, beforeEach } from '@jest/globals';
import { DiscordAdapter } from '../../packages/bot/src/discord/DiscordAdapter';
import { unsupportedTypeFixture } from '../../packages/bot/src/discord/fixtures/commandInteractionFixtures';

function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface MockInteractionOptions {
  commandName?: string;
  userId?: string;
  guildId?: string | null;
  deferred?: boolean;
  replied?: boolean;
  optionsData?: unknown[];
  hasDeferReply?: boolean;
  hasEditReply?: boolean;
  hasFollowUp?: boolean;
}

function createMockCommandInteraction(opts: MockInteractionOptions = {}) {
  const {
    commandName = 'ping',
    userId = 'user-123',
    guildId = null,
    deferred = false,
    replied = false,
    optionsData = [],
    hasDeferReply = true,
    hasEditReply = true,
    hasFollowUp = true,
  } = opts;

  let isDeferred = deferred;
  let isReplied = replied;

  const replyFn = jest.fn(async (_opts: unknown) => {
    isReplied = true;
    return undefined;
  });

  const deferReplyFn = hasDeferReply
    ? jest.fn(async () => {
        isDeferred = true;
        return undefined;
      })
    : undefined;

  const editReplyFn = hasEditReply
    ? jest.fn(async (_opts: unknown) => undefined)
    : undefined;

  const followUpFn = hasFollowUp
    ? jest.fn(async (_opts: unknown) => undefined)
    : undefined;

  const interaction = {
    isButton: () => false,
    isModalSubmit: () => false,
    isStringSelectMenu: () => false,
    isChatInputCommand: () => true,
    commandName,
    user: { id: userId },
    guildId,
    options: {
      data: optionsData,
    },
    get deferred() {
      return isDeferred;
    },
    get replied() {
      return isReplied;
    },
    reply: replyFn,
    ...(deferReplyFn ? { deferReply: deferReplyFn } : {}),
    ...(editReplyFn ? { editReply: editReplyFn } : {}),
    ...(followUpFn ? { followUp: followUpFn } : {}),
  };

  return {
    interaction,
    replyFn,
    deferReplyFn,
    editReplyFn,
    followUpFn,
  };
}

describe('DiscordAdapter Slash Command Deferral & Single-Acknowledgment Lifecycle', () => {
  let adapter: DiscordAdapter;

  beforeEach(() => {
    adapter = new DiscordAdapter({
      token: 'test-token',
      backendUrl: 'http://localhost:8080',
      adminRoleIds: ['admin-role-1'],
    });
  });

  it('defers eligible interaction before backend execution and completes via editReply (fast path)', async () => {
    const backendClient = adapter.getBackendClient();
    const executeCommandSpy = jest
      .spyOn(backendClient, 'executeCommand')
      .mockImplementation(async () => {
        // Verify that deferReply has ALREADY been invoked when backend work starts
        expect(deferReplyFn).toHaveBeenCalledTimes(1);
        return { status: 'healthy', timestamp: 123456 };
      });

    const { interaction, deferReplyFn, editReplyFn, replyFn } =
      createMockCommandInteraction({ commandName: 'ping' });

    adapter.getClient().emit('interactionCreate', interaction as never);
    await flushMicrotasks();

    expect(executeCommandSpy).toHaveBeenCalledTimes(1);
    expect(deferReplyFn).toHaveBeenCalledTimes(1);
    expect(editReplyFn).toHaveBeenCalledTimes(1);
    expect(editReplyFn).toHaveBeenCalledWith({
      content: JSON.stringify({ status: 'healthy', timestamp: 123456 }),
    });

    // Interaction was acknowledged exactly once (deferred), not replied
    expect(replyFn).not.toHaveBeenCalled();
  });

  it('defers before slow backend execution and acknowledges interaction exactly once', async () => {
    const backendClient = adapter.getBackendClient();
    let deferredAt = 0;
    let backendCompletedAt = 0;

    const executeCommandSpy = jest
      .spyOn(backendClient, 'executeCommand')
      .mockImplementation(async () => {
        expect(deferReplyFn).toHaveBeenCalledTimes(1);
        // Simulate a slow backend command exceeding nominal response window
        await new Promise((resolve) => setTimeout(resolve, 30));
        backendCompletedAt = Date.now();
        return { balance: '100.50', asset: 'XLM' };
      });

    const { interaction, deferReplyFn, editReplyFn, replyFn } =
      createMockCommandInteraction({ commandName: 'balance' });

    if (deferReplyFn) {
      deferReplyFn.mockImplementation(async () => {
        deferredAt = Date.now();
        return undefined;
      });
    }

    adapter.getClient().emit('interactionCreate', interaction as never);

    // Wait for the slow backend path to finish
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flushMicrotasks();

    expect(executeCommandSpy).toHaveBeenCalledTimes(1);
    expect(deferReplyFn).toHaveBeenCalledTimes(1);
    expect(backendCompletedAt).toBeGreaterThanOrEqual(deferredAt);

    expect(editReplyFn).toHaveBeenCalledTimes(1);
    expect(editReplyFn).toHaveBeenCalledWith({
      content: JSON.stringify({ balance: '100.50', asset: 'XLM' }),
    });
    expect(replyFn).not.toHaveBeenCalled();
  });

  it('handles backend execution failure by sending error notice via editReply after deferral', async () => {
    const backendClient = adapter.getBackendClient();
    jest
      .spyOn(backendClient, 'executeCommand')
      .mockRejectedValue(new Error('Backend connection timeout'));

    const { interaction, deferReplyFn, editReplyFn, replyFn } =
      createMockCommandInteraction({ commandName: 'swap' });

    adapter.getClient().emit('interactionCreate', interaction as never);
    await flushMicrotasks();

    expect(deferReplyFn).toHaveBeenCalledTimes(1);
    expect(editReplyFn).toHaveBeenCalledTimes(1);
    expect(editReplyFn).toHaveBeenCalledWith({
      content: 'Failed to execute command',
    });
    // Never calls reply on an already deferred interaction
    expect(replyFn).not.toHaveBeenCalled();
  });

  it('boundary: does not re-defer an interaction that was already deferred', async () => {
    const backendClient = adapter.getBackendClient();
    jest
      .spyOn(backendClient, 'executeCommand')
      .mockResolvedValue({ success: true } as never);

    const { interaction, deferReplyFn, editReplyFn, replyFn } =
      createMockCommandInteraction({
        commandName: 'status',
        deferred: true,
      });

    adapter.getClient().emit('interactionCreate', interaction as never);
    await flushMicrotasks();

    // deferReply must NOT be called again (avoids Discord duplicate ACK error)
    expect(deferReplyFn).not.toHaveBeenCalled();
    expect(editReplyFn).toHaveBeenCalledTimes(1);
    expect(editReplyFn).toHaveBeenCalledWith({
      content: JSON.stringify({ success: true }),
    });
    expect(replyFn).not.toHaveBeenCalled();
  });

  it('boundary: uses followUp when an interaction was already replied', async () => {
    const backendClient = adapter.getBackendClient();
    jest
      .spyOn(backendClient, 'executeCommand')
      .mockResolvedValue({ step: 'continue' } as never);

    const { interaction, deferReplyFn, editReplyFn, followUpFn, replyFn } =
      createMockCommandInteraction({
        commandName: 'next',
        replied: true,
      });

    adapter.getClient().emit('interactionCreate', interaction as never);
    await flushMicrotasks();

    expect(deferReplyFn).not.toHaveBeenCalled();
    expect(editReplyFn).not.toHaveBeenCalled();
    expect(followUpFn).toHaveBeenCalledTimes(1);
    expect(followUpFn).toHaveBeenCalledWith({
      content: JSON.stringify({ step: 'continue' }),
    });
    expect(replyFn).not.toHaveBeenCalled();
  });

  it('boundary: falls back to followUp when editReply is not implemented on deferred interaction', async () => {
    const backendClient = adapter.getBackendClient();
    jest
      .spyOn(backendClient, 'executeCommand')
      .mockResolvedValue({ result: 'fallback' } as never);

    const { interaction, deferReplyFn, followUpFn, replyFn } =
      createMockCommandInteraction({
        commandName: 'fallback_cmd',
        hasEditReply: false,
      });

    adapter.getClient().emit('interactionCreate', interaction as never);
    await flushMicrotasks();

    expect(deferReplyFn).toHaveBeenCalledTimes(1);
    expect(followUpFn).toHaveBeenCalledTimes(1);
    expect(followUpFn).toHaveBeenCalledWith({
      content: JSON.stringify({ result: 'fallback' }),
      ephemeral: false,
    });
    expect(replyFn).not.toHaveBeenCalled();
  });

  it('failure case: role gate denial rejects immediately via ephemeral reply without deferral or backend work', async () => {
    const backendClient = adapter.getBackendClient();
    const executeCommandSpy = jest.spyOn(backendClient, 'executeCommand');

    // RoleGate checkGate returns false when user lacks required role
    const roleGate = adapter.getRoleGate();
    jest.spyOn(roleGate, 'checkGate').mockResolvedValue(false);

    const { interaction, deferReplyFn, editReplyFn, replyFn } =
      createMockCommandInteraction({
        commandName: 'admin_only',
        guildId: 'guild-1',
        userId: 'unauthorized-user',
      });

    adapter.getClient().emit('interactionCreate', interaction as never);
    await flushMicrotasks();

    expect(deferReplyFn).not.toHaveBeenCalled();
    expect(executeCommandSpy).not.toHaveBeenCalled();
    expect(editReplyFn).not.toHaveBeenCalled();

    // Acknowledged exactly once with ephemeral permission rejection
    expect(replyFn).toHaveBeenCalledTimes(1);
    expect(replyFn).toHaveBeenCalledWith({
      content: 'You do not have permission to use this command',
      ephemeral: true,
    });
  });

  it('failure case: option validation error replies immediately without deferral or backend work', async () => {
    const backendClient = adapter.getBackendClient();
    const executeCommandSpy = jest.spyOn(backendClient, 'executeCommand');

    const { interaction, deferReplyFn, editReplyFn, replyFn } =
      createMockCommandInteraction({
        commandName: 'custom',
        optionsData: unsupportedTypeFixture.options,
      });

    adapter.getClient().emit('interactionCreate', interaction as never);
    await flushMicrotasks();

    expect(deferReplyFn).not.toHaveBeenCalled();
    expect(executeCommandSpy).not.toHaveBeenCalled();
    expect(editReplyFn).not.toHaveBeenCalled();

    // Acknowledged exactly once with ephemeral error notice
    expect(replyFn).toHaveBeenCalledTimes(1);
    const replyArg = replyFn.mock.calls[0][0] as { content: string; ephemeral: boolean };
    expect(replyArg.ephemeral).toBe(true);
    expect(replyArg.content).toContain('Invalid command options');
  });

  it('boundary: falls back to initial reply if interaction does not support deferReply', async () => {
    const backendClient = adapter.getBackendClient();
    jest
      .spyOn(backendClient, 'executeCommand')
      .mockResolvedValue({ noDefer: true } as never);

    const { interaction, replyFn } = createMockCommandInteraction({
      commandName: 'legacy_mock',
      hasDeferReply: false,
      hasEditReply: false,
    });

    adapter.getClient().emit('interactionCreate', interaction as never);
    await flushMicrotasks();

    expect(replyFn).toHaveBeenCalledTimes(1);
    expect(replyFn).toHaveBeenCalledWith({
      content: JSON.stringify({ noDefer: true }),
      ephemeral: false,
    });
  });
});
