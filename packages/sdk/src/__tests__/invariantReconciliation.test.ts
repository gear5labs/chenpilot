import { TriageOwnershipService, TransactionSubmission } from '../TriageOwnershipService';

describe('Triage Ownership for Unresolved Transactions (#825)', () => {
  let triageService: TriageOwnershipService;

  beforeEach(() => {
    triageService = new TriageOwnershipService();
  });

  it('successfully assigns triage ownership to an unresolved transaction submission', async () => {
    const unresolvedTx: TransactionSubmission = {
      id: 'sub_123',
      txHash: '0xabc123',
      status: 'unresolved',
      assignedOwner: null,
      updatedAt: new Date(),
    };

    triageService.registerSubmission(unresolvedTx);

    const updated = await triageService.assignOwner('sub_123', 'operator@gear5labs.com');

    expect(updated.assignedOwner).toBe('operator@gear5labs.com');
  });

  it('rejects triage ownership assignment for already resolved transactions', async () => {
    const resolvedTx: TransactionSubmission = {
      id: 'sub_456',
      txHash: '0xdef456',
      status: 'resolved',
      assignedOwner: 'previous@gear5labs.com',
      updatedAt: new Date(),
    };

    triageService.registerSubmission(resolvedTx);

    await expect(
      triageService.assignOwner('sub_456', 'new-operator@gear5labs.com')
    ).rejects.toThrow('Cannot assign triage owner to an already resolved transaction.');
  });
});