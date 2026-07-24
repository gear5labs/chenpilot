#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contractclient, Address, Env, Vec, symbol_short};

// ---------------------------------------------------------------------------
// Reusable protected-execution primitive
// ---------------------------------------------------------------------------

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceData {
    pub price: i128,
    pub decimals: u32,
    pub timestamp: u64,
}

#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracleTrait {
    fn get_price(env: Env, asset: Address) -> Option<PriceData>;
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    ExecutionContext,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub oracle: Address,
    pub threshold_bps: u32,
}

/// Generic execution context for protected execution primitive.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionContext {
    pub caller: Address,
    pub operation: Bytes, // e.g. "swap", "deposit", "withdraw"
    pub intent_price: i128,
    pub min_amount_out: i128,
    pub max_slippage_bps: u32,
    pub deadline_ledger: u32,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExecutionResult {
    pub approved: bool,
    pub market_price: i128,
    pub deviation_bps: u128,
    pub reason: Bytes,
}

#[contract]
pub struct LiquidityVaultContract;

#[contractimpl]
impl LiquidityVaultContract {
    pub fn initialize(env: Env, admin: Address, oracle: Address, threshold_bps: u32) {
        if env.storage().instance().has(&DataKey::Config) {
            panic!("Already initialized");
        }
        let config = Config { admin, oracle, threshold_bps };
        env.storage().instance().set(&DataKey::Config, &config);
    }

    pub fn update_config(env: Env, config: Config) {
        let current: Config = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        current.admin.require_auth();
        env.storage().instance().set(&DataKey::Config, &config);
    }

    /// Generic protected execution: validates intent vs market conditions.
    /// Returns ExecutionResult indicating whether the operation is approved.
    pub fn execute_protected(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        ctx: ExecutionContext,
    ) -> ExecutionResult {
        if amount_in <= 0 || ctx.intent_price <= 0 {
            return ExecutionResult {
                approved: false,
                market_price: 0,
                deviation_bps: 0,
                reason: Bytes::from_slice(&env, b"invalid_params"),
            };
        }

        let config: Config = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        let current_ledger = env.ledger().sequence();

        // Deadline check
        if current_ledger > ctx.deadline_ledger {
            return ExecutionResult {
                approved: false,
                market_price: 0,
                deviation_bps: 0,
                reason: Bytes::from_slice(&env, b"deadline_exceeded"),
            };
        }

        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let p_in = oracle.get_price(&token_in).unwrap_or_else(|| panic!("Oracle price missing for token_in"));
        let p_out = oracle.get_price(&token_out).unwrap_or_else(|| panic!("Oracle price missing for token_out"));

        let p_in_norm = normalize_price(p_in.price, p_in.decimals, 8);
        let p_out_norm = normalize_price(p_out.price, p_out.decimals, 8);

        let market_price = p_in_norm
            .checked_mul(100_000_000)
            .expect("Price math overflow")
            .checked_div(p_out_norm)
            .expect("Price math division error");

        let diff = if market_price > ctx.intent_price {
            market_price - ctx.intent_price
        } else {
            ctx.intent_price - market_price
        };

        let deviation_bps = diff
            .checked_mul(10000)
            .expect("Deviation math overflow")
            .checked_div(ctx.intent_price)
            .expect("Deviation math division error");

        let max_allowed = if ctx.max_slippage_bps > 0 && ctx.max_slippage_bps < config.threshold_bps {
            ctx.max_slippage_bps as i128
        } else {
            config.threshold_bps as i128
        };

        if deviation_bps > max_allowed {
            env.events().publish(
                (symbol_short!("DevAlert"),),
                (market_price, ctx.intent_price, deviation_bps),
            );
            return ExecutionResult {
                approved: false,
                market_price,
                deviation_bps: deviation_bps as u128,
                reason: Bytes::from_slice(&env, b"deviation_exceeded"),
            };
        }

        ExecutionResult {
            approved: true,
            market_price,
            deviation_bps: deviation_bps as u128,
            reason: Bytes::from_slice(&env, b"approved"),
        }
    }

    /// Convenience wrapper for swap-style operations.
    pub fn execute_protected_swap(
        env: Env,
        token_in: Address,
        token_out: Address,
        amount_in: i128,
        min_amount_out: i128,
        intent_price: i128,
    ) {
        let caller = Address::generate(&env); // In practice, resolve from tx auth
        let ctx = ExecutionContext {
            caller,
            operation: Bytes::from_slice(&env, b"swap"),
            intent_price,
            min_amount_out,
            max_slippage_bps: 0,
            deadline_ledger: env.ledger().sequence() + 1000,
        };

        let result = Self::execute_protected(env, token_in, token_out, amount_in, ctx);
        if !result.approved {
            panic!("Liquidity Protection: {}", std::str::from_utf8(result.reason.as_slice()).unwrap_or("unknown"));
        }

        env.events().publish(
            (symbol_short!("SwapOk"),),
            (token_in, token_out, amount_in, result.market_price),
        );
    }

    /// Returns the current configuration.
    pub fn get_config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).expect("Not initialized")
    }
}

/// Normalizes a value from current_decimals to target_decimals using 10^diff factor.
fn normalize_price(price: i128, current_decimals: u32, target_decimals: u32) -> i128 {
    if current_decimals == target_decimals {
        return price;
    }
    if current_decimals < target_decimals {
        let diff = target_decimals - current_decimals;
        let factor = 10i128.pow(diff);
        price * factor
    } else {
        let diff = current_decimals - target_decimals;
        let factor = 10i128.pow(diff);
        price / factor
    }
}

mod test;
mod test_property;