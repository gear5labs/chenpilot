#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Env, Address, BytesN, Vec};

// TTL for vote data: ~7 days (1_209_600 ledgers at 5s/ledger)
// Votes decay over time to encourage fresh strategy voting and prevent stale governance
const VOTE_TTL_LEDGERS: u32 = 1_209_600;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    AiAgent(Address),
    VerifiedPool(BytesN<32>),
    CurrentStrategy,
    Votes(BytesN<32>),
    VotedPools,
}

#[contract]
pub struct StrategyRegistryContract;

#[contractimpl]
impl StrategyRegistryContract {
    /// Initialize the contract with an admin
    pub fn init(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    /// Set an AI agent's authorization status (Admin only)
    pub fn set_ai_agent(env: Env, ai_agent: Address, authorized: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::AiAgent(ai_agent), &authorized);
    }

    /// Add a verified pool (Admin only)
    pub fn add_verified_pool(env: Env, pool_id: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::VerifiedPool(pool_id), &true);
    }

    /// Remove a verified pool (Admin only)
    pub fn remove_verified_pool(env: Env, pool_id: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().remove(&DataKey::VerifiedPool(pool_id));
    }

    /// Check if a pool is verified
    pub fn is_pool_verified(env: Env, pool_id: BytesN<32>) -> bool {
        env.storage().instance().get(&DataKey::VerifiedPool(pool_id)).unwrap_or(false)
    }

    /// Vote for a strategy (AI agent only, must be verified pool)
    pub fn vote_strategy(env: Env, ai_agent: Address, pool_id: BytesN<32>) {
        ai_agent.require_auth();

        // Check if the AI agent is authorized
        let is_authorized: bool = env.storage().instance().get(&DataKey::AiAgent(ai_agent.clone())).unwrap_or(false);
        if !is_authorized {
            panic!("AI agent not authorized");
        }

        // Check if the pool is verified
        if !Self::is_pool_verified(env.clone(), pool_id.clone()) {
            panic!("Pool is not verified");
        }

        // Cast vote with TTL to decay old votes naturally
        let mut votes: u32 = env.storage().instance().get(&DataKey::Votes(pool_id.clone())).unwrap_or(0);
        votes += 1;
        env.storage().instance().set_with_ttl(&DataKey::Votes(pool_id.clone()), &votes, VOTE_TTL_LEDGERS);

        // Keep track of voted pools to determine the winner
        let mut voted_pools: Vec<BytesN<32>> = env.storage().instance().get(&DataKey::VotedPools).unwrap_or(Vec::new(&env));
        if !voted_pools.contains(&pool_id) {
            voted_pools.push_back(pool_id.clone());
            env.storage().instance().set(&DataKey::VotedPools, &voted_pools);
        }

        // Update current strategy based on votes
        let mut max_votes = 0;
        let mut best_pool = pool_id.clone();
        
        for pool in voted_pools.iter() {
            let p_votes: u32 = env.storage().instance().get(&DataKey::Votes(pool.clone())).unwrap_or(0);
            if p_votes > max_votes {
                max_votes = p_votes;
                best_pool = pool;
            }
        }
        
        env.storage().instance().set(&DataKey::CurrentStrategy, &best_pool);
    }

    /// Get the current chosen strategy
    pub fn get_current_strategy(env: Env) -> Option<BytesN<32>> {
        env.storage().instance().get(&DataKey::CurrentStrategy)
    }
}

mod test;
