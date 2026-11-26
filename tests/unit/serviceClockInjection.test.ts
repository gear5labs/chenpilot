/**
 * Clock-injection tests for expiry-sensitive services.
 *
 * Each service accepts a `Clock` ({ now(): Date }) via its constructor,
 * defaulting to `systemClock`. These tests pin the clock to a fixed instant
 * and assert that expiry comparisons, TTL calculations, and `:now` SQL
 * parameters all derive from the injected time rather than `new Date()`.
 */
import { describe, it, expect, beforeEach, jest } from "@jest/globals";

jest.mock("../../src/config/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../src/config/config", () => ({
  __esModule: true,
  default: {
    agent: { timeouts: { toolExecution: 30_000, agentExecution: 60_000 } },
    jwt: { secret: "test-secret-32-chars-long-enough!!" },
    db: {},
    redis: {},
  },
}));

// ── Shared TypeORM mock ──────────────────────────────────────────────────────

const makeQb = () => ({
  select: jest.fn().mockReturnThis(),
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  limit: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  update: jest.fn().mockReturnThis(),
  set: jest.fn().mockReturnThis(),
  getRawOne: jest.fn().mockResolvedValue(null),
  getOne: jest.fn().mockResolvedValue(null),
  getMany: jest.fn().mockResolvedValue([]),
  getCount: jest.fn().mockResolvedValue(0),
  execute: jest.fn().mockResolvedValue({ affected: 0 }),
});

const createdQbs: ReturnType<typeof makeQb>[] = [];

const mockRepo = {
  findOne: jest.fn(),
  find: jest.fn(),
  count: jest.fn(),
  create: jest.fn((e: unknown) => e),
  save: jest.fn(async (e: unknown) => e),
  createQueryBuilder: jest.fn(() => {
    const qb = makeQb();
    createdQbs.push(qb);
    return qb;
  }),
};

const txManager = {
  create: jest.fn((e: unknown) => e),
  save: jest.fn(async (e: any) => ({ ...e, id: e.id ?? "tx-1" })),
  findOne: jest.fn(),
  createQueryBuilder: jest.fn(() => makeQb()),
};

const mockedDataSource = {
  getRepository: jest.fn(() => mockRepo),
  transaction: jest.fn(async (fn: (m: unknown) => unknown) => fn(txManager)),
};

jest.mock("../../src/config/Datasource", () => ({
  __esModule: true,
  AppDataSource: mockedDataSource,
  default: mockedDataSource,
}));

jest.mock("../../src/AuditLog/auditLog.service", () => ({
  auditLogService: {
    log: jest.fn().mockResolvedValue(undefined),
    logEvent: jest.fn().mockResolvedValue({ id: "audit-1" }),
  },
}));

jest.mock("../../src/Agents/registry/ToolRegistry", () => ({
  toolRegistry: { executeTool: jest.fn(), getTool: jest.fn() },
}));

jest.mock("../../src/Agents/registry/PromptRolloutService", () => ({
  promptRolloutService: { activateWithPolicy: jest.fn() },
}));

jest.mock("../../src/Agents/planner/ParallelScheduler", () => ({
  parallelScheduler: { run: jest.fn() },
}));

jest.mock("../../src/Gateway/socketManager", () => ({
  RealtimeEventType: new Proxy({}, { get: () => "event" }),
  getSocketManager: jest.fn(() => ({
    getEventEmitter: () => ({ emitAgentExecutionUpdate: jest.fn() }),
  })),
}));

// ── Imports under test ───────────────────────────────────────────────────────

import { SequenceLeaseService } from "../../src/services/sequence/SequenceLease.service";
import { WalletChallengeService } from "../../src/Auth/walletChallenge.service";
import { AdminWorkflowService } from "../../src/Agents/admin/workflow.service";
import { DurableExecutor } from "../../src/Agents/planner/DurableExecutor";
import type { ExecutionPlan } from "../../src/Agents/planner/AgentPlanner";
import { WorkflowStatus } from "../../src/Agents/admin/workflow.types";
import { StepStatus } from "../../src/Agents/planner/DurableStep.entity";

const FIXED = new Date("2030-06-15T12:00:00.000Z");
const clock = { now: () => FIXED };

beforeEach(() => {
  jest.clearAllMocks();
  createdQbs.length = 0;
});

// ── SequenceLeaseService ─────────────────────────────────────────────────────

