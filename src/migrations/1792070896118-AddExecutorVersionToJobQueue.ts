import { MigrationInterface, QueryRunner } from "typeorm";

export class AddExecutorVersionToJobQueue1792070896118 implements MigrationInterface {
    name = 'AddExecutorVersionToJobQueue1792070896118'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "job_queue" ADD "executorVersion" character varying(50)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "job_queue" DROP COLUMN "executorVersion"`);
    }
}
