/**
 * Tests for DurableRecoveryService schema version compatibility
 */

import { DurableRecoveryService } from "../DurableRecoveryService";
import { ExecutionStatus } from "../DurableExecution.entity";

// Mock dependencies
jest.mock("../../../config/Datasource", () => ({
  __esModule: true,
  default: {
    getRepository: jest.fn(),
  },
}));

jest.mock("../../../config/logger", () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

jest.mock("../DurableExecutor", () => ({
  durableExecutor: {
    resumeExecution: jest.fn(),
  },
}));

import { durableExecutor } from "../DurableExecutor";

describe("DurableRecoveryService", () => {
  let recoveryService: DurableRecoveryService;
  let mockRepo: any;

  beforeEach(() => {
    jest.clearAllMocks();
    recoveryService = new DurableRecoveryService();

    mockRepo = {
      find: jest.fn(),
    };

    const { AppDataSource } = require("../../../config/Datasource");
    AppDataSource.getRepository.mockReturnValue(mockRepo);
  });

  describe("recoverInterruptedExecutions with schema version checks", () => {
    it("skips executions with missing schema version (legacy)", async () => {
      const executions = [
        {
          id: "exec-1",
          status: ExecutionStatus.RUNNING,
          schemaVersion: undefined,
        },
      ];
      mockRepo.find.mockResolvedValue(executions);

      await recoveryService.recoverInterruptedExecutions();

      expect(durableExecutor.resumeExecution).not.toHaveBeenCalled();
      expect(require("../../../config/logger").default.warn).toHaveBeenCalledWith(
        expect.stringContaining("missing schema version"),
        expect.any(Object)
      );
    });

    it("skips executions with incompatible schema version (below minimum)", async () => {
      const executions = [
        {
          id: "exec-1",
          status: ExecutionStatus.RUNNING,
          schemaVersion: "0.0.1",
        },
      ];
      mockRepo.find.mockResolvedValue(executions);

      await recoveryService.recoverInterruptedExecutions();

      expect(durableExecutor.resumeExecution).not.toHaveBeenCalled();
      expect(require("../../../config/logger").default.error).toHaveBeenCalledWith(
        expect.stringContaining("incompatible schema version"),
        expect.any(Object)
      );
    });

    it("skips executions with incompatible schema version (newer than current)", async () => {
      const executions = [
        {
          id: "exec-1",
          status: ExecutionStatus.RUNNING,
          schemaVersion: "99.0.0",
        },
      ];
      mockRepo.find.mockResolvedValue(executions);

      await recoveryService.recoverInterruptedExecutions();

      expect(durableExecutor.resumeExecution).not.toHaveBeenCalled();
      expect(require("../../../config/logger").default.error).toHaveBeenCalledWith(
        expect.stringContaining("incompatible schema version"),
        expect.any(Object)
      );
    });

    it("skips executions with invalid schema version format", async () => {
      const executions = [
        {
          id: "exec-1",
          status: ExecutionStatus.RUNNING,
          schemaVersion: "invalid-version",
        },
      ];
      mockRepo.find.mockResolvedValue(executions);

      await recoveryService.recoverInterruptedExecutions();

      expect(durableExecutor.resumeExecution).not.toHaveBeenCalled();
      expect(require("../../../config/logger").default.error).toHaveBeenCalledWith(
        expect.stringContaining("invalid schema version"),
        expect.any(Object)
      );
    });

    it("resumes executions with compatible schema version", async () => {
      const executions = [
        {
          id: "exec-1",
          status: ExecutionStatus.RUNNING,
          schemaVersion: "1.0.0",
        },
      ];
      mockRepo.find.mockResolvedValue(executions);
      (durableExecutor.resumeExecution as jest.Mock).mockResolvedValue(undefined);

      await recoveryService.recoverInterruptedExecutions();

      expect(durableExecutor.resumeExecution).toHaveBeenCalledWith("exec-1");
    });

    it("handles mixed compatibility scenarios", async () => {
      const executions = [
        {
          id: "exec-1",
          status: ExecutionStatus.RUNNING,
          schemaVersion: "1.0.0", // Compatible
        },
        {
          id: "exec-2",
          status: ExecutionStatus.RUNNING,
          schemaVersion: undefined, // Legacy
        },
        {
          id: "exec-3",
          status: ExecutionStatus.RUNNING,
          schemaVersion: "0.0.1", // Incompatible
        },
        {
          id: "exec-4",
          status: ExecutionStatus.RUNNING,
          schemaVersion: "1.0.0", // Compatible
        },
      ];
      mockRepo.find.mockResolvedValue(executions);
      (durableExecutor.resumeExecution as jest.Mock).mockResolvedValue(undefined);

      await recoveryService.recoverInterruptedExecutions();

      expect(durableExecutor.resumeExecution).toHaveBeenCalledTimes(2);
      expect(durableExecutor.resumeExecution).toHaveBeenCalledWith("exec-1");
      expect(durableExecutor.resumeExecution).toHaveBeenCalledWith("exec-4");
    });

    it("logs when no interrupted executions are found", async () => {
      mockRepo.find.mockResolvedValue([]);

      await recoveryService.recoverInterruptedExecutions();

      expect(require("../../../config/logger").default.info).toHaveBeenCalledWith(
        "No interrupted executions found."
      );
      expect(durableExecutor.resumeExecution).not.toHaveBeenCalled();
    });

    it("handles resume errors gracefully", async () => {
      const executions = [
        {
          id: "exec-1",
          status: ExecutionStatus.RUNNING,
          schemaVersion: "1.0.0",
        },
      ];
      mockRepo.find.mockResolvedValue(executions);
      (durableExecutor.resumeExecution as jest.Mock).mockRejectedValue(
        new Error("Resume failed")
      );

      await recoveryService.recoverInterruptedExecutions();

      expect(durableExecutor.resumeExecution).toHaveBeenCalledWith("exec-1");
      expect(require("../../../config/logger").default.error).toHaveBeenCalledWith(
        "Failed to resume execution exec-1",
        expect.objectContaining({
          error: expect.any(Error),
        })
      );
    });
  });
});