describe("SequenceLeaseService clock injection", () => {
  it("stamps reservedAt/expiresAt from the injected clock on acquire", async () => {
    const service = new SequenceLeaseService(clock);
    let created: any;
    txManager.create.mockImplementation((_entity: any, data: any) => {
      created = data;
      return data;
    });
    // First getRawOne → maxSeq, second → maxToken
    let calls = 0;
    txManager.createQueryBuilder.mockImplementation(() => {
      const qb = makeQb();
      qb.getRawOne.mockImplementation(() =>
        Promise.resolve(++calls === 1 ? { maxSeq: "10" } : { maxToken: "2" })
      );
      return qb;
    });

    const result = await service.acquireLease("GABC", "w1", 60_000);

    expect(created.reservedAt).toEqual(FIXED);
    expect(created.expiresAt).toEqual(new Date(FIXED.getTime() + 60_000));
    expect(result.sequenceNumber).toBe(11);
  });

  it("consumeLease treats expiry against the injected clock", async () => {
    const service = new SequenceLeaseService(clock);
    const expiredLease = {
      id: "lease-1",
      accountPublicKey: "GABC",
      leasedSequence: 5,
      fencingToken: 1,
      ownerId: "w1",
      status: "reserved",
      expiresAt: new Date(FIXED.getTime() - 1),
    };
    txManager.findOne.mockResolvedValue(expiredLease);

    await expect(service.consumeLease("lease-1", "w1", "hash")).rejects.toThrow(
      /expired/
    );
    expect(expiredLease.status).toBe("expired");
  });

  it("expireAndReclaim binds :now from the injected clock", async () => {
    const service = new SequenceLeaseService(clock);
    const lease = {
      id: "lease-1",
      accountPublicKey: "GABC",
      leasedSequence: 5,
      status: "reserved",
      expiresAt: new Date(FIXED.getTime() - 1000),
    };
    const qb = makeQb();
    qb.getMany.mockResolvedValue([lease]);
    mockRepo.createQueryBuilder.mockReturnValue(qb);

    const reclaimed = await service.expireAndReclaim();

    expect(reclaimed).toHaveLength(1);
    expect(lease.status).toBe("reclaimed");
    expect(qb.andWhere).toHaveBeenCalledWith("sl.expiresAt < :now", {
      now: FIXED,
    });
  });
});

// ── WalletChallengeService ───────────────────────────────────────────────────

describe("WalletChallengeService clock injection", () => {
  it("issueChallenge stamps issuedAt/expiresAt from the injected clock", async () => {
    const service = new WalletChallengeService(clock);
    let created: any;
    mockRepo.create.mockImplementation((e: any) => {
      created = e;
      return e;
    });

    await service.issueChallenge({
      userId: "user-1",
      walletAddress: "GABC",
      network: "stellar" as never,
      platform: "telegram",
      platformUserId: "tg-1",
    });

    expect(created.issuedAt).toEqual(FIXED);
    expect(created.expiresAt).toEqual(
      new Date(FIXED.getTime() + 60_000) // CHALLENGE_TTL_SECONDS = 60
    );
  });

  it("verifyChallenge rejects expiry against the injected clock", async () => {
    const service = new WalletChallengeService(clock);
    mockRepo.findOne.mockResolvedValue({
      id: "ch-1",
      userId: "user-1",
      walletAddress: "GABC",
      network: "stellar",
      platform: "telegram",
      platformUserId: "tg-1",
      nonce: "n",
      domain: "d",
      issuedAt: new Date(FIXED.getTime() - 120_000),
      expiresAt: new Date(FIXED.getTime() - 1),
      usedAt: null,
    });

    await expect(
      service.verifyAndConsume({ challengeId: "ch-1", signature: "sig" })
    ).rejects.toMatchObject({ code: "CHALLENGE_EXPIRED" });
  });
});

// ── AdminWorkflowService ─────────────────────────────────────────────────────

describe("AdminWorkflowService clock injection", () => {
  const policy = {
    id: "policy-1",
    actionType: "enable_tool",
    name: "Enable Tool",
    requiredApprovals: 1,
    approvalTimeoutMinutes: 60,
    autoExecuteOnApproval: false,
    enabled: true,
    riskLevel: "medium",
  };

  it("initiateWorkflow computes expiresAt from the injected clock", async () => {
    const service = new AdminWorkflowService(clock);
    mockRepo.findOne.mockResolvedValue(policy);
    let created: any;
    mockRepo.create.mockImplementation((e: any) => {
      created = e;
      return { ...e, id: "inst-1" };
    });

    await service.initiateWorkflow({
      actionType: "enable_tool" as never,
      initiatorId: "admin-1",
      payload: {},
    });

    expect(created.expiresAt).toEqual(new Date(FIXED.getTime() + 60 * 60_000));
  });

  it("approveInstance expiry check uses the injected clock", async () => {
    const service = new AdminWorkflowService(clock);
    mockRepo.findOne.mockResolvedValue({
      id: "inst-1",
      status: WorkflowStatus.PENDING,
      expiresAt: new Date(FIXED.getTime() - 1),
      policyId: "policy-1",
    });

    await expect(
      service.approveInstance("inst-1", "approver-1")
    ).rejects.toThrow("expired");
  });
});

// ── DurableExecutor ──────────────────────────────────────────────────────────

describe("DurableExecutor clock injection", () => {
  it("startExecution computes approval expiresAt from the injected clock", async () => {
    const executor = new DurableExecutor(clock);
    const plan = {
      planId: "plan-1",
      steps: [
        {
          stepNumber: 1,
          action: "swap",
          payload: {},
          description: "swap step",
        },
      ],
      totalSteps: 1,
      estimatedDuration: 1,
      riskLevel: "low",
      requiresApproval: true,
      approvalTimeoutMinutes: 30,
      summary: "test plan",
    } as unknown as ExecutionPlan;

    const execution = await executor.startExecution(plan, "user-1");

    expect(execution.expiresAt).toEqual(
      new Date(FIXED.getTime() + 30 * 60_000)
    );
    expect((execution.steps?.[0] as any)?.status).toBe(StepStatus.PENDING);
  });
});
