/**
 * Immutable resolved step inputs (issue #809).
 *
 * A durable step is persisted twice over its lifetime:
 *
 *  1. At plan time, `DurableStep.payload` stores the *unresolved template* the
 *     planner produced. A template may contain placeholders for values that do
 *     not exist yet — the result of a previous step, or a value from the
 *     execution context.
 *  2. Immediately before the step's side effect is invoked, the template is
 *     resolved against the values available at that moment and the frozen
 *     result is written to `DurableStep.resolvedInputs` (together with
 *     `resolvedInputsHash` and `resolvedAt`). That snapshot is *immutable*: for
 *     a given payload it is written exactly once and never recomputed.
 *
 * Why freeze instead of resolving on every attempt?
 *
 *  - **Deterministic replay.** A step can be retried, resumed after a crash, or
 *    replayed by an operator. If inputs were re-derived on every attempt, two
 *    attempts of the same step could submit *different* parameters (a
 *    re-quoted price, a re-read balance), which is unacceptable for financial
 *    side effects.
 *  - **Fail-closed.** Resolution is strict: a placeholder that cannot be
 *    resolved, a malformed `$ref`, or a `{{…}}` template token aborts the step
 *    *before* the tool is invoked. An unresolved placeholder is never silently
 *    forwarded to a tool as a literal string.
 *
 * Placeholder grammar — the only two accepted forms:
 *
 *  - Object form: `{ "$ref": "steps.2.result.data.balance" }`
 *  - String form: `"$ref:context.quoteId"`
 *
 * Reference namespaces:
 *
 *  - `steps.<stepNumber>.result[.<path…>]` — the persisted result of a step
 *    that has already completed.
 *  - `context[.<path…>]` — the durable execution's `context` column.
 *  - Any other namespace is rejected.
 *
 * The module deliberately has no TypeORM dependency: callers supply a
 * `StepPersister` (the TypeORM `Repository<DurableStep>` satisfies it
 * structurally), which keeps the resolution and immutability rules unit
 * testable without a database. Hashing reuses the canonical-JSON helper from
 * the capability-revision module so key ordering never changes a hash.
 */

import * as crypto from "crypto";
import { stableStringify } from "../tools/defi/CapabilityRevision";

/** Key of the object form of a step-input reference placeholder. */
export const STEP_INPUT_REF_KEY = "$ref";

/** Prefix of the string form of a step-input reference placeholder. */
export const STEP_INPUT_REF_PREFIX = "$ref:";

/**
 * Mustache-style template token. Prompt templates use this syntax; a step
 * *payload* containing it has not been materialised, so it is rejected rather
 * than forwarded to a tool.
 */
const MUSTACHE_TEMPLATE_PATTERN = /\{\{[^{}]*\}\}/;

/** Machine-readable refusal reasons. */
export type StepInputResolutionErrorCode =
  | "unresolved_reference"
  | "immutable_snapshot"
  | "corrupt_snapshot";

/** A placeholder that was substituted while resolving a step payload. */
export interface StepInputReference {
  /** Location of the placeholder inside the payload, e.g. `"payload.to"`. */
  location: string;
  /** Reference path substituted, e.g. `"steps.1.result.data.balance"`. */
  ref: string;
}

/** The outcome of resolving a payload against a resolution context. */
export interface ResolvedStepInputs {
  /** Fully resolved payload — guaranteed placeholder-free. */
  inputs: Record<string, unknown>;
  /** SHA-256 over the canonical encoding of `inputs`. */
  hash: string;
  /** Placeholders substituted, in traversal order (audit trail). */
  references: StepInputReference[];
}

/** Values available for resolution at the moment a step is about to execute. */
export interface StepInputResolutionContext {
  /**
   * Results of steps that already completed, keyed by `stepNumber`. Presence
   * of the key — not the value — makes a `steps.*` reference resolvable.
   */
  stepResults: Map<number, unknown>;
  /** The parent execution's `context` column. */

/**
 * Structural view of the persistence fields this module reads and writes.
 * `DurableStep` satisfies it; tests can use a plain object.
 */
export interface ResolvableStepLike {
  /** Identifier, used for diagnostics only. */
  id?: string | null;
  /** Ordinal within the plan, used for diagnostics only. */
  stepNumber?: number | null;
  /** The unresolved template the planner produced. */
  payload?: Record<string, unknown> | null;
  /** Frozen resolved inputs; absent until the first execution. */
  resolvedInputs?: Record<string, unknown> | null;
  /** Integrity hash of `resolvedInputs`. */
  resolvedInputsHash?: string | null;
  /** Timestamp the snapshot was frozen. Non-null ⇒ immutable. */
  resolvedAt?: Date | null;
}

/** Minimal repository surface required to persist a frozen step. */
export interface StepPersister {
  save(step: unknown): Promise<unknown>;
}

/** Base class for every refusal raised by step-input resolution. */
export class StepInputResolutionError extends Error {
  /** Machine-readable refusal reason. */
  readonly code: StepInputResolutionErrorCode;
  /** Payload location that triggered the refusal, when known. */
  readonly location?: string;

