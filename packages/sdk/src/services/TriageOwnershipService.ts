export interface TransactionSubmission {
  id: string;
  txHash: string;
  status: 'unresolved' | 'pending' | 'failed' | 'resolved';
  assignedOwner?: string | null;
  updatedAt: Date;
}

export class TriageOwnershipService {
  private submissions: Map<string, TransactionSubmission> = new Map();

  /**
   * Assigns or updates triage ownership for an unresolved transaction submission.
   */
  async assignOwner(submissionId: string, ownerEmail: string): Promise<TransactionSubmission> {
    const submission = this.submissions.get(submissionId);
    
    if (!submission) {
      throw new Error(`Transaction submission ${submissionId} not found.`);
    }

    if (submission.status === 'resolved') {
      throw new Error(`Cannot assign triage owner to an already resolved transaction.`);
    }

    submission.assignedOwner = ownerEmail;
    submission.updatedAt = new Date();
    
    this.submissions.set(submissionId, submission);
    return submission;
  }

  // Helper to register mock submissions for testing
  registerSubmission(submission: TransactionSubmission): void {
    this.submissions.set(submission.id, submission);
  }
}