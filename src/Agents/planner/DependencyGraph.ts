/**
 * DependencyGraph
 *
 * Derives an executable dependency graph from a set of PlanSteps.
 * Responsibilities:
 *   - Build adjacency list from PlanStep.dependencies[]
 *   - Detect cycles (throws on invalid plans)
 *   - Produce execution waves via Kahn's topological sort
 *     where a "wave" is a set of steps that may run in parallel
 *   - Track per-step conflict resources so the scheduler can serialize
 *     steps that touch the same wallet, quote, lock, or approval object
 *   - Validate the ownership of *external workflow dependencies*: steps that
 *     reference a step belonging to a different durable execution
 *     (see {@link ExternalWorkflowDependency} and
 *     {@link DependencyGraph.build}).  Missing *in-plan* dependencies were
 *     already rejected here; ownership of references that leave the plan is
 *     validated fail-closed against an authoritative owner map.
 */

import { PlanStep } from "./AgentPlanner";
import logger from "../../config/logger";

/** A group of step numbers that are ready to run concurrently. */
export type ExecutionWave = readonly number[];

/**
 * Resource keys extracted from a step payload that identify shared mutable
 * state. The scheduler uses these to serialize steps that conflict.
 *
 * Convention:  `<kind>:<id>`
 * Examples:    `wallet:G…XLM`, `quote:abc123`, `lock:trade:user-1`, `approval:step-3`
 */
export type ResourceKey = string;

/** Metadata stored per step in the graph. */
export interface StepNode {
  stepNumber: number;
  /** Upstream step numbers this step directly depends on. */
  dependencies: ReadonlySet<number>;
  /** Downstream step numbers that depend on this step. */
  dependents: Set<number>;
  /** Shared-resource keys that must be held exclusively during execution. */
  conflictResources: ReadonlySet<ResourceKey>;
}

/** Result of a full graph build. */
export interface GraphBuildResult {
  /** Ordered sequence of parallel waves, each wave safe to run concurrently. */
  waves: ExecutionWave[];
  /** Map from stepNumber → StepNode for O(1) look-ups. */
  nodes: ReadonlyMap<number, StepNode>;
}

// ---------------------------------------------------------------------------
// External workflow dependencies
// ---------------------------------------------------------------------------

/**
 * Payload key under which a step declares dependencies that live in a
 * *different* durable workflow.
 *
 * The declaration lives inside `PlanStep.payload` on purpose: the payload is
 * part of the canonical plan hash produced by `PlanHashService` and re-computed
 * by the SDK's `PlanVerifier`, so a reference cannot be added, removed or
 * re-pointed after approval without invalidating the plan hash.  This mirrors
 * the existing `conflictResources` payload convention in this module.
 *
 * Shape:
 *
 * ```jsonc
 * {
 *   "action": "release_escrow",
 *   "payload": {
 *     "externalWorkflowDependencies": [
 *       { "executionId": "0f2c…", "stepNumber": 3 }
 *     ]
 *   }
 * }
 * ```
 */
export const EXTERNAL_WORKFLOW_DEPENDENCIES_KEY =
  "externalWorkflowDependencies";

/**
 * A reference from a step to a step owned by another durable workflow.
 *
 * `executionId` identifies the external workflow (a `DurableExecution.id`), and
 * `stepNumber` the step inside it whose result this step consumes.
 */
export interface ExternalWorkflowDependency {
  /** Durable execution id of the external workflow. */
  executionId: string;
  /** Step number inside the external workflow. */
  stepNumber: number;
  /**
   * Owner recorded by the planner that produced the reference.
   *
   * Never trusted on its own — it is only compared against the authoritative
   * owner supplied in {@link GraphBuildOptions.externalOwners}, and a mismatch
   * is rejected as a spoofed ownership claim.
   */
  ownerId?: string;
}

/** Machine-readable reasons an external workflow reference was rejected. */
export type ExternalDependencyViolationCode =
  | "ownership_context_required"
  | "malformed_reference"
  | "self_reference"
  | "duplicate_reference"
  | "unverifiable_ownership"
  | "owner_mismatch";

/**
 * Raised when a step references an external workflow whose ownership cannot be
 * established, or whose owner is not permitted to be depended on.
 *
 * Extends `Error`, so existing callers that treat graph-build failures as
 * generic errors keep working; `code` lets callers (and tests) distinguish the
 * refusal reason without matching on message text.
 */
