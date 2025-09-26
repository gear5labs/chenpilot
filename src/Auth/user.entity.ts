import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

export enum AuthProvider {
  EMAIL = "email",
  GOOGLE = "google",
}

@Entity()
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, type: "varchar", nullable: true })
  email?: string;

  @Column({ type: "varchar", nullable: true })
  password?: string;

  @Column({ type: "varchar", nullable: true })
  name?: string;

  @Column({ type: "varchar", nullable: true })
  address?: string;

  @Column({ type: "varchar", nullable: true })
  pk?: string;

  @Column({ type: "varchar", nullable: true })
  publicKey?: string;

  @Column({ type: "varchar", nullable: true })
  addressSalt?: string;

  @Column({ type: "text", nullable: true })
  constructorCalldata?: string;
  
  @Column({ type: "boolean", default: false })
  isDeployed!: boolean;

  @Column({ type: "varchar", nullable: true })
  deploymentTransactionHash?: string;

  @Column({ type: "varchar", default: "STRK" })
  tokenType!: string;

  @Column({ type: "enum", enum: AuthProvider, default: AuthProvider.EMAIL })
  authProvider!: AuthProvider;

  @Column({ type: "varchar", nullable: true })
  googleId?: string;

  @Column({ type: "varchar", nullable: true })
  profilePicture?: string;

  @Column({ type: "boolean", default: false })
  isEmailVerified!: boolean;

  @Column({ type: "varchar", nullable: true })
  emailVerificationToken?: string;

  @Column({ type: "varchar", nullable: true })
  passwordResetToken?: string;

  @Column({ type: "timestamp", nullable: true })
  passwordResetExpires?: Date;

  @Column({ type: "boolean", default: false })
  isFunded!: boolean;

  @Column({ type: "varchar", nullable: true })
  fundingTransactionHash?: string;

  @Column({ type: "timestamp", nullable: true })
  fundedAt?: Date;

  @Column({ type: "boolean", default: false })
  isDeploymentPending!: boolean;

  @Column({ type: "timestamp", nullable: true })
  deploymentRequestedAt?: Date;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
