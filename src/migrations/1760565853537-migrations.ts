import { MigrationInterface, QueryRunner } from "typeorm";

export class Migrations1760565853536 implements MigrationInterface {
    name = 'Migrations1760565853537'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "contact" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "name" character varying NOT NULL,
                "address" character varying NOT NULL,
                "tokenType" character varying NOT NULL DEFAULT 'STRK',
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_8c17e6f04bd3fdd6053f3e7ebea" UNIQUE ("name"),
                CONSTRAINT "PK_2cbbe00f59ab6b3bb5b8d19f989" PRIMARY KEY ("id")
            )
        `);
        await queryRunner.query(`
            CREATE TYPE "public"."user_authprovider_enum" AS ENUM('email', 'google')
        `);
        await queryRunner.query(`
            CREATE TABLE "user" (
                "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
                "email" character varying,
                "password" character varying,
                "name" character varying,
                "address" character varying,
                "pk" text,
                "publicKey" character varying,
                "addressSalt" character varying,
                "constructorCalldata" text,
                "isDeployed" boolean NOT NULL DEFAULT false,
                "deploymentTransactionHash" character varying,
                "tokenType" character varying NOT NULL DEFAULT 'STRK',
                "authProvider" "public"."user_authprovider_enum" NOT NULL DEFAULT 'email',
                "googleId" character varying,
                "profilePicture" character varying,
                "isEmailVerified" boolean NOT NULL DEFAULT false,
                "emailVerificationToken" character varying,
                "passwordResetToken" character varying,
                "passwordResetExpires" TIMESTAMP,
                "isFunded" boolean NOT NULL DEFAULT false,
                "fundingTransactionHash" character varying,
                "fundedAt" TIMESTAMP,
                "isDeploymentPending" boolean NOT NULL DEFAULT false,
                "deploymentRequestedAt" TIMESTAMP,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "UQ_e12875dfb3b1d92d7d7c5377e22" UNIQUE ("email"),
                CONSTRAINT "PK_cace4a159ff9f2512dd42373760" PRIMARY KEY ("id")
            );
            COMMENT ON COLUMN "user"."pk" IS 'Encrypted private key'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DROP TABLE "user"
        `);
        await queryRunner.query(`
            DROP TYPE "public"."user_authprovider_enum"
        `);
        await queryRunner.query(`
            DROP TABLE "contact"
        `);
    }

}
