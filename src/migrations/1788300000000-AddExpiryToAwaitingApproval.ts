import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * AddExpiryToAwaitingApproval
 *
 * Adds `expiresAt` TIMESTAMP columns to tables that store workflows awaiting
 * external approval. This enables automatic expiry enforcement for:
 *
 *   - `durable_execution` – plan-level approvals
 *   - `durable_step` – step-level approvals
 *   - `intervention_records` – intervention approvals
 *
 * All columns are nullable so that no existing rows need to be back-filled.
 * New rows will have expiresAt set when entering AWAITING_APPROVAL or
 * PENDING_APPROVAL status.
 *
 * ### Rollback safety
 * The `down()` migration simply drops the added columns.
 */
export class AddExpiryToAwaitingApproval1788300000000
  implements MigrationInterface
{
  name = "AddExpiryToAwaitingApproval1788300000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Add expiresAt to durable_execution
    await queryRunner.query(
      `ALTER TABLE "durable_execution"
         ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP WITHOUT TIME ZONE`
    );

    // Add expiresAt to durable_step
    await queryRunner.query(
      `ALTER TABLE "durable_step"
         ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP WITHOUT TIME ZONE`
    );

    // Add expiresAt to intervention_records
    await queryRunner.query(
      `ALTER TABLE "intervention_records"
         ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP WITHOUT TIME ZONE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Remove expiresAt from all three tables
    await queryRunner.query(
      `ALTER TABLE "durable_execution"
         DROP COLUMN IF EXISTS "expiresAt"`
    );

    await queryRunner.query(
      `ALTER TABLE "durable_step"
         DROP COLUMN IF EXISTS "expiresAt"`
    );

    await queryRunner.query(
      `ALTER TABLE "intervention_records"
         DROP COLUMN IF EXISTS "expiresAt"`
    );
  }
}
