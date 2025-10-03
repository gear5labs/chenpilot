import { validateQuery } from "../validationService";
import { executionAgent } from "./exectutionagent";
import { agentLLM } from "../agent";
import { promptGenerator } from "../registry/PromptGenerator";
import { toolAutoDiscovery } from "../registry/ToolAutoDiscovery";
import { WorkflowPlan, WorkflowStep } from "../types";
import { memoryStore } from "../memory/memory";
import { vesuService } from "../../services/VesuService";
import { VesuLendingOperation, VesuPool, VesuPosition, VesuQuote } from "../../types/vesu";
import { Account } from "starknet";
import { walletService } from "../../services/WalletService";

export interface DeFiIntent {
  action: 'lend' | 'borrow' | 'withdraw' | 'repay' | 'check_balance' | 'get_apy' | 'health_check' | 'liquidate' | 'claim_rewards' | 'add_collateral' | 'remove_collateral';
  asset?: string;
  amount?: string;
  poolId?: string;
  userAddress?: string;
  targetUser?: string; // For liquidation operations
  requiresConfirmation: boolean;
}

export interface DeFiResult {
  success: boolean;
  data?: any;
  transactionHash?: string;
}

export class IntentAgent {
  private initialized = false;

  private async getStarknetAddress(userId: string): Promise<string> {
    try {
      return await walletService.getUserAddress(userId);
    } catch (error) {
      throw new Error(`Failed to get Starknet address for user: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async handle(input: string, userId: string) {
    if (!this.initialized) {
      await toolAutoDiscovery.initialize();
      this.initialized = true;
    }

    const isValid = await validateQuery(input, userId);
    if (!isValid) {
      return { success: false, error: "Invalid request format" };
    }

    // Check if this is a DeFi-related query
    const isDeFiQuery = this.isDeFiCommand(input);
    
    if (isDeFiQuery) {
      // Handle DeFi commands directly
      return await this.handleDeFiCommand(input, userId);
    } else {
      // Handle other commands through normal workflow
      const workflow = await this.planWorkflow(input, userId);
      console.log(workflow);
      if (!workflow.workflow.length) {
        return { success: false, error: "Could not determine workflow" };
      }
      return executionAgent.run(workflow, userId, input);
    }
  }

  private async planWorkflow(
    input: string,
    userId: string
  ): Promise<WorkflowPlan> {
    try {
      const prompt = promptGenerator
        .generateIntentPrompt()
        .replace("{{USER_INPUT}}", input)
        .replace("{{USER_ID}}", userId);

      const parsed = await agentLLM.callLLM(userId, prompt, "", true);
      const steps: WorkflowStep[] = Array.isArray(parsed?.workflow)
        ? parsed.workflow
        : [];
      memoryStore.add(userId, `User: ${input}`);
      return { workflow: steps };
    } catch (err) {
      console.error("LLM workflow parsing failed:", err);
      return { workflow: [] };
    }
  }

  // DeFi command detection
  private isDeFiCommand(query: string): boolean {
    const defiKeywords = [
      'lend', 'borrow', 'withdraw', 'repay', 'apy', 'yield', 'lending', 'borrowing',
      'collateral', 'debt', 'health factor', 'liquidation', 'liquidate', 'pool', 'deposit', 'rewards', 'claim', 'add collateral', 'remove collateral',
      'vesu', 'defi', 'earn', 'interest', 'rate'
    ];
    
    const lowerQuery = query.toLowerCase();
    return defiKeywords.some(keyword => lowerQuery.includes(keyword));
  }

  // DeFi command handling
  private async handleDeFiCommand(input: string, userId: string): Promise<DeFiResult> {
    try {
      await vesuService.initialize();

      const intent = await this.parseDeFiIntent(input, userId);
      console.log("Parsed DeFi intent:", intent);

      switch (intent.action) {
        case 'lend':
          return await this.handleLend(intent, userId);
        case 'borrow':
          return await this.handleBorrow(intent, userId);
        case 'withdraw':
          return await this.handleWithdraw(intent, userId);
        case 'repay':
          return await this.handleRepay(intent, userId);
        case 'check_balance':
          return await this.handleCheckBalance(intent, userId);
        case 'get_apy':
          return await this.handleGetAPY(intent, userId);
        case 'health_check':
          return await this.handleHealthCheck(intent, userId);
        case 'liquidate':
          return await this.handleLiquidate(intent, userId);
        case 'claim_rewards':
          return await this.handleClaimRewards(intent, userId);
        case 'add_collateral':
          return await this.handleAddCollateral(intent, userId);
        case 'remove_collateral':
          return await this.handleRemoveCollateral(intent, userId);
        default:
          return {
            success: false,
            data: `Unsupported DeFi action: ${intent.action}`
          };
      }
    } catch (error) {
      console.error("DeFi command error:", error);
      return {
        success: false,
        data: error instanceof Error ? error.message : 'Unknown error occurred'
      };
    }
  }

  // DeFi intent parsing
  private async parseDeFiIntent(input: string, userId: string): Promise<DeFiIntent> {
    const prompt = `
    You are a DeFi agent that parses natural language commands for lending and borrowing operations on Vesu protocol.

    Parse the following user input and extract the DeFi intent. Respond with JSON only.

    Supported actions:
    - lend: Deposit assets into a lending pool
    - borrow: Borrow assets from a lending pool
    - withdraw: Withdraw assets from a lending pool
    - repay: Repay borrowed assets
    - check_balance: Check user's lending/borrowing positions
    - get_apy: Get current APY for lending pools
    - health_check: Check user's health factor and liquidation risk
    - liquidate: Liquidate undercollateralized positions
    - claim_rewards: Claim DeFi Spring rewards
    - add_collateral: Add collateral to existing positions
    - remove_collateral: Remove collateral from existing positions

    Supported assets: ETH, STRK, USDC, USDT, WBTC

    Examples:
    - "Lend 100 STRK" -> {"action": "lend", "asset": "STRK", "amount": "100", "requiresConfirmation": true}
    - "Borrow 500 USDC" -> {"action": "borrow", "asset": "USDC", "amount": "500", "requiresConfirmation": true}
    - "What's my lending balance?" -> {"action": "check_balance", "requiresConfirmation": false}
    - "Show me the best APY" -> {"action": "get_apy", "requiresConfirmation": false}
    - "Check my health factor" -> {"action": "health_check", "requiresConfirmation": false}
    - "Liquidate USDC position for user 0x123" -> {"action": "liquidate", "asset": "USDC", "targetUser": "0x123", "requiresConfirmation": true}
    - "Claim my rewards" -> {"action": "claim_rewards", "requiresConfirmation": true}
    - "Add 50 STRK as collateral" -> {"action": "add_collateral", "asset": "STRK", "amount": "50", "requiresConfirmation": true}
    - "Remove 25 USDC collateral" -> {"action": "remove_collateral", "asset": "USDC", "amount": "25", "requiresConfirmation": true}

    User input: ${input}
`;

    const parsed = await agentLLM.callLLM(userId, prompt, "", true);
    memoryStore.add(userId, `DeFi Intent: ${JSON.stringify(parsed)}`);

    return {
      action: parsed.action || 'check_balance',
      asset: parsed.asset,
      amount: parsed.amount,
      poolId: parsed.poolId,
      userAddress: parsed.userAddress,
      requiresConfirmation: parsed.requiresConfirmation || false
    };
  }

  // DeFi handler methods
  private async handleLend(intent: DeFiIntent, userId: string): Promise<DeFiResult> {
    try {
      if (!intent.asset || !intent.amount) {
        return {
          success: false,
          data: "Asset and amount are required for lending",
        };
      }

      const pools = await vesuService.getAvailablePools();
      const targetPool = pools.find(pool => pool.asset === intent.asset);
      
      if (!targetPool) {
        return {
          success: false,
          data: `No lending pool found for asset: ${intent.asset}`,
        };
      }

      const humanReadableMessage = `Ready to lend ${intent.amount} ${intent.asset} to ${targetPool.poolName || targetPool.symbol} pool with ${targetPool.apy}% APY. This will earn you approximately ${(parseFloat(intent.amount) * targetPool.apy / 100).toFixed(4)} ${intent.asset} per year.`;
      
      return {
        success: true,
        data: humanReadableMessage
      };
    } catch (error) {
        return {
          success: false,
          data: error instanceof Error ? error.message : 'Failed to process lending request',
        };
    }
  }

  private async handleBorrow(intent: DeFiIntent, userId: string): Promise<DeFiResult> {
    try {
      if (!intent.asset || !intent.amount) {
        return {
          success: false,
          data: "Asset and amount are required for borrowing",
        };
      }

      const pools = await vesuService.getAvailablePools();
      const targetPool = pools.find(pool => pool.asset === intent.asset);
      
      if (!targetPool) {
        return {
          success: false,
          data: `No borrowing pool found for asset: ${intent.asset}`,
        };
      }

      // Check user's health factor before allowing borrowing
      const healthCheck = await vesuService.checkHealthFactor(intent.userAddress || userId);
      
      if (healthCheck.status === 'critical') {
        return {
          success: false,
          data: "Cannot borrow: Health factor is critically low. Please add collateral or repay existing debt first.",
        };
      }

      const humanReadableMessage = `Ready to borrow ${intent.amount} ${intent.asset} from ${targetPool.poolName || targetPool.symbol} pool. Borrow APR: ${targetPool.borrowApr?.toFixed(2) || 'N/A'}%. Your current health factor: ${healthCheck.healthFactor.toFixed(2)}.`;
      
      return {
        success: true,
        data: humanReadableMessage
      };
    } catch (error) {
        return {
          success: false,
          data: error instanceof Error ? error.message : 'Failed to process borrowing request',
        };
    }
  }

  private async handleWithdraw(intent: DeFiIntent, userId: string): Promise<DeFiResult> {
    try {
      if (!intent.asset || !intent.amount) {
        return {
          success: false,
          data: "Asset and amount are required for withdrawal",
        };
      }

      const positions = await vesuService.getUserPositions(intent.userAddress || userId);
      const targetPosition = positions.find(pos => pos.asset === intent.asset);
      
      if (!targetPosition) {
        return {
          success: false,
          data: `No lending position found for asset: ${intent.asset}`,
        };
      }

      const withdrawAmount = BigInt(intent.amount);
      const suppliedAmount = BigInt(targetPosition.suppliedAmount);
      
      if (withdrawAmount > suppliedAmount) {
          return {
            success: false,
            data: `Insufficient balance. Available: ${targetPosition.suppliedAmount}, Requested: ${intent.amount}`
          };
      }

      const remainingBalance = (suppliedAmount - withdrawAmount).toString();
      const humanReadableMessage = `Ready to withdraw ${intent.amount} ${intent.asset} from lending pool. Remaining balance: ${remainingBalance} ${intent.asset}.`;
      
      return {
        success: true,
        data: humanReadableMessage
      };
    } catch (error) {
        return {
          success: false,
          data: error instanceof Error ? error.message : 'Failed to process withdrawal request'
        };
    }
  }

  private async handleRepay(intent: DeFiIntent, userId: string): Promise<DeFiResult> {
    try {
      if (!intent.asset || !intent.amount) {
        return {
          success: false,
          data: "Asset and amount are required for repayment",
        };
      }

      const positions = await vesuService.getUserPositions(intent.userAddress || userId);
      const targetPosition = positions.find(pos => pos.asset === intent.asset);
      
      if (!targetPosition) {
        return {
          success: false,
          data: `No borrowing position found for asset: ${intent.asset}`,
        };
      }

      const repayAmount = BigInt(intent.amount);
      const borrowedAmount = BigInt(targetPosition.borrowedAmount);
      
      if (repayAmount > borrowedAmount) {
        const excessAmount = (repayAmount - borrowedAmount).toString();
        const humanReadableMessage = `Repaying full debt of ${targetPosition.borrowedAmount} ${intent.asset}. Excess amount of ${excessAmount} ${intent.asset} will be returned to you.`;
        
        return {
          success: true,
          data: humanReadableMessage
        };
      }

      const remainingDebt = (borrowedAmount - repayAmount).toString();
      const humanReadableMessage = `Ready to repay ${intent.amount} ${intent.asset} of borrowed amount. Remaining debt: ${remainingDebt} ${intent.asset}.`;
      
      return {
        success: true,
        data: humanReadableMessage
      };
    } catch (error) {
        return {
          success: false,
          data: error instanceof Error ? error.message : 'Failed to process repayment request'
        };
    }
  }

  private async handleCheckBalance(intent: DeFiIntent, userId: string): Promise<DeFiResult> {
    try {
      const userAddress = intent.userAddress || await this.getStarknetAddress(userId);
      const positions = await vesuService.getUserPositions(userAddress);
      
      if (positions.length === 0) {
        const humanReadableMessage = "No active lending or borrowing positions found.";
        return {
          success: true,
          data: humanReadableMessage
        };
      }

      const totalCollateral = positions.reduce((sum, pos) => sum + BigInt(pos.collateralValue), BigInt(0));
      const totalDebt = positions.reduce((sum, pos) => sum + BigInt(pos.debtValue), BigInt(0));
      const netValue = totalCollateral - totalDebt;

      const positionSummary = positions.map(pos => 
        `${pos.asset}: ${pos.suppliedAmount} supplied, ${pos.borrowedAmount} borrowed`
      ).join('; ');

      const humanReadableMessage = `Found ${positions.length} active positions. ${positionSummary}. Total collateral: ${totalCollateral.toString()}, Total debt: ${totalDebt.toString()}, Net value: ${netValue.toString()}.`;

      return {
        success: true,
        data: humanReadableMessage
      };
    } catch (error) {
        return {
          success: false,
          data: error instanceof Error ? error.message : 'Failed to check balance'
        };
    }
  }

  private async handleGetAPY(intent: DeFiIntent, userId: string): Promise<DeFiResult> {
    try {
      const pools = await vesuService.getAvailablePools();
      const poolStats = await vesuService.getPoolStats();
      
      if (intent.asset) {
        const targetPool = pools.find(pool => pool.asset === intent.asset?.toUpperCase());
        if (!targetPool) {
            return {
              success: false,
              data: `No pool found for asset: ${intent.asset}`
            };
        }
        
        const humanReadableMessage = `Current APY for ${intent.asset}: ${targetPool.apy}% (Borrow APR: ${targetPool.borrowApr?.toFixed(2) || 'N/A'}%). Pool utilization: ${(targetPool.utilizationRate * 100).toFixed(1)}%.`;
        
        return {
          success: true,
          data: humanReadableMessage
        };
      }

      // Return all pools sorted by APY with comprehensive stats
      const sortedPools = pools.sort((a, b) => b.apy - a.apy);
      const bestPool = sortedPools[0];
      const topPools = sortedPools.slice(0, 3);

      const humanReadableMessage = `Best APY available: ${bestPool.apy}% for ${bestPool.asset} (${bestPool.poolName || 'Vesu Pool'}). Top pools: ${topPools.map(pool => `${pool.asset} (${pool.apy}%)`).join(', ')}. Total ${poolStats.totalPools} pools available.`;

      return {
        success: true,
        data: humanReadableMessage
      };
    } catch (error) {
        return {
          success: false,
          data: error instanceof Error ? error.message : 'Failed to get APY information',
        };
    }
  }

  private async handleHealthCheck(intent: DeFiIntent, userId: string): Promise<DeFiResult> {
    try {
      const healthCheck = await vesuService.checkHealthFactor(intent.userAddress || userId);
      
      const humanReadableMessage = `Your health factor is ${healthCheck.healthFactor.toFixed(2)} (${healthCheck.status}). ${healthCheck.status === 'healthy' ? 'Your position is safe.' : healthCheck.status === 'warning' ? 'Consider adding more collateral.' : 'Your position is at risk of liquidation.'}`;
      
      return {
        success: true,
        data: humanReadableMessage
      };
    } catch (error) {
        return {
          success: false,
          data: error instanceof Error ? error.message : 'Failed to check health factor',
        };
    }
  }

  // Execute lending operation method
  async executeLendingOperation(operation: VesuLendingOperation, account: Account): Promise<DeFiResult> {
    try {
      const result = await vesuService.executeLendingOperation(operation, account);
      
      if (result.success) {
        const humanReadableMessage = `Successfully executed ${operation.operation} operation for ${operation.amount}. Transaction hash: ${result.transactionHash || 'Pending'}.`;
        return {
          success: true,
          data: humanReadableMessage,
          transactionHash: result.transactionHash
        };
      } else {
        return {
          success: false,
          data: result.error || 'Failed to execute lending operation'
        };
      }
    } catch (error) {
      return {
        success: false,
        data: error instanceof Error ? error.message : 'Failed to execute lending operation'
      };
    }
  }

  // New advanced operation handlers
  private async handleLiquidate(intent: DeFiIntent, userId: string): Promise<DeFiResult> {
    try {
      if (!intent.asset || !intent.targetUser) {
        return {
          success: false,
          data: "Asset and target user address are required for liquidation"
        };
      }

      // Check if target user has liquidatable positions
      const targetPositions = await vesuService.getUserPositions(intent.targetUser);
      const targetPosition = targetPositions.find(pos => pos.asset === intent.asset);
      
      if (!targetPosition) {
        return {
          success: false,
          data: `No borrowing position found for ${intent.asset} for user ${intent.targetUser}`
        };
      }

      // Check if position is liquidatable (health factor < 1.0)
      if (targetPosition.healthFactor >= 1.0) {
        return {
          success: false,
          data: `Position is not liquidatable. Health factor: ${targetPosition.healthFactor.toFixed(2)} (must be < 1.0)`
        };
      }

      const humanReadableMessage = `Ready to liquidate ${intent.asset} position for user ${intent.targetUser}. Borrowed amount: ${targetPosition.borrowedAmount}, Health factor: ${targetPosition.healthFactor.toFixed(2)}. This will repay their debt and transfer their collateral to you.`;
      
      return {
        success: true,
        data: humanReadableMessage
      };
    } catch (error) {
      return {
        success: false,
        data: error instanceof Error ? error.message : 'Failed to process liquidation request'
      };
    }
  }

  private async handleClaimRewards(intent: DeFiIntent, userId: string): Promise<DeFiResult> {
    try {
      // Check for available DeFi Spring rewards
      const userAddress = intent.userAddress || await this.getStarknetAddress(userId);
      const positions = await vesuService.getUserPositions(userAddress);
      
      if (positions.length === 0) {
        return {
          success: false,
          data: "No active positions found. You need to have supplied assets to be eligible for DeFi Spring rewards."
        };
      }

      // Calculate estimated rewards based on position size and duration
      const totalCollateral = positions.reduce((sum, pos) => sum + BigInt(pos.collateralValue), BigInt(0));
      const estimatedRewards = Number(totalCollateral) * 0.05; // 5% of collateral as estimated reward

      const humanReadableMessage = `You are eligible for DeFi Spring rewards! Based on your ${positions.length} active positions with total collateral value of ${totalCollateral.toString()}, you can claim approximately ${estimatedRewards.toFixed(4)} STRK tokens. Rewards are distributed based on your participation in Vesu lending pools.`;
      
      return {
        success: true,
        data: humanReadableMessage
      };
    } catch (error) {
      return {
        success: false,
        data: error instanceof Error ? error.message : 'Failed to check rewards eligibility'
      };
    }
  }

  private async handleAddCollateral(intent: DeFiIntent, userId: string): Promise<DeFiResult> {
    try {
      if (!intent.asset || !intent.amount) {
        return {
          success: false,
          data: "Asset and amount are required for adding collateral"
        };
      }

      const userAddress = intent.userAddress || await this.getStarknetAddress(userId);
      const positions = await vesuService.getUserPositions(userAddress);
      const targetPosition = positions.find(pos => pos.asset === intent.asset);
      
      if (!targetPosition) {
        return {
          success: false,
          data: `No position found for asset: ${intent.asset}. You need to have a borrowing position to add collateral.`
        };
      }

      const newCollateralValue = Number(targetPosition.collateralValue) + parseFloat(intent.amount);
      const newHealthFactor = Number(targetPosition.debtValue) > 0 ? newCollateralValue / Number(targetPosition.debtValue) : 999.99;

      const humanReadableMessage = `Ready to add ${intent.amount} ${intent.asset} as collateral. This will improve your health factor from ${targetPosition.healthFactor.toFixed(2)} to ${newHealthFactor.toFixed(2)}, reducing your liquidation risk.`;
      
      return {
        success: true,
        data: humanReadableMessage
      };
    } catch (error) {
      return {
        success: false,
        data: error instanceof Error ? error.message : 'Failed to process add collateral request'
      };
    }
  }

  private async handleRemoveCollateral(intent: DeFiIntent, userId: string): Promise<DeFiResult> {
    try {
      if (!intent.asset || !intent.amount) {
        return {
          success: false,
          data: "Asset and amount are required for removing collateral"
        };
      }

      const userAddress = intent.userAddress || await this.getStarknetAddress(userId);
      const positions = await vesuService.getUserPositions(userAddress);
      const targetPosition = positions.find(pos => pos.asset === intent.asset);
      
      if (!targetPosition) {
        return {
          success: false,
          data: `No position found for asset: ${intent.asset}. You need to have a borrowing position to remove collateral.`
        };
      }

      const removeAmount = parseFloat(intent.amount);
      const currentCollateral = Number(targetPosition.collateralValue);
      
      if (removeAmount > currentCollateral) {
        return {
          success: false,
          data: `Cannot remove ${intent.amount} ${intent.asset}. Available collateral: ${currentCollateral}`
        };
      }

      const newCollateralValue = currentCollateral - removeAmount;
      const newHealthFactor = Number(targetPosition.debtValue) > 0 ? newCollateralValue / Number(targetPosition.debtValue) : 999.99;

      if (newHealthFactor < 1.5) {
        return {
          success: false,
          data: `Cannot remove collateral. This would reduce your health factor to ${newHealthFactor.toFixed(2)}, which is below the safe threshold of 1.5. Consider repaying some debt first.`
        };
      }

      const humanReadableMessage = `Ready to remove ${intent.amount} ${intent.asset} collateral. Your health factor will change from ${targetPosition.healthFactor.toFixed(2)} to ${newHealthFactor.toFixed(2)}. Position remains safe.`;
      
      return {
        success: true,
        data: humanReadableMessage
      };
    } catch (error) {
      return {
        success: false,
        data: error instanceof Error ? error.message : 'Failed to process remove collateral request'
      };
    }
  }
}

export const intentAgent = new IntentAgent();
