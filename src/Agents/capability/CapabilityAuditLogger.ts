/**
 * Capability Audit Logger
 * Machine-readable audit logs for approved and denied tool calls.
 */

import { RiskTier } from "./CapabilityRegistry";

export interface AuditEvent {
  timestamp: string;
  toolName: string;
  userId: string;
  sessionId: string;
  action: "approved" | "denied";
  reason?: string;
  riskTier: RiskTier;
  requiredApprovals: number;
  providedApprovals: number;
  network: string;
}

export class CapabilityAuditLogger {
  private logs: AuditEvent[] = [];

  public log(event: Omit<AuditEvent, "timestamp">): AuditEvent {
    const fullEvent: AuditEvent = {
      ...event,
      timestamp: new Date().toISOString(),
    };
    this.logs.push(fullEvent);
    // Output structured JSON log for observability
    console.log(JSON.stringify({
      source: "CapabilityAuditLogger",
      ...fullEvent,
    }));
    return fullEvent;
  }

  public getLogs(): AuditEvent[] {
    return [...this.logs];
  }

  public clearLogs(): void {
    this.logs = [];
  }
}

export const capabilityAuditLogger = new CapabilityAuditLogger();
