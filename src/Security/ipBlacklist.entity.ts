import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

export enum BlacklistReason {
  BRUTE_FORCE = "brute_force",
  MALICIOUS_ACTIVITY = "malicious_activity",
  DDOS_ATTACK = "ddos_attack",
  SPAM = "spam",
  UNAUTHORIZED_ACCESS = "unauthorized_access",
  EXPLOIT_ATTEMPT = "exploit_attempt",
  MANUAL_BAN = "manual_ban",
  SUSPICIOUS_PATTERN = "suspicious_pattern",
  GEOGRAPHIC_RESTRICTION = "geographic_restriction",
  OTHER = "other",
}

@Entity()
@Index(["ipAddress"])
@Index(["isActive", "expiresAt"])
@Index(["reason", "createdAt"])
export class IPBlacklist {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", unique: true })
  @Index()
  ipAddress!: string;

  @Column({ type: "varchar", default: BlacklistReason.MALICIOUS_ACTIVITY })
  reason!: BlacklistReason;

  @Column({ type: "text", nullable: true })
  description?: string;

  @Column({ type: "boolean", default: true })
  @Index()
  isActive!: boolean;

  @Column({ type: "timestamp", nullable: true })
  @Index()
  expiresAt?: Date;

  @Column({ type: "integer", default: 0 })
  blockCount!: number;

  @Column({ type: "timestamp", nullable: true })
  lastBlockedAt?: Date;

  @Column({ type: "varchar", nullable: true })
  addedBy?: string;

  @Column({ type: "simple-json", nullable: true })
  metadata?: Record<string, unknown>;

  @CreateDateColumn()
  @Index()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;

  /**
   * Check if this blacklist entry is currently active
   */
  isCurrentlyBlocked(): boolean {
    if (!this.isActive) {
      return false;
    }

    if (this.expiresAt) {
      return new Date() < this.expiresAt;
    }

    return true;
  }
}
