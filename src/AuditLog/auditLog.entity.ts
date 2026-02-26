import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from "typeorm";

export enum AuditAction {
  // Authentication actions
  LOGIN_SUCCESS = "login_success",
  LOGIN_FAILED = "login_failed",
  LOGOUT = "logout",
  TOKEN_REFRESH = "token_refresh",
  PASSWORD_RESET_REQUEST = "password_reset_request",
  PASSWORD_RESET_SUCCESS = "password_reset_success",
  PASSWORD_RESET_FAILED = "password_reset_failed",
  EMAIL_VERIFICATION_SENT = "email_verification_sent",
  EMAIL_VERIFICATION_SUCCESS = "email_verification_success",

  // User management
  USER_CREATED = "user_created",
  USER_UPDATED = "user_updated",
  USER_DELETED = "user_deleted",

  // Trading/Transaction actions
  TRADE_INITIATED = "trade_initiated",
  TRADE_CONFIRMED = "trade_confirmed",
  TRADE_FAILED = "trade_failed",
  SWAP_EXECUTED = "swap_executed",
  TRANSFER_INITIATED = "transfer_initiated",
  TRANSFER_COMPLETED = "transfer_completed",

  // Wallet actions
  WALLET_FUNDED = "wallet_funded",
  WALLET_DEPLOYED = "wallet_deployed",

  // Security events
  UNAUTHORIZED_ACCESS = "unauthorized_access",
  PERMISSION_DENIED = "permission_denied",
  SUSPICIOUS_ACTIVITY = "suspicious_activity",

  // Data access
  DATA_EXPORT = "data_export",
  SENSITIVE_DATA_ACCESS = "sensitive_data_access",
}

export enum AuditSeverity {
  INFO = "info",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
}

@Entity()
@Index(["userId", "createdAt"])
@Index(["action", "createdAt"])
@Index(["severity", "createdAt"])
export class AuditLog {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar", nullable: true })
  @Index()
  userId?: string;

  @Column({ type: "varchar" })
  action!: AuditAction;

  @Column({ type: "varchar", default: AuditSeverity.INFO })
  severity!: AuditSeverity;

  @Column({ type: "varchar", nullable: true })
  ipAddress?: string;

  @Column({ type: "varchar", nullable: true })
  userAgent?: string;

  @Column({ type: "varchar", nullable: true })
  resource?: string;

  @Column({ type: "jsonb", nullable: true })
  metadata?: Record<string, unknown>;

  @Column({ type: "text", nullable: true })
  errorMessage?: string;

  @Column({ type: "boolean", default: true })
  success!: boolean;

  @CreateDateColumn()
  @Index()
  createdAt!: Date;
}
