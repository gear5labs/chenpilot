import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity()
@Index("IDX_prompt_version_name", ["name"])
@Index("IDX_prompt_version_type", ["type"])
@Index("IDX_prompt_version_is_active", ["isActive"])
@Index("IDX_prompt_version_type_active", ["type", "isActive"])
export class PromptVersion {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  name!: string;

  @Column()
  type!: string;

  @Column("text")
  content!: string;

  @Column()
  version!: string;

  @Column({ default: false })
  isActive!: boolean;

  @Column({ default: 50 })
  weight!: number;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

@Entity()
@Index("IDX_prompt_metric_prompt_version", ["promptVersionId"])
@Index("IDX_prompt_metric_user_id", ["userId"])
@Index("IDX_prompt_metric_success", ["success"])
@Index("IDX_prompt_metric_prompt_success", ["promptVersionId", "success"])
export class PromptMetric {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  @Index("IDX_prompt_metric_prompt_version_column")
  promptVersionId!: string;

  @Column("uuid", { nullable: true })
  @Index("IDX_prompt_metric_user_id_column")
  userId?: string;

  @Column()
  @Index("IDX_prompt_metric_success_column")
  success!: boolean;

  @Column({ nullable: true })
  responseTime?: number;

  @Column("jsonb", { nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;
}
