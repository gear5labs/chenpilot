#!/usr/bin/env ts-node

/**
 * Token Cleanup Script
 *
 * This script removes expired refresh tokens from the database.
 * Run this periodically (e.g., daily) via cron job:
 *
 * # Run daily at 2 AM
 * 0 2 * * * cd /path/to/project && npm run cleanup:tokens
 *
 * Or add to package.json scripts:
 * "cleanup:tokens": "ts-node src/scripts/cleanupTokens.ts"
 */

import "reflect-metadata";
import { container } from "tsyringe";
import AppDataSource from "../config/Datasource";
import JwtService from "../Auth/jwt.service";
import logger from "../config/logger";

async function cleanupExpiredTokens() {
  try {
    logger.info("Starting token cleanup...");

    // Initialize database connection
    if (!AppDataSource.isInitialized) {
      await AppDataSource.initialize();
      logger.info("Database connection established");
    }

    // Get JWT service and cleanup
    const jwtService = container.resolve(JwtService);
    const deletedCount = await jwtService.cleanupExpiredTokens();

    logger.info(
      `Token cleanup completed. Removed ${deletedCount} expired tokens`
    );

    // Close database connection
    await AppDataSource.destroy();
    logger.info("Database connection closed");

    process.exit(0);
  } catch (error) {
    logger.error("Token cleanup failed", { error });
    process.exit(1);
  }
}

// Run the cleanup
cleanupExpiredTokens();
