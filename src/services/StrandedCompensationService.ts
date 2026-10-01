export interface CompensationTask {
  id: string;
  txHash: string;
  status: 'stranded' | 'assigned' | 'escalated' | 'resolved';
  assignedOwner?: string | null;
  escalationLevel: number;
  updatedAt: Date;
}

export class StrandedCompensationService {
  private tasks: Map<string, CompensationTask> = new Map();

  /**
   * Assigns an owner to a stranded compensation task.
   */
  async assignTask(taskId: string, ownerEmail: string): Promise<CompensationTask> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Compensation task ${taskId} not found.`);
    }

    if (task.status === 'resolved') {
      throw new Error(`Cannot assign a resolved compensation task.`);
    }

    task.assignedOwner = ownerEmail;
    task.status = 'assigned';
    task.updatedAt = new Date();

    this.tasks.set(taskId, task);
    return task;
  }

  /**
   * Escalates a stranded or assigned compensation task.
   */
  async escalateTask(taskId: string, targetTier: number = 1): Promise<CompensationTask> {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Compensation task ${taskId} not found.`);
    }

    if (task.status === 'resolved') {
      throw new Error(`Cannot escalate a resolved compensation task.`);
    }

    task.status = 'escalated';
    task.escalationLevel = Math.max(task.escalationLevel + 1, targetTier);
    task.updatedAt = new Date();

    this.tasks.set(taskId, task);
    return task;
  }

  // Register task for testing purposes
  registerTask(task: CompensationTask): void {
    this.tasks.set(task.id, task);
  }
}