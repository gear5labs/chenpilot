import { CapabilityRegistry, ToolMetadata } from "../CapabilityRegistry";

describe("CapabilityRegistry", () => {
  let registry: CapabilityRegistry;

  beforeEach(() => {
    registry = new CapabilityRegistry();
  });

  it("should register and retrieve tool metadata", () => {
    const metadata: ToolMetadata = {
      name: "swap_tokens",
      scope: "defi:swap",
      network: "stellar",
      riskTier: "medium",
      requiredApprovals: 1,
      description: "Swap tokens on DEX",
    };

    registry.registerTool(metadata);
    expect(registry.getTool("swap_tokens")).toEqual(metadata);
    expect(registry.getAllTools()).toContainEqual(metadata);
  });

  it("should handle emergency lockout", () => {
    const metadata: ToolMetadata = {
      name: "transfer_funds",
      scope: "defi:transfer",
      network: "bitcoin",
      riskTier: "critical",
      requiredApprovals: 2,
    };

    registry.registerTool(metadata);
    expect(registry.isToolLocked("transfer_funds")).toBe(false);

    registry.setEmergencyLockout(true);
    expect(registry.isEmergencyLockoutActive()).toBe(true);
    expect(registry.isToolLocked("transfer_funds")).toBe(true);

    registry.setEmergencyLockout(false);
    expect(registry.isEmergencyLockoutActive()).toBe(false);
    expect(registry.isToolLocked("transfer_funds")).toBe(false);
  });

  it("should handle individual tool locking and unlocking", () => {
    const metadata: ToolMetadata = {
      name: "borrow_asset",
      scope: "defi:borrow",
      network: "stellar",
      riskTier: "high",
      requiredApprovals: 1,
    };

    registry.registerTool(metadata);
    expect(registry.isToolLocked("borrow_asset")).toBe(false);

    registry.lockTool("borrow_asset");
    expect(registry.isToolLocked("borrow_asset")).toBe(true);

    registry.unlockTool("borrow_asset");
    expect(registry.isToolLocked("borrow_asset")).toBe(false);
  });

  it("should manage safe-mode override status", () => {
    expect(registry.isSafeModeOverrideActive()).toBe(false);
    registry.setSafeModeOverride(true);
    expect(registry.isSafeModeOverrideActive()).toBe(true);
    registry.setSafeModeOverride(false);
    expect(registry.isSafeModeOverrideActive()).toBe(false);
  });
});
