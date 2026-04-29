import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum BotSessionType {
  MULTISIG_WIZARD = "multisig_wizard",
  SWAP_WIZARD = "swap_wizard",
  CUSTOM_FLOW = "custom_flow",
}

export enum BotPlatform {
  DISCORD = "discord",
  TELEGRAM = "telegram",
}

@Entity()
@Index(["userId", "platform"])
@Index(["sessionType", "createdAt"])
@Index(["platform", "userId", "expiresAt"])
export class BotSession {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  @Index()
  userId!: string;

  @Column({ type: "enum", enum: BotPlatform })
  platform!: BotPlatform;

  @Column({ type: "enum", enum: BotSessionType })
  sessionType!: BotSessionType;

  @Column({ type: "int" })
  step!: number;

  @Column({ type: "jsonb" })
  sessionData!: Record<string, unknown>;

  @Column({ type: "timestamp", nullable: true })
  expiresAt?: Date;

  @Column({ type: "boolean", default: true })
  isActive!: boolean;

  @CreateDateColumn()
  @Index()
  createdAt!: Date;

  @UpdateDateColumn()
  @Index()
  updatedAt!: Date;
}
