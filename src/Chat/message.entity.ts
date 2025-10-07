import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, ManyToOne, JoinColumn } from "typeorm";
import { Conversation } from "./conversation.entity";

@Entity()
export class Message {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column()
  conversationId!: string;

  @Column()
  role!: "user" | "agent";

  @Column("text")
  content!: string;

  @Column("json", { nullable: true })
  metadata?: {
    success?: boolean;
    error?: string;
    transactionHash?: string;
    type?: string;
    action?: string;
    amount?: string;
    asset?: string;
    requiresConfirmation?: boolean;
  };

  @ManyToOne(() => Conversation, conversation => conversation.messages)
  @JoinColumn({ name: "conversationId" })
  conversation!: Conversation;

  @CreateDateColumn()
  createdAt!: Date;
}
