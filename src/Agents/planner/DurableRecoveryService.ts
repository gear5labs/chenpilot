import { AppDataSource } from "../../config/Datasource";
import { DurableExecution, ExecutionStatus } from "./DurableExecution.entity";
import { durableExecutor } from "./DurableExecutor";
import logger from "../../config/logger";
import { checkSchemaCompatibility } from "./workflowSchemaVersion";

export class DurableRecoveryService {
  async recoverInterruptedExecutions(): Promise<void> {
    const executionRepo = AppDataSource.getRepository(DurableExecution);
    logger.info("Checking for interrupted durable executions...");

    const interruptedExecutions = await executionRepo.find({
      where: { status: ExecutionStatus.RUNNING },
    });

    if (interruptedExecutions.length === 0) {
      logger.info("No interrupted executions found.");
      return;
    }

    logger.info(
      `Found ${interruptedExecutions.length} interrupted executions. Resuming...`
    );

    for (const execution of interruptedExecutions) {
      try {
        // Check schema version compatibility before attempting resume
        // Handle legacy executions without schemaVersion field
        if (!execution.schemaVersion) {
          logger.warn(
            `Skipping recovery of execution ${execution.id} with missing schema version (legacy execution)`,
            {
              executionId: execution.id,
            }
          );
          continue;
        }

        try {
          const compatibility = checkSchemaCompatibility(execution.schemaVersion);
          if (!compatibility.compatible) {
            logger.error(
              `Skipping recovery of execution ${execution.id} due to incompatible schema version`,
              {
                executionId: execution.id,
                storedVersion: execution.schemaVersion,
                currentVersion: compatibility.currentVersion,
                reason: compatibility.reason,
              }
            );
            continue;
          }
        } catch (versionError) {
          logger.error(
            `Skipping recovery of execution ${execution.id} due to invalid schema version`,
            {
              executionId: execution.id,
              storedVersion: execution.schemaVersion,
              error: versionError,
            }
          );
          continue;
        }

        // Resume in background
        durableExecutor.resumeExecution(execution.id).catch((err) => {
          logger.error(`Failed to resume execution ${execution.id}`, {
            error: err,
          });
        });
      } catch (error) {
        logger.error(`Failed to mark execution ${execution.id} for recovery`, {
          error,
        });
      }
    }
  }
}

export const durableRecoveryService = new DurableRecoveryService();
