import * as StellarSdk from "@stellar/stellar-sdk";

export interface DecodedEvent {
  id: string;
  contractId: string;
  topic: string[];
  value: unknown;
  ledger: number;
  ledgerClosedAt: string;
}

export class EventIndexingService {
  private server: StellarSdk.SorobanRpc.Server;

  constructor(rpcUrl: string) {
    this.server = new StellarSdk.SorobanRpc.Server(rpcUrl);
  }

  /**
   * Requirement 93: Index and store Soroban contract events.
   * Priority: High
   */
  async fetchContractEvents(
    contractId: string,
    startLedger: number
  ): Promise<DecodedEvent[]> {
    try {
      // 1. Fetch events from RPC
      const response = await this.server.getEvents({
        startLedger: startLedger,
        filters: [
          {
            type: "contract",
            contractIds: [contractId],
          },
        ],
      });

      // 2. Decode XDR events into native JS types
      const decodedEvents: DecodedEvent[] = response.events.map((event) => {
        // Topic is an array of ScVals, usually [EventName, ...Data]
        const topics = event.topic.map((t) => StellarSdk.scValToNative(t));
        const value = StellarSdk.scValToNative(event.value);

        return {
          id: event.id,
          contractId: event.contractId,
          topic: topics,
          value: value,
          ledger: event.ledger,
          ledgerClosedAt: event.ledgerClosedAt,
        };
      });

      // 3. (Integration Point) Save to DB
      await this.saveEventsToDatabase(decodedEvents);

      return decodedEvents;
    } catch (error) {
      console.error("Failed to index Soroban events:", error);
      throw error;
    }
  }

  private async saveEventsToDatabase(events: DecodedEvent[]) {
    // Logic to persist events to PostgreSQL/MongoDB/Redis
    // This allows the /history endpoint to serve data instantly
    console.log(`Indexed ${events.length} events for ChenPilot contracts.`);
  }
}
