export class LocalChainManager {
  initialize(): Promise<void> {
    return Promise.resolve();
  }

  get isEnabled(): boolean {
    return false;
  }

  getMetrics(): Record<string, unknown> {
    return {};
  }

  getSimulationEngine(): null {
    return null;
  }
}
