import { MigrationInterface, QueryRunner } from "typeorm";

export class AddWebhookIdempotency1772100000000 implements MigrationInterface {
  name = "AddWebhookIdempotency1772100000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "webhook_idempotency" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "webhookId" character varying(255) NOT NULL,
        "platform" character varying(50) NOT NULL,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_webhook_idempotency_id" PRIMARY KEY ("id")
      )`
    );

    // Create unique index on webhookId and platform combination
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_webhook_idempotency_webhook_platform" 
       ON "webhook_idempotency" ("webhookId", "platform")`
    );

    // Create index on createdAt for efficient cleanup queries
    await queryRunner.query(
      `CREATE INDEX "IDX_webhook_idempotency_created_at" 
       ON "webhook_idempotency" ("createdAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_webhook_idempotency_created_at"`);
    await queryRunner.query(
      `DROP INDEX "IDX_webhook_idempotency_webhook_platform"`
    );
    await queryRunner.query(`DROP TABLE "webhook_idempotency"`);
  }
}
