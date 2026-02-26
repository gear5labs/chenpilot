import { MigrationInterface, QueryRunner, Table, TableIndex } from "typeorm";

export class CreateAuditLogTable1740499200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "audit_log",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "userId",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "action",
            type: "varchar",
            isNullable: false,
          },
          {
            name: "severity",
            type: "varchar",
            default: "'info'",
          },
          {
            name: "ipAddress",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "userAgent",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "resource",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "metadata",
            type: "jsonb",
            isNullable: true,
          },
          {
            name: "errorMessage",
            type: "text",
            isNullable: true,
          },
          {
            name: "success",
            type: "boolean",
            default: true,
          },
          {
            name: "createdAt",
            type: "timestamp",
            default: "now()",
          },
        ],
      }),
      true
    );

    // Create indexes for better query performance
    await queryRunner.createIndex(
      "audit_log",
      new TableIndex({
        name: "IDX_AUDIT_LOG_USER_CREATED",
        columnNames: ["userId", "createdAt"],
      })
    );

    await queryRunner.createIndex(
      "audit_log",
      new TableIndex({
        name: "IDX_AUDIT_LOG_ACTION_CREATED",
        columnNames: ["action", "createdAt"],
      })
    );

    await queryRunner.createIndex(
      "audit_log",
      new TableIndex({
        name: "IDX_AUDIT_LOG_SEVERITY_CREATED",
        columnNames: ["severity", "createdAt"],
      })
    );

    await queryRunner.createIndex(
      "audit_log",
      new TableIndex({
        name: "IDX_AUDIT_LOG_CREATED",
        columnNames: ["createdAt"],
      })
    );

    await queryRunner.createIndex(
      "audit_log",
      new TableIndex({
        name: "IDX_AUDIT_LOG_USER",
        columnNames: ["userId"],
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable("audit_log");
  }
}
