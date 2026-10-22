import { AgentPlanner, PlannerContext } from "../AgentPlanner";

describe("AgentPlanner - Contradictory Financial Constraints", () => {
  let planner: AgentPlanner;

  beforeEach(() => {
    planner = new AgentPlanner();
  });

  it("should reject plan creation when minSlippage is greater than maxSlippage", async () => {
    const context: PlannerContext = {
      userId: "user-123",
      userInput: "swap 100 USDC to XLM",
      constraints: {
        minSlippage: 5,
        maxSlippage: 1,
      },
    };

    await expect(planner.createPlan(context)).rejects.toThrow(
      /Contradictory financial constraints detected/
    );
  });
});
