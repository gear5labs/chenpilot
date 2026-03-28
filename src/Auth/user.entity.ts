import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity()
@Index("IDX_user_email", ["email"])
@Index("IDX_user_address", ["address"])
@Index("IDX_user_is_email_verified", ["isEmailVerified"])
@Index("IDX_user_role", ["role"])
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, type: "varchar" })
  @Index()
  name!: string;

  @Column({ type: "varchar", nullable: true, unique: true })
  @Index("IDX_user_email_column")
  email?: string;

  @Column({ type: "varchar", nullable: true })
  password?: string;

  @Column({ type: "varchar" })
  @Index("IDX_user_address_column")
  address!: string;

  @Column({ type: "varchar" })
  pk!: string;

  @Column({ type: "boolean", default: false })
  isDeployed!: boolean;

  @Column({ type: "boolean", default: false })
  isFunded!: boolean;

  @Column({ type: "boolean", default: false })
  isEmailVerified!: boolean;

  @Column({ type: "varchar", default: "STRK" })
  encryptedPrivateKey!: string;

  @Column({ type: "varchar", default: "XLM" })
  tokenType!: string;

  @Column({ type: "varchar", default: "user" })
  @Index()
  role!: string;

  @Column({ type: "varchar", nullable: true })
  resetTokenHash?: string;

  @Column({ type: "timestamp", nullable: true })
  resetTokenExpiry?: Date;

  @CreateDateColumn()
  @Index()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
