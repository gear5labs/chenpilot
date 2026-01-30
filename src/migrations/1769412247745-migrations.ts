import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1769412247745 implements MigrationInterface {
    name = 'Migrations1769412247745'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "user" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying NOT NULL,
                "address" character varying NOT NULL,
                "encryptedPrivateKey" character varying NOT NULL,
                "tokenType" character varying NOT NULL DEFAULT 'XLM',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_065d4d8f3b5adb4a08841eae3c8" UNIQUE ("name"),
                CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id")
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TABLE "user"
        `);
    }

}
