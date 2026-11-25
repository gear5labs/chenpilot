import * as StellarSdk from "@stellar/stellar-sdk";
import {
  divideDecimals,
  multiplyDecimals,
  parseScaled,
  serializeScaled,
  RoundingMode,
} from "../common/fixedPoint";
import { TradePath } from "./path";

export interface LegMinOutput {
  asset: StellarSdk.Asset;
  quotedOutput: string;
  minOutput: string;
  slippageTolerance: number;
  hopIndex: number;
}

export function computeAggregateMinOutput(
  path: TradePath,
  options: AggregateMinOutputOptions = {},
): AggregateMinOutput {
  const slippageTolerance =
    options.defaultSlippageTolerance ?? DEFAULT_SLIPPAGE_TOLERANCE;
  const roundingMode = options.roundingMode ?? RoundingMode.HALF_UP;
  const decimals = options.decimals ?? DEFAULT_DECIMALS;

  const legs: LegMinOutput[] = [];

  for (let i = 0; i < path.hops; i++) {
    const legAsset = path.path[i + 1];
    const legQuotedOutput =
      i === path.hops - 1 ? path.destinationAmount : path.sourceAmount;
    const legSlippage = slippageTolerance;

    const quotedScaled = parseScaled(legQuotedOutput, decimals);
    const slippageFactor = 1 - legSlippage;
    const minScaled = multiplyDecimals(
      quotedScaled,
      0,
      BigInt(Math.floor(slippageFactor * 10 ** decimals)),
      0,
      decimals,
      roundingMode,
    );
    const minOutput = serializeScaled(minScaled, decimals);

    legs.push({
      asset: legAsset,
      quotedOutput: legQuotedOutput,
      minOutput,
      slippageTolerance: legSlippage,
      hopIndex: i,
    });
  }

  const quotedOutput = path.destinationAmount;
  const finalMin = legs[legs.length - 1]?.minOutput ?? "0";
  const finalMinScaled = parseScaled(finalMin, decimals);
  const quotedScaled = parseScaled(quotedOutput, decimals);

  let effectiveSlippage = 0;
  if (quotedScaled > 0n) {
    effectiveSlippage = 1 - Number(finalMinScaled) / Number(quotedScaled);
  }

  const isValid = finalMinScaled <= quotedScaled;

  return {
    destinationAsset: path.path[path.path.length - 1],
    quotedOutput,
    minOutput: finalMin,
    effectiveSlippage,
    legs,
    isValid,
  };
}

export function assertAggregateMinOutput(
  aggregate: AggregateMinOutput,
  liveOutput: string,
): void {
  const liveScaled = parseScaled(liveOutput, 7);
  const minScaled = parseScaled(aggregate.minOutput, 7);

  if (liveScaled < minScaled) {
    throw new Error(
      `Aggregate minimum output violation: live output ${liveOutput} ` +
        `is below minimum ${aggregate.minOutput} ` +
        `(effective slippage ${(aggregate.effectiveSlippage * 100).toFixed(2)}%)`,
    );
  }
}

export interface AggregateMinOutput {
  destinationAsset: StellarSdk.Asset;
  quotedOutput: string;
  minOutput: string;
  effectiveSlippage: number;
  legs: LegMinOutput[];
  isValid: boolean;
}

export interface AggregateMinOutputOptions {
  defaultSlippageTolerance?: number;
  roundingMode?: RoundingMode;
  decimals?: number;
}

const DEFAULT_SLIPPAGE_TOLERANCE = 0.005;
const DEFAULT_DECIMALS = 7;