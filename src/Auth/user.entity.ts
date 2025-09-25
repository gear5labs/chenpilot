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
  
  @Column({ type: "boolean", default: false })
  isDeployed!: boolean;

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

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
