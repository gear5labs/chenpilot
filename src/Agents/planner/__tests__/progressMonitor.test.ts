/**
 * progressMonitor.test.ts
 *
 * Tests for the progress monitoring service that detects stuck executions.
 */

import { ProgressMonitorService, StuckExecution } from "../ProgressMonitor.service";
import { DurableExecution, ExecutionStatus } from "../DurableExecution.entity";
import { DurableStep, StepStatus } from "../DurableStep.entity";
import AppDataSource from "../../../config/Datasource";

// Mock AppDataSource
jest.mock("../../../config/Datasource");

describe("ProgressMonitorService", () => {
  let progressMonitor: ProgressMonitorService;
  let mockExecutionRepo: any;
  let mockStepRepo: any;

  beforeEach(() => {
    // Create mock repositories
    mockExecutionRepo = {
      find: jest.fn(),
      count: jest.fn(),
      createQueryBuilder: jest.fn(),
    };
    mockStepRepo = {
      find: jest.fn(),
      createQueryBuilder: jest.fn(),
    };

    // Mock AppDataSource.getRepository
    (AppDataSource.getRepository as jest.Mock).mockImplementation((entity) => {
      if (entity === DurableExecution) return mockExecutionRepo;
      if (entity === DurableStep) return mockStepRepo;
      return {};
    });

    progressMonitor = new ProgressMonitorService();
  });

  describe("detectStuckExecutions", () => {
    it("should detect executions stuck in RUNNING status", async () => {
      const now = new Date();
      const oldTime = new Date(now.getTime() - 35 * 60 * 1000); // 35 minutes ago

      const mockExecution = {
        id: "exec-1",
        userId: "user-1",
        status: ExecutionStatus.RUNNING,
        currentStepNumber: 2,
        updatedAt: oldTime,
        steps: [
          {
            stepNumber: 2,
            status: StepStatus.RUNNING,
            startedAt: oldTime,
            retryCount: 0,
          },
        ],
      };

      mockExecutionRepo.find.mockResolvedValue([mockExecution]);

      const stuckExecutions = await progressMonitor.detectStuckExecutions();

      expect(stuckExecutions).toHaveLength(1);
      expect(stuckExecutions[0].executionId).toBe("exec-1");
      expect(stuckExecutions[0].stuckReason).toContain("stuck in RUNNING");
      expect(stuckExecutions[0].stuckDuration).toBeGreaterThan(0);
    });

    it("should detect executions stuck in AWAITING_APPROVAL past expiry", async () => {
      const now = new Date();
      const expiredTime = new Date(now.getTime() - 10 * 60 * 1000); // Expired 10 minutes ago

      const mockExecution = {
        id: "exec-2",
        userId: "user-2",
        status: ExecutionStatus.AWAITING_APPROVAL,
        currentStepNumber: 1,
        updatedAt: new Date(),
        expiresAt: expiredTime,
        steps: [],
      };

      mockExecutionRepo.find.mockResolvedValue([mockExecution]);

      const stuckExecutions = await progressMonitor.detectStuckExecutions();

      expect(stuckExecutions).toHaveLength(1);
      expect(stuckExecutions[0].executionId).toBe("exec-2");
      expect(stuckExecutions[0].stuckReason).toContain("Approval expired");
      expect(stuckExecutions[0].metadata?.expiresAt).toEqual(expiredTime);
    });

    it("should detect executions with no progress updates (stale)", async () => {
      const now = new Date();
      const staleTime = new Date(now.getTime() - 65 * 60 * 1000); // 65 minutes ago

      const mockExecution = {
        id: "exec-3",
        userId: "user-3",
        status: ExecutionStatus.RUNNING,
        currentStepNumber: 1,
        updatedAt: staleTime,
        steps: [],
      };

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockExecution]),
      };

      mockExecutionRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      mockExecutionRepo.find.mockResolvedValue([]); // No running executions
      mockExecutionRepo.find.mockResolvedValue([]); // No awaiting approval

      const stuckExecutions = await progressMonitor.detectStuckExecutions();

      expect(stuckExecutions).toHaveLength(1);
      expect(stuckExecutions[0].executionId).toBe("exec-3");
      expect(stuckExecutions[0].stuckReason).toContain("No progress updates");
    });

    it("should detect steps with excessive retry counts", async () => {
      const now = new Date();
      const mockStep = {
        stepNumber: 3,
        status: StepStatus.RUNNING,
        retryCount: 6,
        startedAt: new Date(),
        execution: { id: "exec-4" },
      };

      const mockExecution = {
        id: "exec-4",
        userId: "user-4",
        status: ExecutionStatus.RUNNING,
        currentStepNumber: 3,
        updatedAt: new Date(),
        steps: [mockStep],
      };

      const mockQueryBuilder = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([mockStep]),
      };

      mockStepRepo.createQueryBuilder.mockReturnValue(mockQueryBuilder);
      mockExecutionRepo.findOne.mockResolvedValue(mockExecution);
      mockExecutionRepo.find.mockResolvedValue([]); // No running executions
      mockExecutionRepo.find.mockResolvedValue([]); // No awaiting approval

      const stuckExecutions = await progressMonitor.detectStuckExecutions();

      expect(stuckExecutions).toHaveLength(1);
      expect(stuckExecutions[0].executionId).toBe("exec-4");
      expect(stuckExecutions[0].stuckReason).toContain("6 retries");
      expect(stuckExecutions[0].metadata?.retryCount).toBe(6);
    });

    it("should return empty array when no stuck executions", async () => {
      mockExecutionRepo.find.mockResolvedValue([]);
      mockExecutionRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoinAndSelect: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });
      mockStepRepo.createQueryBuilder.mockReturnValue({
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        getMany: jest.fn().mockResolvedValue([]),
      });

      const stuckExecutions = await progressMonitor.detectStuckExecutions();

      expect(stuckExecutions).toHaveLength(0);
    });
  });

  describe("getExecutionHealthStats", () => {
    it("should return comprehensive health statistics", async () => {
      mockExecutionRepo.count.mockResolvedValue(100);
      mockExecutionRepo.count.mockResolvedValue(10); // running
      mockExecutionRepo.count.mockResolvedValue(5); // awaiting approval
      mockExecutionRepo.count.mockResolvedValue(2); // paused

      const mockStuckExecutions: StuckExecution[] = [
        {
          executionId: "exec-1",
          userId: "user-1",
          status: ExecutionStatus.RUNNING,
          currentStepNumber: 2,
          totalSteps: 5,
          stuckReason: "Test",
          stuckDuration: 3600000,
          lastActivity: new Date(),
        },
      ];

      jest.spyOn(progressMonitor, "detectStuckExecutions").mockResolvedValue(mockStuckExecutions);

      const stats = await progressMonitor.getExecutionHealthStats();

      expect(stats.total).toBe(100);
      expect(stats.running).toBe(10);
      expect(stats.awaitingApproval).toBe(5);
      expect(stats.paused).toBe(2);
      expect(stats.stuck).toBe(1);
      expect(stats.stuckDetails).toEqual(mockStuckExecutions);
    });
  });

  describe("updateConfig", () => {
    it("should update configuration values", () => {
      const newConfig = {
        maxRunningDuration: 45 * 60 * 1000,
        maxStepRunningDuration: 15 * 60 * 1000,
      };

      progressMonitor.updateConfig(newConfig);

      // Verify config was updated (accessing private property for testing)
      expect((progressMonitor as any).config.maxRunningDuration).toBe(45 * 60 * 1000);
      expect((progressMonitor as any).config.maxStepRunningDuration).toBe(15 * 60 * 1000);
    });

    it("should preserve default values for unspecified fields", () => {
      const newConfig = {
        maxRunningDuration: 45 * 60 * 1000,
      };

      progressMonitor.updateConfig(newConfig);

      expect((progressMonitor as any).config.maxRunningDuration).toBe(45 * 60 * 1000);
      expect((progressMonitor as any).config.maxStepRunningDuration).toBe(10 * 60 * 1000); // Default
    });
  });

  describe("logStuckExecutions", () => {
    it("should log when stuck executions are found", async () => {
      const mockStuckExecutions: StuckExecution[] = [
        {
          executionId: "exec-1",
          userId: "user-1",
          status: ExecutionStatus.RUNNING,
          currentStepNumber: 2,
          totalSteps: 5,
          stuckReason: "Test stuck",
          stuckDuration: 3600000,
          lastActivity: new Date(),
        },
      ];

      jest.spyOn(progressMonitor, "detectStuckExecutions").mockResolvedValue(mockStuckExecutions);

      await progressMonitor.logStuckExecutions();

      expect(progressMonitor.detectStuckExecutions).toHaveBeenCalled();
    });

    it("should log when no stuck executions are found", async () => {
      jest.spyOn(progressMonitor, "detectStuckExecutions").mockResolvedValue([]);

      await progressMonitor.logStuckExecutions();

      expect(progressMonitor.detectStuckExecutions).toHaveBeenCalled();
    });
  });
});
