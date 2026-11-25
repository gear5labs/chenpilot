# Asset Trust Score Interpretation Guide

## Overview

The Chen Pilot Asset Intelligence subsystem computes a composite `TrustScore` for on-chain assets. This guide defines how integrators, bot adapters, and UI components must interpret trust scores, confidence metrics, and verification statuses.

> [!WARNING]
> **Non-Guarantee Notice**: Trust scores are heuristic aggregations of observable on-chain and off-chain data points. **A high trust score or "verified" status is NOT a security guarantee, financial endorsement, or proof of asset safety.** Assets with high scores can still suffer from market volatility, regulatory actions, smart contract exploits, or sudden issuer behavior changes. Integrators and UI flows must never present a score as proof that an asset is "safe to transact".

---

## 1. Metrics Specification

### 1.1 Overall Score Range (`0 – 100`)
The overall trust score is an integer between `0` and `100`:

| Score Range | Classification | Description |
|---|---|---|
| `80 – 100` | High Heuristic Trust | Strong alignment across observed historical signals. |
| `50 – 79`  | Moderate / Neutral   | Mixed or limited signal history; default for emerging assets. |
| `1 – 49`   | Low Trust            | Significant negative signals or unverified issuers. |
| `0`        | Malicious / Zero     | Explicit malicious signal triggered, or zero verifiable signals. |

### 1.2 Confidence Metric (`0% – 100%`)
The `confidence` field reflects the **breadth and completeness** of fresh signals available for evaluation:

$$\text{Confidence} = \operatorname{round}\left(\frac{\sum \text{weight of fresh observed signals}}{\sum \text{total configured signal weights}} \times 100\right)$$

- **Confidence = 100%**: All configured signals have recent, valid data.
- **Confidence = 0%**: No fresh signals are currently available. In this case, `overall` defaults to `0` and `verificationStatus` is always `unverified`.
- **Low Confidence (< 50%)**: Interpret the overall score with caution; the score reflects only a partial picture of the asset.

### 1.3 Signal Freshness & The 24-Hour Window
Signal data rapidly becomes obsolete in decentralized networks:
- **Maximum Age**: All signals must satisfy $\text{age} \le 24\text{ hours}$ ($86,400,000\text{ ms}$).
- **Stale Signals**: Any signal older than 24 hours is **completely discarded** and excluded from both score and confidence calculations.
- **Clock Tolerance**: Signals with future timestamps ($\text{timestamp} > \text{now}$) are rejected as invalid.

### 1.4 Handling Unknown Signals
- If a signal provider returns a signal type not present in the active `TrustConfig.weights` (or assigned a weight of `0`), it is ignored.
- Unknown signals contribute **zero points** to `overall` and **zero weight** to `confidence`.

---

## 2. Verification Status Matrix

The engine derives a discrete `verificationStatus` alongside numerical scores:

```text
                     ┌─────────────────────────────────────────┐
                     │ Has any signal <= malicious threshold?  │
                     └────────────────────┬────────────────────┘
                                          │
                         Yes ─────────────┴───────────── No
                          │                               │
                          ▼                               ▼
                 [ Status: malicious ]          Is confidence > 0?
                                                          │
                                         Yes ─────────────┴───────────── No
                                          │                               │
                                          ▼                               ▼
                           Is overall >= verified threshold?    [ Status: unverified ]
                                          │
                         Yes ─────────────┴───────────── No
                          │                               │
                          ▼                               ▼
                 [ Status: verified ]           [ Status: unverified ]
```

- **`malicious`**: Hard-coded safety override. If **any** fresh signal evaluates at or below the malicious threshold (default `20`), the asset status is permanently downgraded to `malicious`, regardless of other positive signals.
- **`verified`**: The asset meets the configured threshold (default `80`) with non-zero confidence.
- **`unverified`**: Insufficient data (confidence = 0) or score falls in intermediate range.

---

## 3. Safe Consumer Patterns & Anti-Patterns

### ❌ Anti-Patterns (Do NOT Do This)
- **Do not** display labels like "100% Safe", "Audited & Guaranteed", or "Zero Risk".
- **Do not** bypass user confirmation dialogs solely because an asset has `verificationStatus: "verified"`.
- **Do not** cache trust scores indefinitely; always enforce the 24-hour freshness TTL.

### ✅ Safe Patterns
- **Do** show both `overall` score and `confidence` percentage together (e.g., *"Trust Indicator: 85/100 (60% confidence)"*).
- **Do** warn users prominently when confidence is low or status is `unverified`.
- **Do** block automated routing and transactions if status is `malicious`.
- **Do** include risk disclaimers in user interfaces referencing on-chain heuristics.

---

## 4. Worked Calculation Example

Given configuration:
- Configured weights: `liquidity: 40`, `issuer_age: 30`, `audit_report: 30` (Total weight = `100`).
- Available fresh signals:
  - `liquidity` = `90` (weight 40, age 2h)
  - `issuer_age` = `80` (weight 30, age 12h)
  - `audit_report` = Stale (>26h, discarded)

**Calculation**:
- $\text{Weighted Sum} = (90 \times 40) + (80 \times 30) = 3600 + 2400 = 6000$
- $\text{Overall Score} = \operatorname{round}(6000 / 100) = 60$
- $\text{Observed Weight} = 40 + 30 = 70$
- $\text{Confidence} = \operatorname{round}(70 / 100 \times 100) = 70\%$
- $\text{Status} = \text{unverified}$ (Score 60 is below verified threshold 80; no malicious signals).

*Interpretation*: The asset demonstrates moderate observed indicators with 70% signal coverage, but does not meet full verified criteria and carries no safety guarantee.
