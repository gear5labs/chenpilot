import { CapabilityNetwork } from "./types";

export type RiskTier = "low" | "medium" | "high" | "critical";

export interface ToolMetadata {
  name: string;
  scope: string;
  network: CapabilityNetwork;
  riskTier: RiskTier;
  requiredApprovals: number;
  description?: string;
}

export class CapabilityRegistry {
  private tools: Map<string, ToolMetadata> = new Map();
  private emergencyLockoutActive: boolean = false;
  private safeModeOverrideActive: boolean = false;
  private lockedTools: Set<string> = new Set();

  constructor() {}

  public registerTool(metadata: ToolMetadata): void {
    this.tools.set(metadata.name, metadata);
  }

  public getTool(name: string): ToolMetadata | undefined {
    return this.tools.get(name);
  }

  public getAllTools(): ToolMetadata[] {
    return Array.from(this.tools.values());
  }

  public setEmergencyLockout(active: boolean): void {
    this.emergencyLockoutActive = active;
  }

  public isEmergencyLockoutActive(): boolean {
    return this.emergencyLockoutActive;
  }

  public setSafeModeOverride(active: boolean): void {
    this.safeModeOverrideActive = active;
  }

  public isSafeModeOverrideActive(): boolean {
    return this.safeModeOverrideActive;
  }

  public lockTool(name: string): void {
    this.lockedTools.add(name);
  }

  public unlockTool(name: string): void {
    this.lockedTools.delete(name);
  }

  public isToolLocked(name: string): boolean {
    return this.lockedTools.has(name) || this.emergencyLockoutActive;
  }
}
