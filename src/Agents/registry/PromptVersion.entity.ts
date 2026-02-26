import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity()
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
export class PromptMetric {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid")
  promptVersionId!: string;

  @Column("uuid", { nullable: true })
  userId?: string;

  @Column()
  success!: boolean;

  @Column({ nullable: true })
  responseTime?: number;

  @Column("jsonb", { nullable: true })
  metadata?: Record<string, any>;

  @CreateDateColumn()
  createdAt!: Date;
}
