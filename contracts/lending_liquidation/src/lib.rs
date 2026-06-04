#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contractclient, symbol_short,
    Address, Env, token,
};

// TTL for active positions: ~30 days (6_048_000 ledgers at 5s/ledger)
// Positions are extended on each activity to remain fresh; inactive positions eventually expire
const POSITION_TTL_LEDGERS: u32 = 6_048_000;

// ---------------------------------------------------------------------------
// Oracle interface
// ---------------------------------------------------------------------------
#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracleTrait {
    /// Returns the USD price of `asset` scaled to 1e8 (e.g. 1 USD = 100_000_000).
    fn get_price(env: Env, asset: Address) -> i128;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Position(Address), // borrower → Position
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    /// Price oracle contract
    pub oracle: Address,
    /// Collateral token (e.g. wBTC)
    pub collateral_token: Address,
    /// Debt token (e.g. USDC)
    pub debt_token: Address,
    /// Minimum health factor (scaled 1e4) below which a position is liquidatable.
    /// e.g. 10_000 = 1.0 — position is healthy at exactly 1.0, underwater below.
    pub min_health_factor: i128,
    /// Liquidation bonus in basis points paid to the liquidator (e.g. 500 = 5%).
    pub liquidation_bonus_bps: i128,
    /// Loan-to-value ratio in basis points (e.g. 7500 = 75%).
    pub ltv_bps: i128,
}

