import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from "typeorm";

@Entity()
export class UserPreferenceProvenance {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ type: "varchar" })
  userId!: string;

  @Column({ type: "varchar" })
  changedBy!: string;

  @Column({ type: "text" })
  changes!: string;

  @Column({ type: "varchar", nullable: true })
  reason?: string;

  @CreateDateColumn()
  createdAt!: Date;
}
