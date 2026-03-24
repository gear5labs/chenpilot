import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  Index,
} from "typeorm";

@Entity()
@Index("IDX_agent_tool_is_active", ["isActive"])
@Index("IDX_agent_tool_deleted_at", ["deletedAt"])
export class AgentTool {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, type: "varchar" })
  name!: string; // Unique tool name

  @Column({ type: "varchar" })
  description!: string; // Tool description

  @Column({ type: "jsonb", nullable: true })
  parameters?: object;
  // Optional JSON object to store input schema, e.g. { assetCode: "USDC", depthLimit: 10 }

  @Column({ type: "boolean", default: true })
  isActive!: boolean; // Admin toggle for enabling/disabling the tool

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  @DeleteDateColumn({ nullable: true })
  deletedAt?: Date; // Soft delete: timestamp when the tool was disabled
}
