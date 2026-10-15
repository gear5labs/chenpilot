/**
 * stepInputResolution.test.ts
 *
 * Issue #809 — persist immutable resolved inputs before a step can execute.
 *
 * Suite 1 exercises the resolution and immutability rules directly, with no
 * database and no executor.
 *
 * Suite 2 drives the sequential durable executor through its `resumeExecution`
 * path (which awaits the internal run loop) and asserts the operational
 * guarantees end to end:
 *   - the resolved inputs are persisted *before* the tool is invoked,
 *   - a resume/retry replays the frozen snapshot verbatim, even when the
 *     execution context has changed since,
 *   - an unresolvable placeholder fails the step closed: the tool is never
 *     invoked and no retry budget is consumed.
 *
 * The executor suite mirrors the in-memory TypeORM mocks used by
 * `cancellation.race.test.ts` — no real database or Redis instance is needed.
 */

jest.mock("../../../config/config", () => ({
  __esModule: true,
  default: {
    agent: { timeouts: { toolExecution: 30_000, agentExecution: 60_000 } },
    jwt: { secret: "test-secret-32-chars-long-enough!!" },
    db: {},
    redis: {},
  },
}));

jest.mock("../../../config/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../../../config/Datasource", () => {
  const makeRepo = () => ({
    findOne: jest.fn(),
    find: jest.fn(),
    save: jest.fn(async (entity: unknown) => entity),
    create: jest.fn((entity: unknown) => entity),
  });

  const executionRepo = makeRepo();
  const stepRepo = makeRepo();

  return {
    __esModule: true,
    AppDataSource: {
      getRepository: jest.fn((entity: { name?: string }) => {
        const name = typeof entity === "function" ? entity.name : "";
        return name === "DurableStep" ? stepRepo : executionRepo;
      }),
    },
  };
});

jest.mock("../../../Gateway/socketManager", () => ({
  __esModule: true,
  RealtimeEventType: {
    AGENT_EXECUTION_STARTED: "agent_execution_started",
    AGENT_EXECUTION_COMPLETED: "agent_execution_completed",
    AGENT_EXECUTION_FAILED: "agent_execution_failed",
    AGENT_STEP_COMPLETED: "agent_step_completed",
    AGENT_APPROVAL_REQUIRED: "agent_approval_required",
  },
  getSocketManager: jest.fn(() => ({
    getEventEmitter: () => ({ emitAgentExecutionUpdate: jest.fn() }),
  })),
}));

jest.mock("../../registry/ToolRegistry", () => ({
  __esModule: true,
  toolRegistry: { executeTool: jest.fn() },
}));

jest.mock("../ParallelScheduler", () => ({
  __esModule: true,
  parallelScheduler: { run: jest.fn() },
}));

jest.mock("../CompensationService", () => ({
  __esModule: true,
  compensationService: {
    compensateFailedExecution: jest.fn(async () => "recovered"),
  },
  buildCompensationPlan: jest.fn(() => ({
    type: "reversible",
    rollbackAction: null,
    rollbackPayload: null,
    description: "test compensation plan",
    maxRetries: 3,
  })),
}));

import { AppDataSource } from "../../../config/Datasource";
import { DurableExecutor } from "../DurableExecutor";
import { ExecutionStatus } from "../DurableExecution.entity";
import { StepStatus } from "../DurableStep.entity";
import { toolRegistry } from "../../registry/ToolRegistry";
import {
  ResolvedInputsIntegrityError,
  UnresolvedStepInputError,
  clearResolvedStepInputs,
  collectCompletedStepResults,
  containsUnresolvedPlaceholders,
  hashResolvedInputs,
  isResolvedStepInputsSnapshot,
  isStepInputPlaceholder,
  readFrozenStepInputs,
  resolveAndFreezeStepInputs,
  resolveStepInputs,
  type ResolvableStepLike,
  type StepInputResolutionContext,
  type StepPersister,
} from "../stepInputResolution";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(
  overrides: Partial<StepInputResolutionContext> = {}
): StepInputResolutionContext {
  return { stepResults: new Map<number, unknown>(), context: {}, ...overrides };
}

