import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from "typeorm";
import { User } from "./user.entity";

@Entity()
@Index("IDX_refresh_token_user_id", ["userId"])
@Index("IDX_refresh_token_expires_at", ["expiresAt"])
@Index("IDX_refresh_token_user_not_revoked", ["userId", "isRevoked"])
export class RefreshToken {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  @Index("IDX_refresh_token_token")
  token!: string;

  @Column({ type: "uuid" })
  @Index("IDX_refresh_token_user_id_column")
  userId!: string;

  @ManyToOne(() => User, { onDelete: "CASCADE" })
  @JoinColumn({ name: "userId" })
  user!: User;

  @Column({ type: "timestamp" })
  expiresAt!: Date;

  @Column({ type: "boolean", default: false })
  isRevoked!: boolean;

  @Column({ type: "varchar", nullable: true })
  replacedByToken?: string;

  @Column({ type: "varchar", nullable: true })
  revokedReason?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
