import { assessNetworkClarification } from "../../src/services/networkConfig";

describe("assessNetworkClarification", () => {
  it("does not ask when the request names no network", () => {
    const result = assessNetworkClarification("Check my XLM balance");
    expect(result.needsClarification).toBe(false);
    expect(result.detectedNetworks).toEqual([]);
  });

  it("does not ask when the request names one network", () => {
    const result = assessNetworkClarification("Swap 10 XLM on testnet");
    expect(result.needsClarification).toBe(false);
    expect(result.detectedNetworks).toEqual(["testnet"]);
  });

  it("asks before planning when two networks are named", () => {
    const result = assessNetworkClarification(
      "Swap 10 XLM on testnet and mainnet"
    );
    expect(result.needsClarification).toBe(true);
    expect(result.detectedNetworks).toEqual(["public", "testnet"]);
    expect(result.question).toMatch(/Which network should I use before planning/);
    expect(result.question).toMatch(/public, testnet/);
  });

  it("asks when the request refers to a network without naming one", () => {
    const result = assessNetworkClarification("Send 5 XLM on the network");
    expect(result.needsClarification).toBe(true);
    expect(result.detectedNetworks).toEqual([]);
    expect(result.question).toMatch(/public, testnet, or futurenet/);
  });
});
