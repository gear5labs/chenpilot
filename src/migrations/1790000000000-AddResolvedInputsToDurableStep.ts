import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddResolvedInputsToDurableStep (issue #809)
 *
 * Appends three nullable audit columns to `durable_step` so that the inputs a
 * step actually executed with are frozen durably *before* the step's side
 * effect is invoked:
 *
 *   - `resolvedInputs`       JSONB      – fully resolved payload handed to the
 *                                        tool. Written exactly once per
 *                                        payload; reused verbatim on every
 *                                        retry, resume and replay.
 *   - `resolvedInputsHash`   VARCHAR(64) – SHA-256 of the canonical encoding
 *                                        of `resolvedInputs`; integrity anchor.
 *   - `resolvedAt`           TIMESTAMP WITHOUT TIME ZONE – when the snapshot
 *                                        was frozen. Non-null ⇒ immutable.
 *
 * `durable_step.payload` keeps holding the unresolved planner template; the
 * two are intentionally distinct so an audit can tell a template apart from
 * the concrete inputs a step submitted.
 *
 * All three columns are nullable, so existing rows (steps created before this
 * migration) need no back-fill: a legacy step simply has no snapshot and will
 * freeze one on its next attempt.
 */
export class AddResolvedInputsToDurableStep1790000000000
  implements MigrationInterface
{
  name = "AddResolvedInputsToDurableStep1790000000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "durable_step"
         ADD COLUMN IF NOT EXISTS "resolvedInputs"      JSONB,
         ADD COLUMN IF NOT EXISTS "resolvedInputsHash"  VARCHAR(64),
         ADD COLUMN IF NOT EXISTS "resolvedAt"          TIMESTAMP WITHOUT TIME ZONE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "durable_step"
         DROP COLUMN IF EXISTS "resolvedInputs",
         DROP COLUMN IF EXISTS "resolvedInputsHash",
         DROP COLUMN IF EXISTS "resolvedAt"`
    );
  }
}