  constructor(
    code: StepInputResolutionErrorCode,
    message: string,
    location?: string
  ) {
    super(message);
    this.name = "StepInputResolutionError";
    this.code = code;
    this.location = location;
  }
}

/** Raised when a placeholder cannot be resolved to a concrete value. */
export class UnresolvedStepInputError extends StepInputResolutionError {
  constructor(message: string, location?: string) {
    super("unresolved_reference", message, location);
    this.name = "UnresolvedStepInputError";
  }
}

/** Raised when a frozen snapshot would have to be overwritten. */
export class ResolvedInputsImmutableError extends StepInputResolutionError {
  constructor(message: string, location?: string) {
    super("immutable_snapshot", message, location);
    this.name = "ResolvedInputsImmutableError";
  }
}

/** Raised when a persisted snapshot no longer matches its recorded hash. */
export class ResolvedInputsIntegrityError extends StepInputResolutionError {
  constructor(message: string, location?: string) {
    super("corrupt_snapshot", message, location);
    this.name = "ResolvedInputsIntegrityError";
  }
}

/**
 * Type guard for refusals produced by this module.
 *
 * These failures are deterministic — the same payload against the same context
 * fails the same way — so executors must not retry them; they must fail the
 * step closed instead.
 */
export function isStepInputResolutionError(
  error: unknown
): error is StepInputResolutionError {
  return error instanceof StepInputResolutionError;
}

// ---------------------------------------------------------------------------
// Placeholder classification
// ---------------------------------------------------------------------------

type PlaceholderKind = "reference" | "malformed" | "template" | "data";

/** Plain JSON object (not an array, `Date`, or other exotic instance). */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

/**
 * Classify a single value.
 *
 * A well-formed reference is the *entire* value: a string of the form
 * `"$ref:<path>"`, or an object whose only own key is `$ref` and whose value is
 * a non-empty string. Anything else that still looks like placeholder syntax is
 * reported as `malformed` (or `template` for `{{…}}`) so callers fail closed
 * instead of shipping the token to a tool as a literal.
 */
function classifyStepInputValue(value: unknown): PlaceholderKind {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed.startsWith(STEP_INPUT_REF_PREFIX)) {
      return trimmed.slice(STEP_INPUT_REF_PREFIX.length).trim()
        ? "reference"
        : "malformed";
    }
    return MUSTACHE_TEMPLATE_PATTERN.test(trimmed) ? "template" : "data";
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 1 && keys[0] === STEP_INPUT_REF_KEY) {
      const ref = value[STEP_INPUT_REF_KEY];
      return typeof ref === "string" && ref.trim() ? "reference" : "malformed";
    }
  }

  return "data";
}

/**
 * True when the value is a well-formed, unresolved `$ref` placeholder.
 */
export function isStepInputPlaceholder(value: unknown): boolean {
  return classifyStepInputValue(value) === "reference";
}

/**
 * True when the value contains *any* placeholder syntax, well-formed or not.
 *
 * Used to prove a persisted snapshot is fully materialised: a frozen input set
 * must never contain a `$ref` token or a `{{…}}` template.
 */
