import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export type RiskLevel = "low" | "medium" | "high";

@Entity()
export class UserPreferences {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  userId!: string;

  @Column({ type: "varchar", default: "medium" })
  riskLevel!: RiskLevel;

  @Column({ type: "simple-array", default: "XLM,STRK" })
  preferredAssets!: string;

  @Column({ type: "boolean", default: false })
  autoApproveSmallTransactions!: boolean;

  @Column({ type: "decimal", precision: 10, scale: 2, default: 10 })
  smallTransactionThreshold!: number;

  @Column({ type: "varchar", nullable: true })
  notificationSettings!: string | null;

  @Column({ type: "varchar", nullable: true })
  defaultSlippage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
