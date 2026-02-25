import * as StellarSdk from "@stellar/stellar-sdk";
import config from "../config/config";
import logger from "../config/logger";

export const LARGE_OPERATION_ALERT_EVENT = "stellar.large_operation";

export interface LargeOperationAlert {
  operationId: string;
  operationType: string;
  amount: number;
  asset: string;
  from?: string;
  to?: string;
  transactionHash: string;
  createdAt: string;
  ledger?: number;
  threshold: number;
  network: string;
}

interface HorizonOperationRecord {
  id?: string;
  type?: string;
  amount?: string;
  starting_balance?: string;
  source_amount?: string;
  destination_amount?: string;
  asset_type?: string;
  asset_code?: string;
  source_asset_type?: string;
  source_asset_code?: string;
  destination_asset_type?: string;
  destination_asset_code?: string;
  from?: string;
  to?: string;
  source_account?: string;
  destination_account?: string;
  account?: string;
  transaction_hash?: string;
  created_at?: string;
  ledger?: number;
}

interface HorizonOperationStreamBuilder {
  cursor(cursor: string): HorizonOperationStreamBuilder;
  order(order: "asc" | "desc"): HorizonOperationStreamBuilder;
  stream(options: {
    onmessage: (record: HorizonOperationRecord) => void;
    onerror: (error: unknown) => void;
  }): () => void;
}

interface HorizonServerLike {
  operations(): HorizonOperationStreamBuilder;
}

interface HorizonOperationStreamerOptions {
  server?: HorizonServerLike;
  enabled?: boolean;
  minAmount?: number;
  reconnectDelayMs?: number;
}

export class HorizonOperationStreamerService {
  private readonly server: HorizonServerLike;
  private readonly listeners = new Set<(alert: LargeOperationAlert) => void>();
  private readonly enabled: boolean;
  private readonly minAmount: number;
  private readonly reconnectDelayMs: number;
  private closeStream: (() => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(options: HorizonOperationStreamerOptions = {}) {
    this.server =
      options.server ??
      ((new StellarSdk.Horizon.Server(
        config.stellar.horizonUrl
      ) as unknown) as HorizonServerLike);

    this.enabled = options.enabled ?? process.env.STELLAR_ALERT_STREAM_ENABLED !== "false";
    this.minAmount =
      options.minAmount ??
      Number.parseFloat(process.env.STELLAR_ALERT_MIN_AMOUNT || "1000");
    this.reconnectDelayMs =
      options.reconnectDelayMs ??
      Number.parseInt(process.env.STELLAR_ALERT_STREAM_RECONNECT_MS || "5000", 10);
  }

  start(): void {
    if (this.running) {
      return;
    }

    if (!this.enabled) {
      logger.info("Horizon operation streamer disabled by configuration");
      return;
    }

    this.running = true;
    this.openStream();
  }

  stop(): void {
    this.running = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.closeStream) {
      this.closeStream();
      this.closeStream = null;
    }
  }

  onLargeOperation(listener: (alert: LargeOperationAlert) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private openStream(): void {
    try {
      this.closeStream = this.server
        .operations()
        .cursor("now")
        .order("asc")
        .stream({
          onmessage: (record) => {
            this.handleOperation(record);
          },
          onerror: (error) => {
            logger.error("Horizon operation stream error", {
              error: error instanceof Error ? error.message : String(error),
            });
            this.scheduleReconnect();
          },
        });

      logger.info("Horizon operation stream started", {
        minAmount: this.minAmount,
        network: config.stellar.network,
      });
    } catch (error) {
      logger.error("Failed to start Horizon operation stream", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running || this.reconnectTimer) {
      return;
    }

    if (this.closeStream) {
      this.closeStream();
      this.closeStream = null;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.running) {
        return;
      }
      this.openStream();
    }, this.reconnectDelayMs);
  }

  private handleOperation(operation: HorizonOperationRecord): void {
    const parsed = this.extractOperationAmount(operation);
    if (!parsed || parsed.amount < this.minAmount) {
      return;
    }

    const alert: LargeOperationAlert = {
      operationId: operation.id || "unknown",
      operationType: operation.type || "unknown",
      amount: parsed.amount,
      asset: parsed.asset,
      from: operation.from || operation.source_account,
      to: operation.to || operation.destination_account || operation.account,
      transactionHash: operation.transaction_hash || "unknown",
      createdAt: operation.created_at || new Date().toISOString(),
      ledger: operation.ledger,
      threshold: this.minAmount,
      network: config.stellar.network,
    };

    logger.warn("Large Stellar operation detected", alert);
    for (const listener of this.listeners) {
      listener(alert);
    }
  }

  private extractOperationAmount(
    operation: HorizonOperationRecord
  ): { amount: number; asset: string } | null {
    if (!operation.type) {
      return null;
    }

    if (operation.type === "payment") {
      return {
        amount: Number.parseFloat(operation.amount || "0"),
        asset: this.resolveAsset(operation.asset_type, operation.asset_code),
      };
    }

    if (operation.type === "create_account") {
      return {
        amount: Number.parseFloat(operation.starting_balance || "0"),
        asset: "XLM",
      };
    }

    if (operation.type === "path_payment_strict_send") {
      return {
        amount: Number.parseFloat(operation.source_amount || "0"),
        asset: this.resolveAsset(
          operation.source_asset_type,
          operation.source_asset_code
        ),
      };
    }

    if (operation.type === "path_payment_strict_receive") {
      return {
        amount: Number.parseFloat(operation.destination_amount || "0"),
        asset: this.resolveAsset(
          operation.destination_asset_type,
          operation.destination_asset_code
        ),
      };
    }

    return null;
  }

  private resolveAsset(assetType?: string, assetCode?: string): string {
    if (assetType === "native") {
      return "XLM";
    }

    if (assetCode) {
      return assetCode;
    }

    return "UNKNOWN";
  }
}

export const horizonOperationStreamerService = new HorizonOperationStreamerService();
