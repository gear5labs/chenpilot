import { AgentOrchestrator } from "./core/AgentOrchestrator.js";
import { IntentParser } from "./core/IntentParser.js";
import { StarknetWalletAgent } from "./agents/StarknetWalletAgent.js";
import { AtomicSwapAgent } from "./agents/AtomicSwapAgent.js";
import { getEnv } from "./config/env.js";

async function main() {
  const orchestrator = new AgentOrchestrator();
  orchestrator.registerAgent(new StarknetWalletAgent());
  orchestrator.registerAgent(new AtomicSwapAgent());

  const { ANTHROPIC_API_KEY, ANTHROPIC_MODEL } = getEnv();
  const parser = new IntentParser(ANTHROPIC_API_KEY, ANTHROPIC_MODEL);

  const input = process.argv.slice(2).join(" ") || "create_account on starknet";
  const parsed = await parser.parse(input);
  const result = await orchestrator.routeIntent(parsed.intent);
  console.log({ parsed: parsed.intent, result });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