// ---------------------------------------------------------------------------
// Borrower position
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Position {
    pub collateral_amount: i128, // units of collateral_token
    pub debt_amount: i128,       // units of debt_token
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
#[contract]
pub struct LendingLiquidationContract;

#[contractimpl]
impl LendingLiquidationContract {
    pub fn initialize(env: Env, config: Config) {
        if env.storage().instance().has(&DataKey::Config) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Config, &config);
    }

    pub fn update_config(env: Env, config: Config) {
        let current: Config = env.storage().instance().get(&DataKey::Config).expect("not initialized");
        current.admin.require_auth();
        env.storage().instance().set(&DataKey::Config, &config);
    }

    /// Open or top-up a collateralized position.
    /// Transfers `collateral_amount` from `borrower` into the contract and
    /// mints `borrow_amount` of debt token to the borrower.
    pub fn deposit_and_borrow(
        env: Env,
        borrower: Address,
        collateral_amount: i128,
        borrow_amount: i128,
    ) {
        borrower.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("not initialized");

        if collateral_amount <= 0 || borrow_amount <= 0 {
            panic!("amounts must be positive");
        }

        // Pull collateral in
        let col_token = token::Client::new(&env, &config.collateral_token);
        col_token.transfer(&borrower, &env.current_contract_address(), &collateral_amount);

        // Push debt out
        let debt_token = token::Client::new(&env, &config.debt_token);
        debt_token.transfer(&env.current_contract_address(), &borrower, &borrow_amount);

        let mut pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(borrower.clone()))
            .unwrap_or(Position { collateral_amount: 0, debt_amount: 0 });

        pos.collateral_amount += collateral_amount;
        pos.debt_amount += borrow_amount;

        // Enforce LTV at open time
        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let col_price = oracle.get_price(&config.collateral_token);
        let debt_price = oracle.get_price(&config.debt_token);
        let hf = Self::compute_health_factor(&pos, col_price, debt_price, config.ltv_bps);
        if hf < config.min_health_factor {
            panic!("borrow exceeds LTV");
        }

        // Store position with TTL to keep active positions fresh
        env.storage().persistent().set_with_ttl(&DataKey::Position(borrower), &pos, POSITION_TTL_LEDGERS);
    }

    /// Liquidate an under-water position.
    ///
    /// Health factor = (collateral_value_usd * ltv_bps / 10_000) / debt_value_usd * 10_000
    ///
    /// If health_factor < min_health_factor the position is liquidatable.
    /// The liquidator repays `repay_amount` of debt and receives collateral at a
    /// discount equal to `liquidation_bonus_bps`.
    pub fn liquidate(env: Env, liquidator: Address, borrower: Address, repay_amount: i128) {
        liquidator.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("not initialized");

        if repay_amount <= 0 {
            panic!("repay amount must be positive");
        }

        let mut pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(borrower.clone()))
            .expect("position not found");

        if pos.debt_amount == 0 {
            panic!("no debt to liquidate");
        }

        // Fetch current prices from oracle
        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let col_price = oracle.get_price(&config.collateral_token);
        let debt_price = oracle.get_price(&config.debt_token);

        // Check health factor
        let hf = Self::compute_health_factor(&pos, col_price, debt_price, config.ltv_bps);
        if hf >= config.min_health_factor {
            panic!("position is healthy, cannot liquidate");
        }

        // Cap repay at full debt
        let actual_repay = if repay_amount > pos.debt_amount {
            pos.debt_amount
        } else {
            repay_amount
        };

        // Collateral to seize = repay_value_usd * (1 + bonus) / col_price
        // repay_value_usd (scaled 1e8) = actual_repay * debt_price / 1e8
        // collateral_seized = repay_value_usd * (10_000 + bonus_bps) / 10_000 / col_price * 1e8
        let repay_value = actual_repay
            .checked_mul(debt_price).expect("overflow")
            .checked_div(100_000_000).expect("div zero");

        let collateral_seized = repay_value
            .checked_mul(10_000 + config.liquidation_bonus_bps).expect("overflow")
            .checked_div(10_000).expect("div zero")
            .checked_mul(100_000_000).expect("overflow")
            .checked_div(col_price).expect("div zero");

        if collateral_seized > pos.collateral_amount {
            panic!("insufficient collateral to seize");
        }

        // Liquidator repays debt
        let debt_token = token::Client::new(&env, &config.debt_token);
        debt_token.transfer(&liquidator, &env.current_contract_address(), &actual_repay);

        // Liquidator receives discounted collateral
        let col_token = token::Client::new(&env, &config.collateral_token);
        col_token.transfer(&env.current_contract_address(), &liquidator, &collateral_seized);

        pos.debt_amount -= actual_repay;
        pos.collateral_amount -= collateral_seized;
        
        // Extend TTL for updated position to keep it fresh
        env.storage().persistent().set_with_ttl(&DataKey::Position(borrower.clone()), &pos, POSITION_TTL_LEDGERS);

        env.events().publish(
            (symbol_short!("Liquidate"),),
            (borrower, actual_repay, collateral_seized, hf),
        );
    }

    /// Returns the health factor of a borrower (scaled 1e4).
    /// Returns i128::MAX if there is no debt.
    pub fn health_factor(env: Env, borrower: Address) -> i128 {
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("not initialized");
        let pos: Position = env
            .storage()
            .persistent()
            .get(&DataKey::Position(borrower))
            .unwrap_or(Position { collateral_amount: 0, debt_amount: 0 });

        if pos.debt_amount == 0 {
            return i128::MAX;
        }

        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let col_price = oracle.get_price(&config.collateral_token);
        let debt_price = oracle.get_price(&config.debt_token);

        Self::compute_health_factor(&pos, col_price, debt_price, config.ltv_bps)
    }

    /// Returns the position for a borrower.
    pub fn get_position(env: Env, borrower: Address) -> Option<Position> {
        env.storage().persistent().get(&DataKey::Position(borrower))
    }

    // -----------------------------------------------------------------------
    // Internal
    // -----------------------------------------------------------------------

    /// health_factor = (collateral_usd * ltv_bps / 10_000) / debt_usd  * 10_000
    /// All prices are scaled 1e8. Result is scaled 1e4 (10_000 = 1.0).
    fn compute_health_factor(
        pos: &Position,
        col_price: i128,
        debt_price: i128,
        ltv_bps: i128,
    ) -> i128 {
        if pos.debt_amount == 0 {
            return i128::MAX;
        }
        // collateral_usd = collateral_amount * col_price / 1e8
        // debt_usd       = debt_amount       * debt_price / 1e8
        // hf = (collateral_usd * ltv_bps / 10_000) / debt_usd * 10_000
        //    = collateral_amount * col_price * ltv_bps / (debt_amount * debt_price)
        pos.collateral_amount
            .checked_mul(col_price).expect("overflow")
            .checked_mul(ltv_bps).expect("overflow")
            .checked_div(
                pos.debt_amount
                    .checked_mul(debt_price).expect("overflow")
            ).expect("div zero")
    }
}

mod test;
