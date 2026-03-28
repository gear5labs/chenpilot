import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Migration to add optimized database indexes for critical query paths
 *
 * This migration adds indexes to improve performance for:
 * - User search by address (wallet lookups)
 * - User search by email (authentication)
 * - User search by role (RBAC)
 * - User queries by createdAt (sorting/pagination)
 * - Contact lookups by address
 * - AgentTool filtering by isActive
 * - RefreshToken queries by userId, expiresAt, and isRevoked
 *
 * Priority indexes:
 * - IDX_user_address: User wallet address lookups (critical for transaction routing)
 * - IDX_user_email: User authentication and password reset
 * - IDX_user_role: Role-based access control queries
 * - IDX_contact_address: Contact lookups for transaction recipients
 * - IDX_agent_tool_is_active: Active tool filtering
 * - IDX_refresh_token_user_id: User token management
 * - IDX_refresh_token_expires_at: Expired token cleanup
 * - IDX_refresh_token_is_revoked: Active token queries
 */
export class AddDatabaseIndexes1772200000000 implements MigrationInterface {
  name = "AddDatabaseIndexes1772200000000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ============================================
    // USER TABLE INDEXES
    // ============================================

    // Index on email for login by email
    await queryRunner.query(
      `CREATE INDEX "IDX_user_email" ON "user" ("email")`
    );

    // Index on address for wallet lookups
    await queryRunner.query(
      `CREATE INDEX "IDX_user_address" ON "user" ("address")`
    );

    // Index on isEmailVerified for filtering verified users
    await queryRunner.query(
      `CREATE INDEX "IDX_user_is_email_verified" ON "user" ("isEmailVerified")`
    );

    // Index on role for role-based queries
    await queryRunner.query(`CREATE INDEX "IDX_user_role" ON "user" ("role")`);

    // ============================================
    // REFRESH_TOKEN TABLE INDEXES
    // ============================================

    // Index on userId for getting user's tokens
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_token_user_id" ON "refresh_token" ("userId")`
    );

    // Index on expiresAt for token cleanup/expired token queries
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_token_expires_at" ON "refresh_token" ("expiresAt")`
    );

    // Composite index for finding non-revoked tokens by user
    await queryRunner.query(
      `CREATE INDEX "IDX_refresh_token_user_not_revoked" ON "refresh_token" ("userId", "isRevoked")`
    );

    // ============================================
    // AUDIT_LOG TABLE INDEXES
    // ============================================

    // Index on success for filtering successful/failed actions
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_success" ON "audit_log" ("success")`
    );

    // Composite index for action-based queries with date range
    await queryRunner.query(
      `CREATE INDEX "IDX_audit_log_action_created" ON "audit_log" ("action", "createdAt")`
    );

    // ============================================
    // CONTACT TABLE INDEXES
    // ============================================

    // Index on address for contact lookups by wallet address
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_address" ON "contact" ("address")`
    );

    // Index on tokenType for filtering contacts by token type
    await queryRunner.query(
      `CREATE INDEX "IDX_contact_token_type" ON "contact" ("tokenType")`
    );

    // ============================================
    // PROMPT_VERSION TABLE INDEXES
    // ============================================

    // Index on name for prompt lookups
    await queryRunner.query(
      `CREATE INDEX "IDX_prompt_version_name" ON "prompt_version" ("name")`
    );

    // Index on type for filtering prompts by type
    await queryRunner.query(
      `CREATE INDEX "IDX_prompt_version_type" ON "prompt_version" ("type")`
    );

    // Index on isActive for getting active prompts
    await queryRunner.query(
      `CREATE INDEX "IDX_prompt_version_is_active" ON "prompt_version" ("isActive")`
    );

    // Composite index for getting active prompts by type
    await queryRunner.query(
      `CREATE INDEX "IDX_prompt_version_type_active" ON "prompt_version" ("type", "isActive")`
    );

    // ============================================
    // PROMPT_METRIC TABLE INDEXES
    // ============================================

    // Index on promptVersionId for metrics lookups
    await queryRunner.query(
      `CREATE INDEX "IDX_prompt_metric_prompt_version" ON "prompt_metric" ("promptVersionId")`
    );

    // Index on userId for user-specific metrics
    await queryRunner.query(
      `CREATE INDEX "IDX_prompt_metric_user_id" ON "prompt_metric" ("userId")`
    );

    // Index on success for success rate calculations
    await queryRunner.query(
      `CREATE INDEX "IDX_prompt_metric_success" ON "prompt_metric" ("success")`
    );

    // Composite index for prompt performance analysis
    await queryRunner.query(
      `CREATE INDEX "IDX_prompt_metric_prompt_success" ON "prompt_metric" ("promptVersionId", "success")`
    );

    // ============================================
    // AGENT_TOOL TABLE INDEXES
    // ============================================

    // Index on isActive for getting active tools
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_tool_is_active" ON "agent_tool" ("isActive")`
    );

    // Index on deletedAt for soft delete queries
    await queryRunner.query(
      `CREATE INDEX "IDX_agent_tool_deleted_at" ON "agent_tool" ("deletedAt")`
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Rollback agent_tool indexes
    await queryRunner.query(`DROP INDEX "IDX_agent_tool_deleted_at"`);
    await queryRunner.query(`DROP INDEX "IDX_agent_tool_is_active"`);

    // Rollback prompt_metric indexes
    await queryRunner.query(`DROP INDEX "IDX_prompt_metric_prompt_success"`);
    await queryRunner.query(`DROP INDEX "IDX_prompt_metric_success"`);
    await queryRunner.query(`DROP INDEX "IDX_prompt_metric_user_id"`);
    await queryRunner.query(`DROP INDEX "IDX_prompt_metric_prompt_version"`);

    // Rollback prompt_version indexes
    await queryRunner.query(`DROP INDEX "IDX_prompt_version_type_active"`);
    await queryRunner.query(`DROP INDEX "IDX_prompt_version_is_active"`);
    await queryRunner.query(`DROP INDEX "IDX_prompt_version_type"`);
    await queryRunner.query(`DROP INDEX "IDX_prompt_version_name"`);

    // Rollback contact indexes
    await queryRunner.query(`DROP INDEX "IDX_contact_token_type"`);
    await queryRunner.query(`DROP INDEX "IDX_contact_address"`);

    // Rollback audit_log indexes
    await queryRunner.query(`DROP INDEX "IDX_audit_log_action_created"`);
    await queryRunner.query(`DROP INDEX "IDX_audit_log_success"`);

    // Rollback refresh_token indexes
    await queryRunner.query(`DROP INDEX "IDX_refresh_token_user_not_revoked"`);
    await queryRunner.query(`DROP INDEX "IDX_refresh_token_expires_at"`);
    await queryRunner.query(`DROP INDEX "IDX_refresh_token_user_id"`);

    // Rollback user indexes
    await queryRunner.query(`DROP INDEX "IDX_user_role"`);
    await queryRunner.query(`DROP INDEX "IDX_user_is_email_verified"`);
    await queryRunner.query(`DROP INDEX "IDX_user_address"`);
    await queryRunner.query(`DROP INDEX "IDX_user_email"`);
  }
}
