import * as StellarSdk from "@stellar/stellar-sdk";

export interface ServiceStatus {
  status: "UP" | "DOWN";
  latencyMs: number;
  ledgerVersion?: number;
  error?: string;
}

export interface HealthCheckResponse {
  overallStatus: "HEALTHY" | "UNHEALTHY";
  timestamp: string;
  services: {
    horizon: ServiceStatus;
    sorobanRpc: ServiceStatus;
  };
}

export class HealthService {
  /**
   * Requirement: Verify connectivity and latency of Stellar nodes.
   */
  async checkStellarHealth(
    horizonUrl: string,
    rpcUrl: string
  ): Promise<HealthCheckResponse> {
    const horizon = new StellarSdk.Horizon.Server(horizonUrl);
    const soroban = new StellarSdk.SorobanRpc.Server(rpcUrl);

    const results = await Promise.allSettled([
      this.measurePing(() => horizon.ledgers().limit(1).call()),
      this.measurePing(() => soroban.getLatestLedger()),
    ]);

    const horizonResult = results[0];
    const rpcResult = results[1];

    const health: HealthCheckResponse = {
      overallStatus: "HEALTHY",
      timestamp: new Date().toISOString(),
      services: {
        horizon: this.formatStatus(horizonResult),
        sorobanRpc: this.formatStatus(rpcResult),
      },
    };

    if (
      health.services.horizon.status === "DOWN" ||
      health.services.sorobanRpc.status === "DOWN"
    ) {
      health.overallStatus = "UNHEALTHY";
    }

    return health;
  }

  private async measurePing(
    fn: () => Promise<unknown>
  ): Promise<{ latency: number; data: unknown }> {
    const start = performance.now();
    const data = await fn();
    const end = performance.now();
    return { latency: Math.round(end - start), data };
  }

  private formatStatus(
    result: PromiseSettledResult<{ latency: number; data: unknown }>
  ): ServiceStatus {
    if (result.status === "fulfilled") {
      return {
        status: "UP",
        latencyMs: result.value.latency,
        ledgerVersion:
          result.value.data.sequence ||
          result.value.data.records?.[0]?.sequence,
      };
    }
    return {
      status: "DOWN",
      latencyMs: 0,
      error: result.reason.message,
    };
  }
}
