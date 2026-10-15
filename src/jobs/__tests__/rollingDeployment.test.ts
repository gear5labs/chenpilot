import { JobWorker } from "../jobWorker";
import { JobQueueService } from "../jobQueue.service";

describe("Rolling Deployment Invariants", () => {
  let mockQueueService: jest.Mocked<JobQueueService>;

  beforeEach(() => {
    mockQueueService = {
      leaseJobs: jest.fn(),
      deadLetterJob: jest.fn(),
      getJob: jest.fn(),
      renewLease: jest.fn(),
      completeJob: jest.fn(),
      rescheduleJob: jest.fn(),
      failJob: jest.fn(),
    } as unknown as jest.Mocked<JobQueueService>;
  });

  it("enforces version fencing to preserve exactly-once execution", async () => {
    const workerV1 = new JobWorker(mockQueueService, {
      workerId: "worker-v1",
      queues: ["side-effects"],
      workerVersion: "1.0.0",
      pollIntervalMs: 100,
    });

    const workerV2 = new JobWorker(mockQueueService, {
      workerId: "worker-v2",
      queues: ["side-effects"],
      workerVersion: "2.0.0",
      pollIntervalMs: 100,
    });

    mockQueueService.leaseJobs.mockResolvedValue([]);

    // Simulate worker loop tick
    workerV1.start();
    workerV2.start();
    
    await new Promise((resolve) => setTimeout(resolve, 50));
    
    await workerV1.stop();
    await workerV2.stop();

    // Verify V1 only requests jobs compatible with V1 (or unversioned)
    expect(mockQueueService.leaseJobs).toHaveBeenCalledWith(
      ["side-effects"],
      "worker-v1",
      expect.any(Number),
      1,
      "1.0.0"
    );

    // Verify V2 only requests jobs compatible with V2 (or unversioned)
    expect(mockQueueService.leaseJobs).toHaveBeenCalledWith(
      ["side-effects"],
      "worker-v2",
      expect.any(Number),
      1,
      "2.0.0"
    );
  });
});
