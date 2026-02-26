# Agent Tools Documentation

This document is automatically generated. Do not edit manually.

## Table of Contents

- [CONTACTS](#contacts)
  - [contact_tool](#contact-tool)
- [GENERAL](#general)
  - [get_xlm_liquidity](#get-xlm-liquidity)
- [META](#meta)
  - [meta_tool](#meta-tool)
- [PRICE](#price)
  - [price_tool](#price-tool)
- [QA](#qa)
  - [qa_tool](#qa-tool)
- [SECURITY](#security)
  - [risk_analysis_tool](#risk-analysis-tool)
- [SOROBAN](#soroban)
  - [soroban_contract_state](#soroban-contract-state)
  - [soroban_invoke](#soroban-invoke)
- [TRADING](#trading)
  - [swap_tool](#swap-tool)
- [WALLET](#wallet)
  - [wallet_tool](#wallet-tool)

---

## CONTACTS

### contact_tool

Manage contacts: create, list, and delete contacts.

**Version:** 1.0.0

#### Parameters

| Parameter | Type   | Required | Description                      | Options                    |
| --------- | ------ | -------- | -------------------------------- | -------------------------- |
| operation | string | Yes      | The contact operation to perform | `create`, `list`, `delete` |
| payload   | object | No       | Payload for the operation        | -                          |

#### Examples

- save this address 0x123 as my_btc_wallet
- list all my contacts
- remove my_btc_wallet from my contact list

---

## GENERAL

### get_xlm_liquidity

Fetch real-time liquidity data for XLM trading pairs using the configured Stellar Horizon network.

**Version:** 1.0.0

#### Parameters

| Parameter   | Type   | Required | Description | Options |
| ----------- | ------ | -------- | ----------- | ------- |
| assetCode   | string | Yes      |             | -       |
| assetIssuer | string | Yes      |             | -       |
| depthLimit  | number | No       |             | -       |

---

## META

### meta_tool

Provides information about the agent (name, capabilities, version).

**Version:** 1.0.0

#### Parameters

| Parameter | Type   | Required | Description                   | Options                                                      |
| --------- | ------ | -------- | ----------------------------- | ------------------------------------------------------------ |
| operation | string | Yes      | The meta operation to perform | `get_name`, `get_capabilities`, `get_version`, `get_creator` |

#### Examples

- What is your name?
- What can you do?
- What version are you?

---

## PRICE

### price_tool

Get real-time asset prices from Stellar DEX with Redis caching for fast lookups

**Version:** 1.0.0

#### Parameters

| Parameter | Type   | Required | Description                                 | Options                                                   |
| --------- | ------ | -------- | ------------------------------------------- | --------------------------------------------------------- |
| operation | string | Yes      | The price operation to perform              | `get_price`, `get_prices`, `get_orderbook`, `cache_stats` |
| from      | string | No       | Source asset symbol                         | `XLM`, `USDC`, `USDT`                                     |
| to        | string | No       | Target asset symbol                         | `XLM`, `USDC`, `USDT`                                     |
| amount    | number | No       | Amount to get price for (default: 1)        | -                                                         |
| pairs     | array  | No       | Array of asset pairs for batch price lookup | -                                                         |
| limit     | number | No       | Limit for orderbook depth (default: 20)     | -                                                         |

#### Examples

- What's the price of XLM in USDC?
- Get price for 100 XLM to USDT
- Show me the orderbook for XLM/USDC
- Get prices for multiple pairs
- Show cache statistics

---

## QA

### qa_tool

Answer user questions about transactions, balances, and contacts.

**Version:** 1.0.0

#### Parameters

| Parameter | Type   | Required | Description                                            | Options |
| --------- | ------ | -------- | ------------------------------------------------------ | ------- |
| operation | string | Yes      | The operation to perform                               | `ask`   |
| payload   | object | Yes      | Payload containing the user query and optional context | -       |

#### Examples

- who did I send STRK to yesterday?
- can you help me transfer money?
- is it safe to perform this transaction?
- what’s my wallet balance?

---

## SECURITY

### risk_analysis_tool

Analyze sandwich attack and flash swap risks for DEX swaps

**Version:** 1.0.0

#### Parameters

| Parameter | Type   | Required | Description         | Options               |
| --------- | ------ | -------- | ------------------- | --------------------- |
| from      | string | Yes      | Source token symbol | `XLM`, `USDC`, `USDT` |
| to        | string | Yes      | Target token symbol | `XLM`, `USDC`, `USDT` |
| amount    | number | Yes      | Amount to analyze   | -                     |

#### Examples

- Analyze risk for swapping 1000 XLM to USDC
- Check sandwich attack risk for 500 USDC to XLM

---

## SOROBAN

### soroban_contract_state

Query the state of a Soroban smart contract for DeFi decision making. Supports querying reserves, balances, rates, and other contract state.

**Version:** 1.0.0

#### Parameters

| Parameter       | Type    | Required | Description                                      | Options              |
| --------------- | ------- | -------- | ------------------------------------------------ | -------------------- |
| network         | string  | No       | Soroban network to query                         | `testnet`, `mainnet` |
| rpcUrl          | string  | No       | Override Soroban RPC URL                         | -                    |
| contractId      | string  | Yes      | Soroban contract ID (starts with C...)           | -                    |
| stateKeys       | array   | No       | Specific state keys to query (e.g., [            | -                    |
| methods         | array   | No       | Contract methods to call for state (e.g., [      | -                    |
| includeMetadata | boolean | No       | Include contract metadata (admin, version, etc.) | -                    |

#### Examples

- Query reserves and fee from liquidity pool contract CABC...
- Get total supply and borrow rate from lending contract CXYZ... on mainnet
- Check staking balance and pending rewards for contract CDEF...
- Query all token information (name, symbol, decimals, total supply) from CTOKEN...

---

### soroban_invoke

Invoke Soroban smart contracts (read-only simulation)

**Version:** 1.0.0

#### Parameters

| Parameter  | Type   | Required | Description                               | Options              |
| ---------- | ------ | -------- | ----------------------------------------- | -------------------- |
| network    | string | No       | Soroban network to use                    | `testnet`, `mainnet` |
| rpcUrl     | string | No       | Override Soroban RPC URL                  | -                    |
| contractId | string | Yes      | Soroban contract ID (starts with C...)    | -                    |
| method     | string | Yes      | Contract function name to call            | -                    |
| args       | array  | No       | Arguments for the contract method         | -                    |
| source     | object | No       | Optional source account info              | -                    |
| fee        | number | No       | Optional fee override                     | -                    |
| timeoutMs  | number | No       | Optional timeout override in milliseconds | -                    |

---

## TRADING

### swap_tool

Swap tokens on the Stellar DEX using path payments

**Version:** 1.0.0

#### Parameters

| Parameter | Type   | Required | Description         | Options               |
| --------- | ------ | -------- | ------------------- | --------------------- |
| from      | string | Yes      | Source token symbol | `XLM`, `USDC`, `USDT` |
| to        | string | Yes      | Target token symbol | `XLM`, `USDC`, `USDT` |
| amount    | number | Yes      | Amount to swap      | -                     |

#### Examples

- Swap 100 XLM to USDC
- Convert 50 USDC to XLM
- Exchange 10 USDT for XLM

---

## WALLET

### wallet_tool

Wallet operations including balance checking, transfers, and address retrieval

**Version:** 1.0.0

#### Parameters

| Parameter | Type   | Required | Description                         | Options                                  |
| --------- | ------ | -------- | ----------------------------------- | ---------------------------------------- |
| operation | string | Yes      | The wallet operation to perform     | `get_balance`, `transfer`, `get_address` |
| token     | string | No       | Token symbol for balance operations | `STRK`, `ETH`, `DAI`                     |
| to        | string | No       | Recipient address for transfers     | -                                        |
| amount    | number | No       | Amount to transfer                  | -                                        |

#### Examples

- Check my STRK balance
- Transfer 100 STRK to 0x123...
- Get my wallet address

---
