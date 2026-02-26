import { MigrationInterface, QueryRunner } from "typeorm";

export class CreatePromptVersion1740225557000 implements MigrationInterface {
  name = "CreatePromptVersion1740225557000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "prompt_version" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying NOT NULL,
        "type" character varying NOT NULL,
        "content" text NOT NULL,
        "version" character varying NOT NULL,
        "isActive" boolean NOT NULL DEFAULT false,
        "weight" integer NOT NULL DEFAULT 50,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_prompt_version" PRIMARY KEY ("id")
      )`
    );

    await queryRunner.query(
      `CREATE TABLE "prompt_metric" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "promptVersionId" uuid NOT NULL,
        "userId" uuid,
        "success" boolean NOT NULL,
        "responseTime" integer,
        "metadata" jsonb,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_prompt_metric" PRIMARY KEY ("id")
      )`
    );

    await queryRunner.query(
      `ALTER TABLE "prompt_metric" ADD CONSTRAINT "FK_prompt_metric_version" 
       FOREIGN KEY ("promptVersionId") REFERENCES "prompt_version"("id") ON DELETE CASCADE`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "prompt_metric"`);
    await queryRunner.query(`DROP TABLE "prompt_version"`);
  }
}