export class ExternalDependencyOwnershipError extends Error {
  /** Why the reference was refused. */
  readonly code: ExternalDependencyViolationCode;
  /** Plan step that declared the refused reference. */
  readonly stepNumber: number;
  /** External execution id involved, when known. */
  readonly executionId?: string;

  constructor(
    code: ExternalDependencyViolationCode,
    stepNumber: number,
    message: string,
    executionId?: string
  ) {
    super(message);
    this.name = "ExternalDependencyOwnershipError";
    this.code = code;
    this.stepNumber = stepNumber;
    this.executionId = executionId;
  }
}

/** Options accepted by {@link DependencyGraph.build}. */
export interface GraphBuildOptions {
  /** Principal (a `DurableExecution.userId`) that owns the workflow being built. */
  ownerId?: string;
  /**
   * Durable execution id of the workflow being built.  Used to reject a step
   * that re-declares its own workflow as "external" — such a reference would
   * escape the in-plan dependency checks above.
   */
  executionId?: string;
  /**
   * Authoritative `executionId → ownerId` map for every external workflow the
   * plan references.  Callers MUST populate it from persisted execution
   * records, never from planner output.
   *
   * When a plan declares external dependencies and this map is omitted the
   * build fails closed (`ownership_context_required`).
   */
  externalOwners?: ReadonlyMap<string, string>;
  /**
   * When true, references to workflows owned by another principal are allowed
   * (audited cross-owner operations).  Defaults to false: a plan may only
   * depend on workflows owned by its own principal.  Unused when the plan
   * declares no external dependencies.
   */
  allowCrossOwner?: boolean;
}

// ---------------------------------------------------------------------------
// Resource extraction helpers
// ---------------------------------------------------------------------------

/**
 * Well-known payload keys that identify conflict resources.
 * Extend this as new DeFi operations are added.
 */
const WALLET_KEYS = [
  "walletId",
  "fromWallet",
  "toWallet",
  "userId",
  "fromAddress",
  "toAddress",
] as const;
const QUOTE_KEYS = ["quoteId", "quote", "quoteToken"] as const;
const LOCK_KEYS = ["lockKey", "resourceKey", "tradeId"] as const;
const APPROVAL_KEYS = ["approvalId", "spender", "tokenAddress"] as const;

function extractResourceKeys(step: PlanStep): Set<ResourceKey> {
  const resources = new Set<ResourceKey>();
  const payload = step.payload as Record<string, unknown>;

  for (const key of WALLET_KEYS) {
    const val = payload[key];
    if (typeof val === "string" && val) {
      resources.add(`wallet:${val}`);
    }
  }

  for (const key of QUOTE_KEYS) {
    const val = payload[key];
    if (typeof val === "string" && val) {
      resources.add(`quote:${val}`);
    }
  }

  for (const key of LOCK_KEYS) {
    const val = payload[key];
    if (typeof val === "string" && val) {
      resources.add(`lock:${val}`);
    }
  }

  for (const key of APPROVAL_KEYS) {
    const val = payload[key];
    if (typeof val === "string" && val) {
      resources.add(`approval:${val}`);
    }
  }

  // Any action that explicitly names a conflictResources array in its payload
  const explicit = payload["conflictResources"];
  if (Array.isArray(explicit)) {
    for (const r of explicit) {
      if (typeof r === "string" && r) {
        resources.add(r);
      }
    }
  }

  return resources;
}

// ---------------------------------------------------------------------------
// External workflow dependency helpers
// ---------------------------------------------------------------------------

/** Reads the raw external-dependency list declared by a step, unvalidated. */
function readExternalDependencyDeclarations(
  step: PlanStep
): unknown[] | undefined {
  const payload = step.payload;
  if (payload === null || typeof payload !== "object") {
    return undefined;
  }

  const raw = (payload as Record<string, unknown>)[
    EXTERNAL_WORKFLOW_DEPENDENCIES_KEY
  ];
  if (raw === undefined || raw === null) {
    return undefined;
  }

  if (!Array.isArray(raw)) {
    throw new ExternalDependencyOwnershipError(
      "malformed_reference",
      step.stepNumber,
      `Step ${step.stepNumber} declares ${EXTERNAL_WORKFLOW_DEPENDENCIES_KEY} but it is not an array`
    );
  }

  return raw;
}