interface RecordingPersister extends StepPersister {
  /** Snapshots of the entity as it looked at each `save()` call. */
  saves: Record<string, unknown>[];
}

function makePersister(): RecordingPersister {
  const saves: Record<string, unknown>[] = [];

  return {
    saves,
    save: jest.fn(async (step: unknown) => {
      // Copy at save time: this is what proves the snapshot was durable
      // *before* the caller went on to touch an external system.
      saves.push({ ...(step as Record<string, unknown>) });
      return step;
    }),
  };
}
// ---------------------------------------------------------------------------
// Suite 1 — resolution and immutability rules
// ---------------------------------------------------------------------------

describe("stepInputResolution — resolving placeholders", () => {
  it("substitutes the object form from a completed step's result", () => {
    const ctx = makeContext({
      stepResults: new Map<number, unknown>([
        [1, { status: "success", data: { total: 250 } }],
      ]),
    });

    const resolved = resolveStepInputs(
      { amount: { $ref: "steps.1.result.data.total" }, to: "alice" },
      ctx
    );

    expect(resolved.inputs).toEqual({ amount: 250, to: "alice" });
    expect(resolved.references).toEqual([
      { location: "payload.amount", ref: "steps.1.result.data.total" },
    ]);
    expect(containsUnresolvedPlaceholders(resolved.inputs)).toBe(false);
  });

  it("substitutes the string form from the execution context", () => {
    const ctx = makeContext({ context: { quote: { id: "q-7" } } });

    const resolved = resolveStepInputs({ quoteId: "$ref:context.quote.id" }, ctx);

    expect(resolved.inputs).toEqual({ quoteId: "q-7" });
    expect(resolved.references).toEqual([
      { location: "payload.quoteId", ref: "context.quote.id" },
    ]);
  });

  it("resolves nested structures and array entries without mutating the template", () => {
    const payload = {
      legs: [{ amount: { $ref: "steps.1.result.data.total" } }, { amount: 5 }],
      meta: { note: "$ref:context.note" },
    };

    const resolved = resolveStepInputs(
      payload,
      makeContext({
        stepResults: new Map<number, unknown>([[1, { data: { total: 100 } }]]),
        context: { note: "hello" },
      })
    );

    expect(resolved.inputs).toEqual({
      legs: [{ amount: 100 }, { amount: 5 }],
      meta: { note: "hello" },
    });
    expect(resolved.references).toEqual([
      { location: "payload.legs[0].amount", ref: "steps.1.result.data.total" },
      { location: "payload.meta.note", ref: "context.note" },
    ]);

    // The template is preserved for audit and operator inspection.
    expect(payload.legs[0].amount).toEqual({
      $ref: "steps.1.result.data.total",
    });
  });

  it("passes a fully concrete payload through untouched", () => {
    const resolved = resolveStepInputs(
      { amount: 10, asset: "XLM" },
      makeContext()
    );

    expect(resolved.inputs).toEqual({ amount: 10, asset: "XLM" });
    expect(resolved.references).toEqual([]);
  });

  it("keeps a substituted value verbatim instead of re-resolving it", () => {
    // A previous step's result is data — even when it happens to look like a
    // placeholder, it is not re-traversed.
    const ctx = makeContext({
      stepResults: new Map<number, unknown>([[1, { nested: { a: 1 } }]]),
    });

    const resolved = resolveStepInputs(
      { payload: { $ref: "steps.1.result.nested" } },
      ctx
    );

    expect(resolved.inputs).toEqual({ payload: { a: 1 } });
  });
});

