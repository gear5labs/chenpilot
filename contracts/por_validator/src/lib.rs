#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, contractclient, Address, Env, symbol_short};

// TTL for validator status: ~1 day (172_800 ledgers at 5s/ledger)
// Validator status is instance storage (rarely-changed config), but with TTL
// to ensure stale status records are refreshed periodically for accuracy
const VALIDATOR_STATUS_TTL_LEDGERS: u32 = 172_800;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ReserveData {
    pub balance: i128,
    pub circulating_supply: i128,
    pub timestamp: u64,
}

#[contractclient(name = "OracleClient")]
pub trait OracleTrait {
    fn get_reserve_data(env: Env) -> ReserveData;
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum DataKey {
    Config,
    IsValid,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub wbtc_token: Address,
    pub oracle: Address,
    pub tolerance_bps: u32, // Basis points (e.g., 50 bps = 0.5%)
}

#[contract]
pub struct PoRValidatorContract;

#[contractimpl]
impl PoRValidatorContract {
    /// Initializes the Proof-of-Reserve validator.
    pub fn initialize(
        env: Env,
        admin: Address,
        wbtc_token: Address,
        oracle: Address,
        tolerance_bps: u32,
    ) {
        if env.storage().instance().has(&DataKey::Config) {
            panic!("Already initialized");
        }
        let config = Config {
            admin,
            wbtc_token,
            oracle,
            tolerance_bps,
        };
        env.storage().instance().set(&DataKey::Config, &config);
        
        // Store initial IsValid status with TTL to force periodic re-validation
        env.storage().instance().set_with_ttl(&DataKey::IsValid, &true, VALIDATOR_STATUS_TTL_LEDGERS);
    }

    /// Updates the configuration. Only the admin can call this.
    pub fn update_config(env: Env, config: Config) {
        let current_config: Config = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        current_config.admin.require_auth();
        env.storage().instance().set(&DataKey::Config, &config);
    }

    /// Performs the reserve validation by comparing token supply against oracle balance.
    /// This function updates the internal `is_valid` state and emits events.
    pub fn verify_reserves(env: Env) {
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        
        // 1. Fetch total supply and reserve balance from the trusted oracle.
        // Soroban SEP-41 token interface does not expose total_supply directly;
        // the PoR oracle is expected to report both circulating supply and BTC reserves.
        let oracle_client = OracleClient::new(&env, &config.oracle);
        let reserve_data = oracle_client.get_reserve_data();
        let supply = reserve_data.circulating_supply;
        
        // 3. Calculate the maximum allowed supply based on tolerance_bps
        // Allowed = Reserves * (10000 + tolerance) / 10000
        let allowed_supply = reserve_data.balance
            .checked_mul((10000 + config.tolerance_bps) as i128)
            .expect("Multiplication overflow")
            .checked_div(10000)
            .expect("Division error");

        // 4. Compare supply vs reserves
        let is_valid = supply <= allowed_supply;
        
        // Store validation result with TTL to force re-validation periodically
        env.storage().instance().set_with_ttl(&DataKey::IsValid, &is_valid, VALIDATOR_STATUS_TTL_LEDGERS);

        if !is_valid {
            // Discrepancy detected: Supply exceeds reserves + tolerance
            env.events().publish(
                (symbol_short!("PoRAlert"),),
                (supply, reserve_data.balance, reserve_data.timestamp)
            );
        } else {
            // Reserves are healthy
            env.events().publish(
                (symbol_short!("PoROk"),),
                (supply, reserve_data.balance, reserve_data.timestamp)
            );
        }
    }

    /// Returns the current validity status of the reserves.
    pub fn is_valid(env: Env) -> bool {
        env.storage().instance().get(&DataKey::IsValid).unwrap_or(false)
    }
    
    /// Returns the current contract configuration.
    pub fn get_config(env: Env) -> Config {
        env.storage().instance().get(&DataKey::Config).expect("Not initialized")
    }
}

mod test;
