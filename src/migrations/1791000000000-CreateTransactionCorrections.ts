import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableColumn,
  TableIndex,
} from "typeorm";

/**
 * CreateTransactionCorrections
 *
 * Append-only audit trail for manual corrections to transaction state
 * (quarantine resolutions, dispute outcomes, operator repairs). Each row
 * preserves the previous state, the new state, and the source evidence the
 * correction was based on, plus a SHA-256 over the canonical evidence
 * payload so tampering is detectable.
 *
 * Also adds `invariant_results` / `invariant_summary` JSONB columns to
 * `reconciliation_reports` — the report builder already computed these but
 * `persistReport` dropped them.
 */
export class CreateTransactionCorrections1791000000000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: "transaction_corrections",
        columns: [
          { name: "id", type: "uuid", isPrimary: true },
          { name: "report_id", type: "uuid", isNullable: true },
          { name: "entity_id", type: "varchar", length: "255", isNullable: true },
          { name: "tx_hash", type: "varchar", length: "255", isNullable: true },
          { name: "correction_type", type: "varchar", length: "64", isNullable: false },
          { name: "previous_state", type: "jsonb", isNullable: true },
          { name: "new_state", type: "jsonb", isNullable: true },
          { name: "source_evidence", type: "jsonb", isNullable: true },
          { name: "corrected_by", type: "varchar", length: "255", isNullable: true },
          { name: "reason", type: "text", isNullable: true },
          { name: "evidence_sha256", type: "varchar", length: "64", isNullable: false },
          {
            name: "created_at",
            type: "timestamp",
            isNullable: false,
            default: "now()",
          },
        ],
      }),
      true
    );

    await queryRunner.createIndex(
      "transaction_corrections",
      new TableIndex({
        name: "IDX_TX_CORRECTIONS_ENTITY",
        columnNames: ["entity_id"],
      })
    );
    await queryRunner.createIndex(
      "transaction_corrections",
      new TableIndex({
        name: "IDX_TX_CORRECTIONS_TX_HASH",
        columnNames: ["tx_hash"],
      })
    );
    await queryRunner.createIndex(
      "transaction_corrections",
      new TableIndex({
        name: "IDX_TX_CORRECTIONS_CREATED",
        columnNames: ["created_at"],
      })
    );

    await queryRunner.addColumn(
      "reconciliation_reports",
      new TableColumn({
        name: "invariant_results",
        type: "jsonb",
        isNullable: true,
      })
    );
    await queryRunner.addColumn(
      "reconciliation_reports",
      new TableColumn({
        name: "invariant_summary",
        type: "jsonb",
        isNullable: true,
      })
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("reconciliation_reports", "invariant_summary");
    await queryRunner.dropColumn("reconciliation_reports", "invariant_results");
    await queryRunner.dropTable("transaction_corrections");
  }
}
