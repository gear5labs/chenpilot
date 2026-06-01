#![no_std]
use soroban_sdk::{
    contract, contractimpl, contracttype, contractclient, symbol_short,
    Address, Env,
};

// TTL for price snapshot: ~1 day (172_800 ledgers at 5s/ledger)
// Snapshots must be refreshed regularly to maintain price safety
const PRICE_SNAPSHOT_TTL_LEDGERS: u32 = 172_800;

// ---------------------------------------------------------------------------
// Oracle interface — same pattern as liquidity_vault
// ---------------------------------------------------------------------------
#[contractclient(name = "PriceOracleClient")]
pub trait PriceOracleTrait {
    /// Returns the price of `asset` scaled to 1e8.
    fn get_price(env: Env, asset: Address) -> i128;
}

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    /// Last ledger sequence at which a price snapshot was recorded.
    LastSnapshotLedger,
    /// Price snapshot: stored as (price, ledger_sequence).
    PriceSnapshot,
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub oracle: Address,
    /// The asset whose price is being guarded (e.g. wBTC in the Chen Pilot vault).
    pub guarded_asset: Address,
    /// Maximum allowed price deviation within a single ledger, in basis points.
    /// e.g. 200 = 2%. Any intra-ledger price move larger than this is blocked.
    pub max_intra_ledger_deviation_bps: i128,
    /// Minimum number of ledgers that must pass between price updates.
    /// Prevents an attacker from updating the snapshot and exploiting in the same ledger.
    pub min_ledger_gap: u32,
}

// ---------------------------------------------------------------------------
// Price snapshot stored on-chain
// ---------------------------------------------------------------------------
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PriceSnapshot {
    pub price: i128,
    pub ledger: u32,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------
#[contract]
pub struct FlashLoanGuardContract;

#[contractimpl]
impl FlashLoanGuardContract {
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

    /// Record a fresh price snapshot from the oracle.
    ///
    /// Enforces `min_ledger_gap`: the snapshot cannot be updated more than once
    /// per `min_ledger_gap` ledgers, preventing an attacker from resetting the
    /// baseline and exploiting in the same ledger close.
    /// 
    /// Sets TTL to ensure stale snapshots expire and force a refresh.
    pub fn record_snapshot(env: Env) {
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("not initialized");
        let current_ledger = env.ledger().sequence();

        if let Some(snap) = env
            .storage()
            .instance()
            .get::<DataKey, PriceSnapshot>(&DataKey::PriceSnapshot)
        {
            if current_ledger < snap.ledger + config.min_ledger_gap {
                panic!("snapshot too recent: min_ledger_gap not met");
            }
        }

        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let price = oracle.get_price(&config.guarded_asset);

        // Store snapshot with TTL to ensure it must be refreshed regularly
        env.storage().instance().set_with_ttl(
            &DataKey::PriceSnapshot,
            &PriceSnapshot { price, ledger: current_ledger },
            PRICE_SNAPSHOT_TTL_LEDGERS,
        );

        env.events().publish((symbol_short!("Snapshot"),), (price, current_ledger));
    }

    /// Core flash-loan guard check.
    ///
    /// Called before any price-sensitive vault operation (swap, liquidation, etc.).
    /// Compares the current oracle price against the stored snapshot.
    ///
    /// Blocks execution if:
    ///   1. No snapshot exists yet (cold-start protection).
    ///   2. The snapshot was taken in the SAME ledger as the current call
    ///      (same-block manipulation detection).
    ///   3. The price deviation from the snapshot exceeds `max_intra_ledger_deviation_bps`.
    ///
    /// Returns the current price on success.
    pub fn assert_price_safe(env: Env) -> i128 {
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("not initialized");

        let snap: PriceSnapshot = env
            .storage()
            .instance()
            .get(&DataKey::PriceSnapshot)
            .expect("no price snapshot: call record_snapshot first");

        let current_ledger = env.ledger().sequence();

        // --- Same-ledger manipulation check ---
        // If the snapshot was recorded in this exact ledger, an attacker could have
        // manipulated the price, taken the snapshot, and now be calling assert_price_safe
        // all within the same ledger close. Block it.
        if current_ledger == snap.ledger {
            panic!("flash-loan guard: price snapshot taken in same ledger");
        }

        // --- Fetch live price ---
        let oracle = PriceOracleClient::new(&env, &config.oracle);
        let current_price = oracle.get_price(&config.guarded_asset);

        // --- Deviation check ---
        let diff = if current_price > snap.price {
            current_price - snap.price
        } else {
            snap.price - current_price
        };

        // deviation_bps = diff * 10_000 / snap.price
        let deviation_bps = diff
            .checked_mul(10_000)
            .expect("overflow")
            .checked_div(snap.price)
            .expect("div zero");

        if deviation_bps > config.max_intra_ledger_deviation_bps {
            env.events().publish(
                (symbol_short!("FlashBlk"),),
                (snap.price, current_price, deviation_bps),
            );
            panic!("flash-loan guard: price deviation exceeds threshold");
        }

        env.events().publish(
            (symbol_short!("PriceSafe"),),
            (snap.price, current_price, deviation_bps),
        );

        current_price
    }

    /// Returns the current stored snapshot, if any.
    pub fn get_snapshot(env: Env) -> Option<PriceSnapshot> {
        env.storage().instance().get(&DataKey::PriceSnapshot)
    }

    /// Returns the current config.
    pub fn get_config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).expect("not initialized")
    }
}

mod test;