/** Parses — and structurally validates — the external dependencies of one step. */
function parseExternalDependencies(
  step: PlanStep
): ExternalWorkflowDependency[] {
  const declarations = readExternalDependencyDeclarations(step);
  if (!declarations || declarations.length === 0) {
    return [];
  }

  const references: ExternalWorkflowDependency[] = [];

  for (const declaration of declarations) {
    if (
      declaration === null ||
      typeof declaration !== "object" ||
      Array.isArray(declaration)
    ) {
      throw new ExternalDependencyOwnershipError(
        "malformed_reference",
        step.stepNumber,
        `Step ${step.stepNumber} declares an external workflow dependency that is not an object ` +
          `(expected { executionId, stepNumber })`
      );
    }

    const { executionId, stepNumber, ownerId } = declaration as Record<
      string,
      unknown
    >;

    if (typeof executionId !== "string" || executionId.trim() === "") {
      throw new ExternalDependencyOwnershipError(
        "malformed_reference",
        step.stepNumber,
        `Step ${step.stepNumber} declares an external workflow dependency without a non-empty "executionId"`
      );
    }

    if (
      typeof stepNumber !== "number" ||
      !Number.isInteger(stepNumber) ||
      stepNumber < 1
    ) {
      throw new ExternalDependencyOwnershipError(
        "malformed_reference",
        step.stepNumber,
        `Step ${step.stepNumber} declares an external workflow dependency on ${executionId} ` +
          `without a positive integer "stepNumber"`,
        executionId
      );
    }

    if (
      ownerId !== undefined &&
      (typeof ownerId !== "string" || ownerId.trim() === "")
    ) {
      throw new ExternalDependencyOwnershipError(
        "malformed_reference",
        step.stepNumber,
        `Step ${step.stepNumber} declares a malformed "ownerId" for external workflow ${executionId}`,
        executionId
      );
    }

    references.push({
      executionId,
      stepNumber,
      ownerId: ownerId as string | undefined,
    });
  }

  return references;
}

/**
 * Validates the ownership of every external workflow reference in `steps`.
 *
 * Fail-closed rules, in evaluation order:
 *
 *  1. `ownership_context_required` — a reference exists but the caller supplied
 *     no authoritative owner source (`externalOwners`), or no plan owner
 *     (`ownerId`) while cross-owner references are not allowed.
 *  2. `malformed_reference` — the declaration is not a well-formed
 *     `{ executionId, stepNumber }` object (raised while parsing).
 *  3. `duplicate_reference` — one step declares the same external step twice,
 *     which would make the declaration ambiguous.
 *  4. `self_reference` — the step points at the workflow being built, which
 *     would bypass the in-plan dependency checks.
 *  5. `unverifiable_ownership` — the authoritative owner of the referenced
 *     execution is unknown.
 *  6. `owner_mismatch` — the planner-declared `ownerId` disagrees with the
 *     authoritative owner, or the authoritative owner is another principal and
 *     cross-owner references are not allowed.
 *
 * @returns The number of validated references, for logging.
 */
