import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

/**
 * Entity for tracking processed webhooks to ensure idempotency
 * Prevents duplicate processing of webhooks from Telegram, Discord, and other platforms
 */
@Entity()
@Index(["webhookId", "platform"], { unique: true })
@Index(["createdAt"])
export class WebhookIdempotency {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", length: 255 })
  webhookId!: string;

  @Column({ type: "varchar", length: 50 })
  platform!: "telegram" | "discord" | "stellar" | string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  createdAt!: Date;
}
