#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, Env, token, symbol_short};

// TTL for relayer info: ~30 days (6_048_000 ledgers at 5s/ledger)
// Active relayer records are extended on each activity; inactive ones eventually expire
const RELAYER_INFO_TTL_LEDGERS: u32 = 6_048_000;

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum RelayerStatus {
    Active,
    Slashed,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RelayerInfo {
    pub stake_amount: i128,
    pub status: RelayerStatus,
    pub unstake_requested_at: u64,
}

#[contracttype]
pub enum DataKey {
    Config,
    Relayer(Address),
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Config {
    pub admin: Address,
    pub staking_token: Address,
    pub treasury: Address,
    pub slashing_bps: u32,
    pub unbonding_period: u64,
}

#[contract]
pub struct RelayerSlashingContract;

#[contractimpl]
impl RelayerSlashingContract {
    /// Initializes the slashing contract with staking rules.
    pub fn initialize(
        env: Env,
        admin: Address,
        staking_token: Address,
        treasury: Address,
        slashing_bps: u32,
        unbonding_period: u64,
    ) {
        if env.storage().instance().has(&DataKey::Config) {
            panic!("Already initialized");
        }
        let config = Config {
            admin,
            staking_token,
            treasury,
            slashing_bps,
            unbonding_period,
        };
        env.storage().instance().set(&DataKey::Config, &config);
    }

    /// Registers a relayer and stakes their collateral.
    pub fn register_relayer(env: Env, relayer: Address, amount: i128) {
        relayer.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        
        let token_client = token::Client::new(&env, &config.staking_token);
        token_client.transfer(&relayer, &env.current_contract_address(), &amount);

        let mut info = env.storage().persistent()
            .get(&DataKey::Relayer(relayer.clone()))
            .unwrap_or(RelayerInfo {
                stake_amount: 0,
                status: RelayerStatus::Active,
                unstake_requested_at: 0,
            });

        // Ensure previously slashed relayers are reset to Active if they restake
        info.status = RelayerStatus::Active;
        info.stake_amount += amount;
        
        // Store relayer info with TTL to keep active relayers fresh
        env.storage().persistent().set_with_ttl(&DataKey::Relayer(relayer), &info, RELAYER_INFO_TTL_LEDGERS);
    }

    /// Slashes a malicious relayer. Only the admin can call this.
    /// Slashed amount is sent to the treasury and relayer status is updated.
    pub fn slash_relayer(env: Env, relayer: Address) {
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        config.admin.require_auth();

        let mut info: RelayerInfo = env.storage().persistent()
            .get(&DataKey::Relayer(relayer.clone()))
            .expect("Relayer not found");

        if info.status == RelayerStatus::Slashed {
            return;
        }

        let slash_amount = (info.stake_amount * config.slashing_bps as i128) / 10000;
        info.stake_amount = info.stake_amount.checked_sub(slash_amount).expect("Underflow");
        info.status = RelayerStatus::Slashed;

        let token_client = token::Client::new(&env, &config.staking_token);
        token_client.transfer(&env.current_contract_address(), &config.treasury, &slash_amount);

        // Extend TTL for slashed relayer record to maintain audit trail
        env.storage().persistent().set_with_ttl(&DataKey::Relayer(relayer.clone()), &info, RELAYER_INFO_TTL_LEDGERS);
        
        env.events().publish((symbol_short!("Slashed"), relayer), slash_amount);
    }

    /// Requests to unstake collateral. Starts the unbonding period.
    pub fn request_unstake(env: Env, relayer: Address) {
        relayer.require_auth();
        let mut info: RelayerInfo = env.storage().persistent()
            .get(&DataKey::Relayer(relayer.clone()))
            .expect("Relayer not found");

        info.unstake_requested_at = env.ledger().timestamp();
        
        // Extend TTL for relayer during unbonding period
        env.storage().persistent().set_with_ttl(&DataKey::Relayer(relayer), &info, RELAYER_INFO_TTL_LEDGERS);
    }

    /// Withdraws the staked collateral after the unbonding period has passed.
    pub fn withdraw_stake(env: Env, relayer: Address) {
        relayer.require_auth();
        let config: Config = env.storage().instance().get(&DataKey::Config).expect("Not initialized");
        let info: RelayerInfo = env.storage().persistent()
            .get(&DataKey::Relayer(relayer.clone()))
            .expect("Relayer not found");

        if info.unstake_requested_at == 0 {
            panic!("Unstake not requested");
        }

        if env.ledger().timestamp() < info.unstake_requested_at + config.unbonding_period {
            panic!("Unbonding period not met");
        }

        let token_client = token::Client::new(&env, &config.staking_token);
        token_client.transfer(&env.current_contract_address(), &relayer, &info.stake_amount);

        env.storage().persistent().remove(&DataKey::Relayer(relayer));
    }

    /// Returns the relayer's staking information.
    pub fn get_relayer_info(env: Env, relayer: Address) -> Option<RelayerInfo> {
        env.storage().persistent().get(&DataKey::Relayer(relayer))
    }
}

mod test;