function validateExternalDependencyOwnership(
  steps: readonly PlanStep[],
  options: GraphBuildOptions
): number {
  const declared = steps.map((step) => ({
    step,
    references: parseExternalDependencies(step),
  }));

  const referenceCount = declared.reduce(
    (total, entry) => total + entry.references.length,
    0
  );
  if (referenceCount === 0) {
    return 0;
  }

  const firstDeclaringStep = declared.find(
    (entry) => entry.references.length > 0
  )!;
  const firstStepNumber = firstDeclaringStep.step.stepNumber;

  if (!options.externalOwners) {
    throw new ExternalDependencyOwnershipError(
      "ownership_context_required",
      firstStepNumber,
      "External workflow ownership cannot be verified: no authoritative owner map was supplied " +
        "(GraphBuildOptions.externalOwners)"
    );
  }

  if (!options.allowCrossOwner && !options.ownerId) {
    throw new ExternalDependencyOwnershipError(
      "ownership_context_required",
      firstStepNumber,
      "External workflow ownership cannot be verified: no plan owner was supplied " +
        "(GraphBuildOptions.ownerId)"
    );
  }

  for (const { step, references } of declared) {
    const seen = new Set<string>();

    for (const { executionId, stepNumber, ownerId } of references) {
      const referenceKey = `${executionId}#${stepNumber}`;
      if (seen.has(referenceKey)) {
        throw new ExternalDependencyOwnershipError(
          "duplicate_reference",
          step.stepNumber,
          `Step ${step.stepNumber} declares external workflow ${executionId} step ${stepNumber} ` +
            `more than once`,
          executionId
        );
      }
      seen.add(referenceKey);

      if (options.executionId && executionId === options.executionId) {
        throw new ExternalDependencyOwnershipError(
          "self_reference",
          step.stepNumber,
          `Step ${step.stepNumber} declares execution ${executionId} as an external dependency, but ` +
            `that is the execution being built; use PlanStep.dependencies for in-plan ordering`,
          executionId
        );
      }

      const authoritativeOwner = options.externalOwners.get(executionId);
      if (!authoritativeOwner) {
        throw new ExternalDependencyOwnershipError(
          "unverifiable_ownership",
          step.stepNumber,
          `Step ${step.stepNumber} depends on external workflow ${executionId}, whose ownership ` +
            `could not be verified against persisted execution records`,
          executionId
        );
      }

      if (ownerId !== undefined && ownerId !== authoritativeOwner) {
        throw new ExternalDependencyOwnershipError(
          "owner_mismatch",
          step.stepNumber,
          `Step ${step.stepNumber} claims external workflow ${executionId} is owned by ${ownerId}, ` +
            `but it is owned by ${authoritativeOwner}`,
          executionId
        );
      }

      if (!options.allowCrossOwner && authoritativeOwner !== options.ownerId) {
        throw new ExternalDependencyOwnershipError(
          "owner_mismatch",
          step.stepNumber,
          `Step ${step.stepNumber} depends on external workflow ${executionId} owned by ` +
            `${authoritativeOwner}, which does not own the workflow being built (${options.ownerId})`,
          executionId
        );
      }
    }
  }

  return referenceCount;
}

// ---------------------------------------------------------------------------
// DependencyGraph
// ---------------------------------------------------------------------------

export class DependencyGraph {
  /**
   * Build a dependency graph and compute parallel execution waves.
   *
   * In-plan dependencies are resolved first: every `PlanStep.dependencies`
   * entry must name a step of the same plan, cycles are rejected, and steps are
   * grouped into parallel waves.
   *
   * Steps that additionally reference steps of *other* workflows through
   * {@link EXTERNAL_WORKFLOW_DEPENDENCIES_KEY} have those references validated
   * for ownership before any wave is computed.  Plans that declare no external
   * dependency are unaffected by `options`, so existing callers keep their
   * previous behaviour.
   *
   * @param steps - All steps in the execution plan (order-independent).
   * @param options - Ownership context for external workflow references.
   * @returns A GraphBuildResult containing waves and indexed nodes.
   * @throws Error if the dependency graph contains a cycle or names an unknown step.
   * @throws ExternalDependencyOwnershipError if an external workflow reference
   *   is malformed, unverifiable, self-referential, duplicated, or owned by
   *   another principal.
   */
  static build(
    steps: readonly PlanStep[],
    options: GraphBuildOptions = {}
  ): GraphBuildResult {
    if (steps.length === 0) {
      return { waves: [], nodes: new Map() };
    }

    const externalDependencyCount = validateExternalDependencyOwnership(
      steps,
      options
    );

    const nodes = new Map<number, StepNode>();

    // Pass 1: create all nodes
    for (const step of steps) {
      nodes.set(step.stepNumber, {
        stepNumber: step.stepNumber,
        dependencies: new Set(step.dependencies ?? []),
        dependents: new Set(),
        conflictResources: extractResourceKeys(step),
      });
    }

    // Pass 2: populate reverse edges (dependents)
    for (const node of nodes.values()) {
      for (const depNum of node.dependencies) {
        const depNode = nodes.get(depNum);
        if (!depNode) {
          throw new Error(
            `Step ${node.stepNumber} declares dependency on unknown step ${depNum}`
          );
        }
        depNode.dependents.add(node.stepNumber);
      }
    }

    // Pass 3: Kahn's algorithm to produce waves and detect cycles
    const waves = DependencyGraph.kahnSort(nodes);

    logger.debug("DependencyGraph built", {
      stepCount: steps.length,
      waveCount: waves.length,
      waves: waves.map((w) => [...w]),
      externalDependencies: externalDependencyCount,
    });

    return { waves, nodes };
  }