export function containsUnresolvedPlaceholders(value: unknown): boolean {
  const kind = classifyStepInputValue(value);
  if (kind === "reference" || kind === "malformed" || kind === "template") {
    return true;
  }

  if (Array.isArray(value)) {
    return value.some((entry) => containsUnresolvedPlaceholders(entry));
  }

  if (isPlainObject(value)) {
    return Object.keys(value).some((key) =>
      containsUnresolvedPlaceholders(value[key])
    );
  }

  return false;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Location string for diagnostics, e.g. `payload.legs[0].amount`. */
function joinLocation(parent: string, key: string | number): string {
  return typeof key === "number" ? `${parent}[${key}]` : `${parent}.${key}`;
}

/** Extract the reference path from a well-formed placeholder. */
function readReferencePath(value: unknown): string {
  if (typeof value === "string") {
    return value.trim().slice(STEP_INPUT_REF_PREFIX.length).trim();
  }
  const ref = (value as Record<string, unknown>)[STEP_INPUT_REF_KEY];
  return typeof ref === "string" ? ref.trim() : "";
}

/**
 * Walk `path` into `source`. A missing segment is always a resolution failure —
 * never a silent `undefined` — because an amount that quietly becomes
 * `undefined` is worse than a step that refuses to run.
 */
function readPath(
  source: unknown,
  path: readonly string[],
  ref: string,
  location: string
): unknown {
  let current = source;

  for (const segment of path) {
    if (
      isPlainObject(current) &&
      Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      current = current[segment];
      continue;
    }

    if (
      Array.isArray(current) &&
      /^\d+$/.test(segment) &&
      Number(segment) < current.length
    ) {
      current = current[Number(segment)];
      continue;
    }

    throw new UnresolvedStepInputError(
      `Step input reference "${ref}" cannot be resolved: segment "${segment}" is not present`,
      location
    );
  }

  return current;
}

/** Resolve a single `$ref` path against the resolution context. */
function resolveReference(
  ref: string,
  ctx: StepInputResolutionContext,
  location: string
): unknown {
  const segments = ref
    .split(".")
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    throw new UnresolvedStepInputError(
      `Empty step input reference at "${location}"`,
      location
    );
  }

  const [namespace, ...rest] = segments;

  if (namespace === "context") {
    return readPath(ctx.context, rest, ref, location);
  }

  if (namespace === "steps") {
    const stepNumber = Number(rest[0]);

    if (!Number.isInteger(stepNumber) || stepNumber <= 0) {
      throw new UnresolvedStepInputError(
        `Step input reference "${ref}" must name a positive step number`,
        location
      );
    }

    if (rest[1] !== "result") {
      throw new UnresolvedStepInputError(
        `Step input reference "${ref}" must address "steps.<n>.result"`,
        location
      );
    }

    if (!ctx.stepResults.has(stepNumber)) {
      throw new UnresolvedStepInputError(
        `Step input reference "${ref}" cannot be resolved: step ${stepNumber} has not completed`,
        location
      );
    }

    return readPath(ctx.stepResults.get(stepNumber), rest.slice(2), ref, location);
  }

  throw new UnresolvedStepInputError(
    `Step input reference "${ref}" uses unknown namespace "${namespace}" (expected "steps" or "context")`,
    location
  );
}

/**
 * Resolve every placeholder in `payload` against `ctx`.
 *
 * Throws {@link UnresolvedStepInputError} — and therefore returns nothing —
 * when any placeholder is unresolvable, malformed, or a `{{…}}` template. The
 * returned payload is a deep copy: `payload` itself is never mutated, so the
 * template survives for audit and operator inspection.
 */
export function resolveStepInputs(
  payload: Record<string, unknown>,
  ctx: StepInputResolutionContext
): ResolvedStepInputs {
  const references: StepInputReference[] = [];

  const resolveValue = (value: unknown, location: string): unknown => {
    const kind = classifyStepInputValue(value);

    if (kind === "malformed") {
      throw new UnresolvedStepInputError(
        `Malformed step input placeholder at "${location}": expected a non-empty "${STEP_INPUT_REF_PREFIX}" path`,
        location
      );
    }

    if (kind === "template") {
      throw new UnresolvedStepInputError(
        `Unmaterialised template placeholder at "${location}": "{{…}}" tokens must be resolved to concrete values before a step executes`,
        location
      );
    }

    if (kind === "reference") {
      const ref = readReferencePath(value);
      // Substituted values are inserted verbatim (never re-traversed) so a
      // `$ref`-shaped object coming from a previous step's result cannot be
      // mistaken for a second placeholder.
      const resolved = resolveReference(ref, ctx, location);
      references.push({ location, ref });
      return resolved;
    }

    if (Array.isArray(value)) {
      return value.map((entry, index) =>
        resolveValue(entry, joinLocation(location, index))
      );
    }

    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(value)) {
        out[key] = resolveValue(value[key], joinLocation(location, key));
      }
      return out;
    }

    return value;
  };

  const inputs = resolveValue(payload, "payload") as Record<string, unknown>;

  // Defence in depth: if the *resolved* payload still contains placeholder
  // syntax (e.g. a referenced value carried a `$ref`-shaped object), freezing
  // it would make "resolved" and "unresolved" indistinguishable. Refuse.
  if (containsUnresolvedPlaceholders(inputs)) {
    throw new UnresolvedStepInputError(
      "Resolved step inputs still contain placeholder syntax; refusing to freeze ambiguous inputs",
      "payload"
    );
  }

  return { inputs, hash: hashResolvedInputs(inputs), references };
}

// ---------------------------------------------------------------------------
// Hashing
// ---------------------------------------------------------------------------

/** SHA-256 over the canonical (key-sorted) encoding of resolved inputs. */
export function hashResolvedInputs(inputs: unknown): string {
  return crypto
    .createHash("sha256")
    .update(stableStringify(inputs))
    .digest("hex");
}

/** Human-readable identifier used in refusals and audit logs. */
function stepLabel(step: ResolvableStepLike): string {
  if (step.stepNumber != null) return `step ${step.stepNumber}`;
  if (step.id) return `step ${step.id}`;
  return "step";
}

// ---------------------------------------------------------------------------
// Frozen snapshots
// ---------------------------------------------------------------------------

