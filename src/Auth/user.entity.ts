import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity()
export class User {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, type: "varchar" })
  name!: string;

  @Column({ type: "varchar" })
  address!: string;

  @Column({ type: "varchar" })
  encryptedPrivateKey!: string;

  @Column({ type: "varchar", default: "XLM" })
  tokenType!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