  /**
   * Sorted, de-duplicated execution ids referenced by the plan's external
   * workflow dependencies.
   *
   * Callers use this to prefetch authoritative owners (one lookup per id)
   * before handing the map to {@link DependencyGraph.build}.
   *
   * @throws ExternalDependencyOwnershipError when a declaration is malformed.
   */
  static collectExternalDependencyExecutionIds(
    steps: readonly PlanStep[]
  ): string[] {
    const executionIds = new Set<string>();

    for (const step of steps) {
      for (const reference of parseExternalDependencies(step)) {
        executionIds.add(reference.executionId);
      }
    }

    return [...executionIds].sort();
  }

  /**
   * Kahn's topological sort — groups steps into parallel execution waves.
   * Each wave contains steps whose dependencies are fully satisfied by
   * all prior waves.
   */
  private static kahnSort(nodes: Map<number, StepNode>): ExecutionWave[] {
    // in-degree map (mutable copy of dependency counts)
    const inDegree = new Map<number, number>();
    for (const [num, node] of nodes) {
      inDegree.set(num, node.dependencies.size);
    }

    const waves: ExecutionWave[] = [];
    let remaining = nodes.size;

    while (remaining > 0) {
      // Collect all zero-in-degree nodes — deterministic order: sort ascending
      const ready: number[] = [];
      for (const [num, deg] of inDegree) {
        if (deg === 0) {
          ready.push(num);
        }
      }

      if (ready.length === 0) {
        // Cycle detected: find which steps are still in the graph
        const cycleNodes = [...inDegree.keys()]
          .filter((n) => (inDegree.get(n) ?? 0) > 0)
          .sort((a, b) => a - b);
        throw new Error(
          `Cycle detected in dependency graph involving steps: ${cycleNodes.join(", ")}`
        );
      }

      // Sort for determinism within a wave
      ready.sort((a, b) => a - b);
      waves.push(Object.freeze(ready));

      // Remove processed nodes and decrement dependent counts
      for (const num of ready) {
        inDegree.delete(num);
        const node = nodes.get(num)!;
        for (const dep of node.dependents) {
          inDegree.set(dep, (inDegree.get(dep) ?? 0) - 1);
        }
        remaining--;
      }
    }

    return waves;
  }

  /**
   * Returns the set of step numbers that are transitive successors of a given
   * step — i.e., steps that would be "orphaned" if the given step fails.
   *
   * Used by compensation logic to identify which downstream steps to cancel.
   */
  static getDownstreamSteps(
    failedStep: number,
    nodes: ReadonlyMap<number, StepNode>
  ): Set<number> {
    const downstream = new Set<number>();
    const queue: number[] = [failedStep];

    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = nodes.get(current);
      if (!node) continue;

      for (const dep of node.dependents) {
        if (!downstream.has(dep)) {
          downstream.add(dep);
          queue.push(dep);
        }
      }
    }

    return downstream;
  }

  /**
   * Returns the reverse-topological order of completed ancestors — the order
   * in which rollback/compensation actions should be applied.
   *
   * Steps are returned last-completed-first so that compensation "unwinds"
   * the execution in a safe order.
   */
  static getCompensationOrder(
    completedSteps: readonly number[],
    nodes: ReadonlyMap<number, StepNode>
  ): number[] {
    // Build subgraph of completed steps
    const completedSet = new Set(completedSteps);

    // Topological sort of completed steps (reusing Kahn's) then reverse
    const subNodes = new Map<number, StepNode>();
    for (const num of completedSet) {
      const node = nodes.get(num);
      if (node) {
        subNodes.set(num, {
          ...node,
          // Only retain edges within completed subgraph
          dependencies: new Set(
            [...node.dependencies].filter((d) => completedSet.has(d))
          ),
          dependents: new Set(
            [...node.dependents].filter((d) => completedSet.has(d))
          ),
        });
      }
    }

    if (subNodes.size === 0) return [];

    const forwardOrder = DependencyGraph.kahnSort(subNodes)
      .flat()
      .map((n) => n);

    // Reverse for compensation (undo last-first)
    return forwardOrder.reverse();
  }
}
