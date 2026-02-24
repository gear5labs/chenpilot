import { SimulationConfig, AccountState, ContractState, StateChange } from './types';
import logger from '../config/logger';

export class StateManager {
  private config!: SimulationConfig;
  private accountStates: Map<string, AccountState> = new Map();
  private contractStates: Map<string, ContractState> = new Map();
  private initialized = false;

  async initialize(config: SimulationConfig): Promise<void> {
    this.config = config;
    
    // Initialize default accounts for Stellar
    for (const account of config.stellar.defaultAccounts) {
      const accountState: AccountState = {
        address: account.address,
        balances: { ...account.initialBalances },
        sequence: 0,
        trustlines: [],
        lastModified: Date.now()
      };
      this.accountStates.set(account.address, accountState);
    }

    // Initialize default accounts for Starknet
    for (const account of config.starknet.defaultAccounts) {
      const accountState: AccountState = {
        address: account.address,
        balances: { ...account.initialBalances },
        sequence: 0,
        lastModified: Date.now()
      };
      this.accountStates.set(account.address, accountState);
    }

    this.initialized = true;
    logger.info('State manager initialized', { 
      stellarAccounts: config.stellar.defaultAccounts.length,
      starknetAccounts: config.starknet.defaultAccounts.length
    });
  }

  getAccountState(address: string): AccountState | undefined {
    return this.accountStates.get(address);
  }

  updateAccountState(address: string, updates: Partial<AccountState>): void {
    const existing = this.accountStates.get(address);
    if (existing) {
      const updated = {
        ...existing,
        ...updates,
        lastModified: Date.now()
      };
      this.accountStates.set(address, updated);
      logger.debug('Account state updated', { address, updates });
    }
  }

  getContractState(contractId: string): ContractState | undefined {
    return this.contractStates.get(contractId);
  }

  updateContractState(contractId: string, updates: Partial<ContractState>): void {
    const existing = this.contractStates.get(contractId);
    if (existing) {
      const updated = {
        ...existing,
        ...updates,
        lastInvoked: Date.now()
      };
      this.contractStates.set(contractId, updated);
      logger.debug('Contract state updated', { contractId, updates });
    } else {
      // Create new contract state
      const newState: ContractState = {
        contractId,
        code: '',
        storage: {},
        lastInvoked: Date.now(),
        ...updates
      };
      this.contractStates.set(contractId, newState);
      logger.debug('Contract state created', { contractId });
    }
  }

  async reset(resetType: 'full' | 'partial', preserveState?: string[]): Promise<void> {
    if (resetType === 'full') {
      this.accountStates.clear();
      this.contractStates.clear();
      
      // Reinitialize with default accounts
      if (this.config) {
        await this.initialize(this.config);
      }
    } else if (resetType === 'partial' && preserveState) {
      // Reset all except preserved states
      const preservedAccounts = new Map<string, AccountState>();
      const preservedContracts = new Map<string, ContractState>();
      
      for (const address of preserveState) {
        const account = this.accountStates.get(address);
        if (account) {
          preservedAccounts.set(address, account);
        }
        
        const contract = this.contractStates.get(address);
        if (contract) {
          preservedContracts.set(address, contract);
        }
      }
      
      this.accountStates = preservedAccounts;
      this.contractStates = preservedContracts;
    }
    
    logger.info('State manager reset', { resetType, preserveState });
  }

  createSnapshot(): {
    accounts: Map<string, AccountState>;
    contracts: Map<string, ContractState>;
    timestamp: number;
  } {
    return {
      accounts: new Map(this.accountStates),
      contracts: new Map(this.contractStates),
      timestamp: Date.now()
    };
  }

  restoreSnapshot(snapshot: {
    accounts: Map<string, AccountState>;
    contracts: Map<string, ContractState>;
    timestamp: number;
  }): void {
    this.accountStates = new Map(snapshot.accounts);
    this.contractStates = new Map(snapshot.contracts);
    logger.info('State restored from snapshot', { timestamp: snapshot.timestamp });
  }

  getStateChanges(beforeSnapshot: {
    accounts: Map<string, AccountState>;
    contracts: Map<string, ContractState>;
  }): StateChange[] {
    const changes: StateChange[] = [];
    
    // Check account changes
    for (const [address, currentState] of this.accountStates) {
      const beforeState = beforeSnapshot.accounts.get(address);
      if (!beforeState || JSON.stringify(beforeState) !== JSON.stringify(currentState)) {
        changes.push({
          type: 'account',
          id: address,
          changes: {
            before: beforeState,
            after: currentState
          }
        });
      }
    }
    
    // Check contract changes
    for (const [contractId, currentState] of this.contractStates) {
      const beforeState = beforeSnapshot.contracts.get(contractId);
      if (!beforeState || JSON.stringify(beforeState) !== JSON.stringify(currentState)) {
        changes.push({
          type: 'contract',
          id: contractId,
          changes: {
            before: beforeState,
            after: currentState
          }
        });
      }
    }
    
    return changes;
  }

  getAllAccounts(): AccountState[] {
    return Array.from(this.accountStates.values());
  }

  getAllContracts(): ContractState[] {
    return Array.from(this.contractStates.values());
  }

  isInitialized(): boolean {
    return this.initialized;
  }
}