describe("stepInputResolution — fail-closed refusals", () => {
  it("rejects a reference to a step that has not completed", () => {
    let thrown: unknown;

    try {
      resolveStepInputs(
        { amount: { $ref: "steps.9.result.data.total" } },
        makeContext()
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnresolvedStepInputError);
    expect((thrown as UnresolvedStepInputError).code).toBe(
      "unresolved_reference"
    );
    expect((thrown as UnresolvedStepInputError).location).toBe("payload.amount");
  });

  it("rejects a missing path segment inside a completed step's result", () => {
    expect(() =>
      resolveStepInputs(
        { amount: { $ref: "steps.1.result.data.missing" } },
        makeContext({
          stepResults: new Map<number, unknown>([[1, { data: { total: 1 } }]]),
        })
      )
    ).toThrow(/segment "missing" is not present/);
  });

  it("rejects an unknown reference namespace", () => {
    expect(() =>
      resolveStepInputs({ amount: "$ref:secrets.amount" }, makeContext())
    ).toThrow(/unknown namespace "secrets"/);
  });

  it("rejects a malformed $ref placeholder", () => {
    expect(() =>
      resolveStepInputs({ amount: { $ref: "" } }, makeContext())
    ).toThrow(/Malformed step input placeholder at "payload.amount"/);
  });

  it("rejects an unmaterialised {{…}} template token", () => {
    expect(() =>
      resolveStepInputs({ amount: "{{AMOUNT}}" }, makeContext())
    ).toThrow(/Unmaterialised template placeholder at "payload.amount"/);
  });

  it("refuses to freeze inputs when a referenced value still carries placeholder syntax", () => {
    expect(() =>
      resolveStepInputs(
        { amount: { $ref: "steps.1.result.data.total" } },
        makeContext({
          stepResults: new Map<number, unknown>([
            [1, { data: { total: { $ref: "steps.2.result" } } }],
          ]),
        })
      )
    ).toThrow(/still contain placeholder syntax/);
  });
});

describe("stepInputResolution — placeholder detection", () => {
  it("recognises well-formed placeholders only", () => {
    expect(isStepInputPlaceholder({ $ref: "context.a" })).toBe(true);
    expect(isStepInputPlaceholder("$ref:context.a")).toBe(true);
    expect(isStepInputPlaceholder({ $ref: "" })).toBe(false);
    expect(isStepInputPlaceholder("$ref:")).toBe(false);
    expect(isStepInputPlaceholder("plain")).toBe(false);
    expect(isStepInputPlaceholder({ $ref: "context.a", extra: 1 })).toBe(false);
  });

  it("flags any leftover marker, well-formed or not, anywhere in a snapshot", () => {
    expect(containsUnresolvedPlaceholders({ a: { b: "$ref:context.x" } })).toBe(
      true
    );
    expect(containsUnresolvedPlaceholders({ a: ["ok", "{{X}}"] })).toBe(true);
    expect(containsUnresolvedPlaceholders("$ref:")).toBe(true);
    expect(
      containsUnresolvedPlaceholders({ a: [1, "ok", { b: true }] })
    ).toBe(false);
  });
});

describe("stepInputResolution — hashing and completion helpers", () => {
  it("hashes independent of key order but sensitive to values", () => {
    const a = hashResolvedInputs({ x: 1, y: { p: [1, 2] } });
    const b = hashResolvedInputs({ y: { p: [1, 2] }, x: 1 });
    const c = hashResolvedInputs({ x: 1, y: { p: [1, 3] } });

    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("collects only steps that hold a persisted result", () => {
    const results = collectCompletedStepResults([
      { stepNumber: 1, result: { ok: true } },
      { stepNumber: 2, result: null },
      { stepNumber: 3, result: 0 },
    ]);

    expect([...results.keys()]).toEqual([1, 3]);
  });
});

describe("resolveAndFreezeStepInputs — immutable snapshots", () => {
  it("persists the resolved inputs before returning them", async () => {
    const step = makeStep({
      payload: { amount: { $ref: "steps.1.result.data.total" }, to: "alice" },
    });
    const persister = makePersister();
    const ctx = makeContext({
      stepResults: new Map<number, unknown>([[1, { data: { total: 42 } }]]),
    });

    const inputs = await resolveAndFreezeStepInputs(step, ctx, persister);

    expect(inputs).toEqual({ amount: 42, to: "alice" });
    expect(persister.save).toHaveBeenCalledTimes(1);
    // The record written to the database already carried the snapshot.
    expect(persister.saves[0].resolvedInputs).toEqual(inputs);
    expect(persister.saves[0].resolvedInputsHash).toBe(
      hashResolvedInputs(inputs)
    );
    expect(persister.saves[0].resolvedAt).toBeInstanceOf(Date);
    expect(isResolvedStepInputsSnapshot(step)).toBe(true);
  });

  it("never overwrites a snapshot, even when the context changed since", async () => {
    const step = makeStep({ payload: { amount: { $ref: "context.amount" } } });
    const persister = makePersister();

    const first = await resolveAndFreezeStepInputs(
      step,
      makeContext({ context: { amount: 10 } }),
      persister
    );

    // A retry or resume observes a *different* context value.
    const second = await resolveAndFreezeStepInputs(
      step,
      makeContext({ context: { amount: 999 } }),
      persister
    );

    expect(first).toEqual({ amount: 10 });
    expect(second).toEqual({ amount: 10 });
    expect(persister.save).toHaveBeenCalledTimes(1);
  });

  it("persists nothing and refuses when a placeholder cannot be resolved", async () => {
    const step = makeStep({ payload: { amount: "{{AMOUNT}}" } });
    const persister = makePersister();

    await expect(
      resolveAndFreezeStepInputs(step, makeContext(), persister)
    ).rejects.toBeInstanceOf(UnresolvedStepInputError);

    expect(persister.save).not.toHaveBeenCalled();
    expect(step.resolvedInputs).toBeFalsy();
    expect(step.resolvedAt).toBeFalsy();
  });

  it("rejects a snapshot whose hash no longer matches", async () => {
    const step = makeStep({ payload: { amount: 1 } });
    const persister = makePersister();

    await resolveAndFreezeStepInputs(step, makeContext(), persister);
    step.resolvedInputs = { amount: 1_000_000 };

    expect(() => readFrozenStepInputs(step)).toThrow(
      ResolvedInputsIntegrityError
    );
    await expect(
      resolveAndFreezeStepInputs(step, makeContext(), persister)
    ).rejects.toThrow(/do not match their recorded hash/);
    expect(persister.save).toHaveBeenCalledTimes(1);
  });

  it("rejects a frozen snapshot that still contains a placeholder", async () => {
    const step = makeStep({
      payload: { amount: 1 },
      resolvedInputs: { amount: { $ref: "context.amount" } },
      resolvedInputsHash: "irrelevant-because-the-shape-is-already-wrong",
      resolvedAt: new Date(),
    });

    expect(() => readFrozenStepInputs(step)).toThrow(
      /still contain an unresolved placeholder/
    );
  });

  it("clears a snapshot only when an operator supersedes the payload", async () => {
    const step = makeStep({ payload: { amount: 5 } });
    const persister = makePersister();

    await resolveAndFreezeStepInputs(step, makeContext(), persister);
    const hashBefore = step.resolvedInputsHash;

    expect(clearResolvedStepInputs(step)).toBe(hashBefore);
    expect(step.resolvedInputs).toBeNull();
    expect(step.resolvedInputsHash).toBeNull();
    expect(step.resolvedAt).toBeNull();
    expect(clearResolvedStepInputs(step)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Suite 2 — durable executor regression (issue #809)
// ---------------------------------------------------------------------------

interface DurableStepLike {
  id: string;
  stepNumber: number;
  action: string;
  payload: Record<string, unknown>;
  status: StepStatus;
  requiresApproval: boolean;
  approvedAt: Date | null;
  result: unknown;
  error?: string;
  retryCount: number;
  maxRetries: number;
  startedAt: Date | null;
  completedAt: Date | null;
  resolvedInputs?: Record<string, unknown> | null;
  resolvedInputsHash?: string | null;
  resolvedAt?: Date | null;
  execution?: { id: string };
}

function makeDurableStep(
  overrides: Partial<DurableStepLike> = {}
): DurableStepLike {
  return {
    id: "step-1",
    stepNumber: 1,
    action: "swap",
    payload: { amount: 1 },
    status: StepStatus.PENDING,
    requiresApproval: false,
    approvedAt: null,
    result: null,
    retryCount: 0,
    maxRetries: 3,
    startedAt: null,
    completedAt: null,
    resolvedInputs: null,
    resolvedInputsHash: null,
    resolvedAt: null,
    execution: { id: "exec-1" },
    ...overrides,
  };
}

function makeExecution(
  steps: DurableStepLike[],
  context: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    id: "exec-1",
    planId: "plan-1",
    userId: "user-owner",
    status: ExecutionStatus.RUNNING,
    requiresApproval: false,
    approvedAt: null,
    approvedBy: null,
    currentStepNumber: 1,
    context,
    steps,
    errorMessage: null,
    cancelledAt: null,
    cancelledBy: null,
    cancellationReason: null,
    schemaVersion: "1.0.0",
  };
}

describe("DurableExecutor — resolved inputs are frozen before execution", () => {
  let executor: DurableExecutor;
  let executionRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let stepRepo: { findOne: jest.Mock; find: jest.Mock; save: jest.Mock };
  let events: string[];
  let savedExecutions: Record<string, unknown>[];

  /** Ordering log shared by the step repository and the tool registry. */
  function wireRepositories(execution: Record<string, unknown>): void {
    executionRepo.findOne.mockImplementation(async () => execution);
    executionRepo.save.mockImplementation(async (entity: unknown) => {
      savedExecutions.push({ ...(entity as Record<string, unknown>) });
      return entity;
    });
    stepRepo.save.mockImplementation(async (entity: unknown) => {
      const step = entity as Record<string, unknown>;
      events.push(
        `save:${String(step.stepNumber)}:${
          step.resolvedInputs ? "frozen" : String(step.status)
        }`
      );
      return entity;
    });
    stepRepo.find.mockResolvedValue(
      (execution.steps as DurableStepLike[]) ?? []
    );
  }

  beforeEach(() => {
    jest.clearAllMocks();
    events = [];
    savedExecutions = [];
    executor = new DurableExecutor();

    executionRepo = AppDataSource.getRepository(
      "DurableExecution" as never
    ) as never;
    stepRepo = AppDataSource.getRepository("DurableStep" as never) as never;
  });

  it("persists a step's resolved inputs before invoking its tool", async () => {
    const step1 = makeDurableStep({
      id: "step-1",
      stepNumber: 1,
      action: "quote",
      payload: { asset: "XLM" },
    });
    const step2 = makeDurableStep({
      id: "step-2",
      stepNumber: 2,
      action: "swap",
      // Unresolved template: the amount only exists once step 1 has run.
      payload: { amount: { $ref: "steps.1.result.data.total" }, to: "bob" },
    });

    wireRepositories(makeExecution([step1, step2]));

    (toolRegistry.executeTool as jest.Mock).mockImplementation(
      async (action: string) => {
        events.push(`tool:${action}`);
        if (action === "quote") {
          return { action, status: "success", data: { total: 250 } };
        }
        return { action, status: "success" };
      }
    );

    await executor.resumeExecution("exec-1");

    // Step 1 was concrete, so it is frozen from its own payload.
    expect(events.indexOf("save:1:frozen")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("save:1:frozen")).toBeLessThan(
      events.indexOf("tool:quote")
    );

    // Step 2 was frozen *after* step 1 completed and *before* its own tool ran.
    expect(events.indexOf("save:2:frozen")).toBeGreaterThan(
      events.indexOf("tool:quote")
    );
    expect(events.indexOf("save:2:frozen")).toBeLessThan(
      events.indexOf("tool:swap")
    );

    // The tool received the resolved value, not the placeholder.
    expect(toolRegistry.executeTool).toHaveBeenNthCalledWith(
      2,
      "swap",
      { amount: 250, to: "bob" },
      "user-owner"
    );

    // The template is preserved for audit and the snapshot is anchored.
    expect(step2.payload).toEqual({
      amount: { $ref: "steps.1.result.data.total" },
      to: "bob",
    });
    expect(step2.resolvedInputs).toEqual({ amount: 250, to: "bob" });
    expect(step2.resolvedInputsHash).toBe(
      hashResolvedInputs({ amount: 250, to: "bob" })
    );
    expect(step2.resolvedAt).toBeInstanceOf(Date);
    expect(step2.status).toBe(StepStatus.COMPLETED);
  });

  it("replays the frozen snapshot on a resume instead of re-deriving it", async () => {
    const frozenAt = new Date("2026-01-01T00:00:00.000Z");
    const step = makeDurableStep({
      payload: { amount: { $ref: "context.amount" } },
      resolvedInputs: { amount: 10 },
      resolvedInputsHash: hashResolvedInputs({ amount: 10 }),
      resolvedAt: frozenAt,
    });

    // The context has since changed; a re-derivation would submit 999.
    wireRepositories(makeExecution([step], { amount: 999 }));
    (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
      action: "swap",
      status: "success",
    });

    await executor.resumeExecution("exec-1");

    expect(toolRegistry.executeTool).toHaveBeenCalledWith(
      "swap",
      { amount: 10 },
      "user-owner"
    );
    // The snapshot itself was neither rewritten nor re-timestamped.
    expect(step.resolvedInputs).toEqual({ amount: 10 });
    expect(step.resolvedAt).toBe(frozenAt);
    // No rewrite: the frozen timestamp and hash are untouched, and the
    // template was never re-resolved against the changed context.
    expect(step.resolvedInputsHash).toBe(hashResolvedInputs({ amount: 10 }));
    expect(step.status).toBe(StepStatus.COMPLETED);
  });

  it("fails a step closed when a placeholder cannot be resolved", async () => {
    const step = makeDurableStep({
      payload: { amount: "{{AMOUNT}}", to: "bob" },
      maxRetries: 3,
    });

    wireRepositories(makeExecution([step]));
    (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
      action: "swap",
      status: "success",
    });

    await executor.resumeExecution("exec-1");

    // Fail-closed: the tool is never invoked, and the deterministic failure
    // consumes no retry budget.
    expect(toolRegistry.executeTool).not.toHaveBeenCalled();
    expect(step.retryCount).toBe(0);
    expect(step.status).toBe(StepStatus.FAILED);
    expect(step.error).toContain("Unresolved step inputs (unresolved_reference)");
    expect(step.resolvedInputs).toBeFalsy();

    // The execution is reported as FAILED with the resolution error recorded.
    const lastExecution = savedExecutions[savedExecutions.length - 1];
    expect(lastExecution.status).toBe(ExecutionStatus.FAILED);
    expect(String(lastExecution.errorMessage)).toContain(
      "Unresolved step inputs"
    );
  });

  it("clears a stale snapshot when an operator replaces the payload", async () => {
    const step = makeDurableStep({
      payload: { amount: 1 },
      resolvedInputs: { amount: 1 },
      resolvedInputsHash: hashResolvedInputs({ amount: 1 }),
      resolvedAt: new Date("2026-01-01T00:00:00.000Z"),
      status: StepStatus.FAILED,
      error: "boom",
      retryCount: 3,
    });

    stepRepo.findOne.mockResolvedValue(step);
    stepRepo.save.mockImplementation(async (entity: unknown) => entity);
    executionRepo.findOne.mockResolvedValue(
      makeExecution([step], { amount: 10 })
    );
    executionRepo.save.mockImplementation(async (entity: unknown) => entity);
    (toolRegistry.executeTool as jest.Mock).mockResolvedValue({
      action: "swap",
      status: "success",
    });

    await executor.repairUpdateAndRetry("exec-1", 1, {
      amount: { $ref: "context.amount" },
    });

    expect(step.payload).toEqual({ amount: { $ref: "context.amount" } });
    expect(toolRegistry.executeTool).toHaveBeenCalledWith(
      "swap",
      { amount: 10 },
      "user-owner"
    );
    expect(step.resolvedInputs).toEqual({ amount: 10 });
    expect(step.resolvedInputsHash).toBe(hashResolvedInputs({ amount: 10 }));
  });
});


function makeStep(overrides: Partial<ResolvableStepLike> = {}): ResolvableStepLike {
  return {
    id: "step-1",
    stepNumber: 1,
    payload: {},
    resolvedInputs: null,
    resolvedInputsHash: null,
    resolvedAt: null,
    ...overrides,
  } as ResolvableStepLike;
}
