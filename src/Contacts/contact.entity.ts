import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from "typeorm";

@Entity()
@Index("IDX_contact_address", ["address"])
@Index("IDX_contact_token_type", ["tokenType"])
export class Contact {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column({ unique: true, type: "varchar" })
  @Index("IDX_contact_name")
  name!: string;

  @Column({ type: "varchar" })
  @Index("IDX_contact_address_column")
  address!: string;

  @Column({ type: "varchar", default: "STRK" })
  @Index("IDX_contact_token_type_column")
  tokenType!: string;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
