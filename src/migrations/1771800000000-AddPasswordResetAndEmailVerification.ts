import { MigrationInterface, QueryRunner } from "typeorm";

export class AddPasswordResetAndEmailVerification1771800000000 implements MigrationInterface {
  name = "AddPasswordResetAndEmailVerification1771800000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "email" character varying UNIQUE`
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "password" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "isEmailVerified" boolean NOT NULL DEFAULT false`
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "resetTokenHash" character varying`
    );
    await queryRunner.query(
      `ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "resetTokenExpiry" TIMESTAMP`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "resetTokenExpiry"`
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "resetTokenHash"`
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "isEmailVerified"`
    );
    await queryRunner.query(
      `ALTER TABLE "user" DROP COLUMN IF EXISTS "password"`
    );
    await queryRunner.query(`ALTER TABLE "user" DROP COLUMN IF EXISTS "email"`);
  }
}
