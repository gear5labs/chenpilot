import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from "typeorm";

export class AddRefreshToken1769500000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "refresh_token",
        columns: [
          {
            name: "id",
            type: "uuid",
            isPrimary: true,
            generationStrategy: "uuid",
            default: "uuid_generate_v4()",
          },
          {
            name: "token",
            type: "varchar",
            isNullable: false,
          },
          {
            name: "userId",
            type: "uuid",
            isNullable: false,
          },
          {
            name: "expiresAt",
            type: "timestamp",
            isNullable: false,
          },
          {
            name: "isRevoked",
            type: "boolean",
            default: false,
          },
          {
            name: "replacedByToken",
            type: "varchar",
            isNullable: true,
          },
          {
            name: "revokedReason",
            type: "varchar",
            isNullable: true,
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

    // Create index on token column for fast lookups
    await queryRunner.createIndex(
      "refresh_token",
      new TableIndex({
        name: "IDX_REFRESH_TOKEN",
        columnNames: ["token"],
      })
    );

    // Create foreign key to user table
    await queryRunner.createForeignKey(
      "refresh_token",
      new TableForeignKey({
        columnNames: ["userId"],
        referencedColumnNames: ["id"],
        referencedTableName: "user",
        onDelete: "CASCADE",
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable("refresh_token");
    if (table) {
      const foreignKey = table.foreignKeys.find(
        (fk) => fk.columnNames.indexOf("userId") !== -1
      );
      if (foreignKey) {
        await queryRunner.dropForeignKey("refresh_token", foreignKey);
      }
    }

    await queryRunner.dropIndex("refresh_token", "IDX_REFRESH_TOKEN");
    await queryRunner.dropTable("refresh_token");
  }
}