/**
 * Collect the results of steps that already hold a persisted result.
 *
 * A step whose result is `null`/`undefined` is deliberately *not* addressable:
 * injecting a null into a financial payload is never what a reference meant, so
 * a `steps.<n>.result` reference to such a step fails closed instead.
 */
export function collectCompletedStepResults(
  steps: ReadonlyArray<{ stepNumber: number; result?: unknown }>
): Map<number, unknown> {
  const results = new Map<number, unknown>();

  for (const step of steps) {
    if (step.result === undefined || step.result === null) continue;
    results.set(step.stepNumber, step.result);
  }

  return results;
}

/** True when the step carries a well-formed, hash-anchored snapshot. */
export function isResolvedStepInputsSnapshot(step: ResolvableStepLike): boolean {
  return (
    step.resolvedInputs != null &&
    typeof step.resolvedInputsHash === "string" &&
    step.resolvedInputsHash.length > 0 &&
    step.resolvedAt != null
  );
}

/**
 * Read back a frozen snapshot, verifying that it is intact and fully
 * materialised. Any mismatch is a hard failure: replaying a step with inputs
 * that cannot be trusted is exactly the outcome this design exists to prevent.
 */
export function readFrozenStepInputs(
  step: ResolvableStepLike
): Record<string, unknown> {
  const inputs = step.resolvedInputs;

  if (inputs == null) {
    throw new ResolvedInputsIntegrityError(
      `${stepLabel(step)} is marked as having frozen inputs but stores none`
    );
  }

  if (
    typeof step.resolvedInputsHash !== "string" ||
    step.resolvedInputsHash.length === 0
  ) {
    throw new ResolvedInputsIntegrityError(
      `Frozen inputs for ${stepLabel(step)} are missing their integrity hash`
    );
  }

  if (containsUnresolvedPlaceholders(inputs)) {
    throw new ResolvedInputsIntegrityError(
      `Frozen inputs for ${stepLabel(step)} still contain an unresolved placeholder`
    );
  }

  const expected = hashResolvedInputs(inputs);
  if (expected !== step.resolvedInputsHash) {
    throw new ResolvedInputsIntegrityError(
      `Frozen inputs for ${stepLabel(step)} do not match their recorded hash ` +
        `(recorded ${step.resolvedInputsHash}, computed ${expected})`
    );
  }

  return inputs;
}

/** Options for {@link resolveAndFreezeStepInputs}. */
export interface FreezeStepInputsOptions {
  /** Injectable clock, for deterministic tests. Defaults to `new Date()`. */
  now?: () => Date;
}

/**
 * Resolve a step's template and persist the frozen inputs **before** the caller
 * invokes the step's tool.
 *
 * - First attempt: resolves `step.payload` against `ctx`, writes
 *   `resolvedInputs` / `resolvedInputsHash` / `resolvedAt`, and awaits the
 *   persistence before returning, so the snapshot is durable before any side
 *   effect.
 * - Later attempts (retry, resume, operator replay): the persisted snapshot is
 *   verified and returned verbatim, so the replayed attempt submits identical
 *   inputs even if the underlying quote, balance or context has since changed.
 *
 * @throws {@link StepInputResolutionError} when the template cannot be resolved
 *   (`unresolved_reference`) or a stored snapshot is unusable
 *   (`corrupt_snapshot`). In both cases nothing new is persisted and the caller
 *   must not invoke the tool.
 */
export async function resolveAndFreezeStepInputs(
  step: ResolvableStepLike,
  ctx: StepInputResolutionContext,
  persister: StepPersister,
  options: FreezeStepInputsOptions = {}
): Promise<Record<string, unknown>> {
  // Presence of either field means "a snapshot was taken": never overwrite it.
  if (step.resolvedInputs != null || step.resolvedAt != null) {
    return readFrozenStepInputs(step);
  }

  const { inputs, hash } = resolveStepInputs(step.payload ?? {}, ctx);

  step.resolvedInputs = inputs;
  step.resolvedInputsHash = hash;
  step.resolvedAt = (options.now ?? (() => new Date()))();

  // Durability point: the snapshot is persisted before the side effect.
  await persister.save(step);

  return inputs;
}

/**
 * Drop a frozen snapshot, returning the superseded hash for the audit log.
 *
 * Only an explicit operator payload replacement may call this. The recovery
 * contract is that a step replays its frozen inputs, so clearing them has to be
 * an authorised, logged act instead of an automatic side effect of a retry.
 */
export function clearResolvedStepInputs(
  step: ResolvableStepLike
): string | null {
  const superseded = step.resolvedInputsHash ?? null;
  step.resolvedInputs = null;
  step.resolvedInputsHash = null;
  step.resolvedAt = null;
  return superseded;
}




  context: Record<string, unknown>;
}
