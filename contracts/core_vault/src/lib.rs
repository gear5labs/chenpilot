#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, symbol_short, Env, Address, BytesN, token};

// ~1 hour at 5s/ledger
const TIMELOCK_LEDGERS: u32 = 720;

// 48 hours at 5s/ledger
const FORCE_EXIT_DELAY: u64 = 172_800;

// TTL for force-exit requests: ~50 hours (360000 ledgers at 5s/ledger)
const FORCE_EXIT_TTL_LEDGERS: u32 = 360_000;

// TTL for deposit records: ~7 days (persistent, but with TTL extension for active accounts)
const DEPOSIT_TTL_LEDGERS: u32 = 1_209_600;

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Admin,
    PendingUpgrade,
    BackendOnline,
    Deposit(Address),
    ForceExit(Address),
    VaultToken,
}

#[contracttype]
#[derive(Clone)]
pub struct PendingUpgrade {
    pub new_wasm_hash: BytesN<32>,
    pub unlock_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct ForceExitRequest {
    pub amount: i128,
    pub eligible_at: u64, // unix timestamp
}

#[contracttype]
#[derive(Clone)]
pub struct EvtInit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub admin: Address,
    pub vault_token: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtBackendStatus {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub online: bool,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtDeposit {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub user: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtForceExitReq {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub user: Address,
    pub amount: i128,
    pub eligible_at: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtForceExitDone {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub user: Address,
    pub amount: i128,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtUpgProp {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub new_wasm_hash: BytesN<32>,
    pub unlock_ledger: u32,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtUpgCncl {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtUpgDone {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub new_wasm_hash: BytesN<32>,
}

#[contracttype]
#[derive(Clone)]
pub struct EvtAdmXfer {
    pub version: u32,
    pub ledger: u32,
    pub actor: Address,
    pub old_admin: Address,
    pub new_admin: Address,
}

#[contract]
pub struct CoreVaultContract;

#[contractimpl]
impl CoreVaultContract {
    /// Initialize the contract with an admin and the vault token
    pub fn init(env: Env, admin: Address, vault_token: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!("already initialized");
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::VaultToken, &vault_token);
        env.storage().instance().set(&DataKey::BackendOnline, &true);

        env.events().publish(
            (symbol_short!("vault"), symbol_short!("init")),
            EvtInit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                admin,
                vault_token,
            },
        );
    }

    // ── Backend status ────────────────────────────────────────────────────────

    /// Admin marks the backend as offline, enabling force-exit requests
    pub fn set_backend_status(env: Env, online: bool) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::BackendOnline, &online);

        env.events().publish(
            (symbol_short!("vault"), symbol_short!("backend_status")),
            EvtBackendStatus {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                online,
            },
        );
    }

    pub fn is_backend_online(env: Env) -> bool {
        env.storage().instance().get(&DataKey::BackendOnline).unwrap_or(true)
    }

    // ── Normal deposit ────────────────────────────────────────────────────────

    /// Deposit tokens into the vault (only when backend is online)
    pub fn deposit(env: Env, user: Address, amount: i128) {
        user.require_auth();
        if !Self::is_backend_online(env.clone()) {
            panic!("backend offline: use force_exit_request");
        }

        let vault_token: Address = env.storage().instance().get(&DataKey::VaultToken).unwrap();
        let token = token::Client::new(&env, &vault_token);
        token.transfer(&user, &env.current_contract_address(), &amount);

        let current: i128 = env.storage().persistent()
            .get(&DataKey::Deposit(user.clone()))
            .unwrap_or(0);
        let new_balance = current + amount;
        
        // Store deposit with TTL extension to keep active accounts fresh
        env.storage().persistent().set_with_ttl(&DataKey::Deposit(user.clone()), &new_balance, DEPOSIT_TTL_LEDGERS);

        env.events().publish(
            (symbol_short!("vault"), symbol_short!("deposit")),
            EvtDeposit {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: user.clone(),
                user: user.clone(),
                amount,
            },
        );
    }

    // ── Force Exit ────────────────────────────────────────────────────────────

    /// Initiate a force-exit. Only allowed when backend is offline.
    /// Starts the 48-hour challenge period.
    pub fn force_exit_request(env: Env, user: Address) {
        user.require_auth();
        if Self::is_backend_online(env.clone()) {
            panic!("backend is online: use normal withdrawal");
        }

        let balance: i128 = env.storage().persistent()
            .get(&DataKey::Deposit(user.clone()))
            .unwrap_or(0);
        if balance <= 0 {
            panic!("no funds to withdraw");
        }

        // Prevent duplicate requests
        if env.storage().persistent().has(&DataKey::ForceExit(user.clone())) {
            panic!("force exit already pending");
        }

        let eligible_at = env.ledger().timestamp() + FORCE_EXIT_DELAY;
        let req = ForceExitRequest { amount: balance, eligible_at };
        
        // Store force-exit with TTL to auto-expire unclaimed requests after ~50 hours
        // This prevents stale requests from accumulating indefinitely
        env.storage().persistent().set_with_ttl(&DataKey::ForceExit(user.clone()), &req, FORCE_EXIT_TTL_LEDGERS);

        env.events().publish(
            (symbol_short!("vault"), symbol_short!("force_exit_req")),
            EvtForceExitReq {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: user.clone(),
                user: user.clone(),
                amount: balance,
                eligible_at,
            },
        );
    }

    /// Complete the force-exit after the 48-hour challenge period has passed.
    pub fn force_exit_complete(env: Env, user: Address) {
        user.require_auth();

        let req: ForceExitRequest = env.storage().persistent()
            .get(&DataKey::ForceExit(user.clone()))
            .expect("no pending force exit");

        if env.ledger().timestamp() < req.eligible_at {
            panic!("challenge period not elapsed");
        }

        // Clear state before transfer (re-entrancy guard)
        env.storage().persistent().remove(&DataKey::ForceExit(user.clone()));
        env.storage().persistent().remove(&DataKey::Deposit(user.clone()));

        let vault_token: Address = env.storage().instance().get(&DataKey::VaultToken).unwrap();
        let token = token::Client::new(&env, &vault_token);
        token.transfer(&env.current_contract_address(), &user, &req.amount);

        env.events().publish(
            (symbol_short!("vault"), symbol_short!("force_exit_done")),
            EvtForceExitDone {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: user.clone(),
                user: user.clone(),
                amount: req.amount,
            },
        );
    }

    /// Returns a pending force-exit request for a user, if any
    pub fn get_force_exit(env: Env, user: Address) -> Option<ForceExitRequest> {
        env.storage().persistent().get(&DataKey::ForceExit(user))
    }

    // ── Upgrade time-lock ─────────────────────────────────────────────────────

    pub fn propose_upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();

        let unlock_ledger = env.ledger().sequence() + TIMELOCK_LEDGERS;
        let pending = PendingUpgrade { new_wasm_hash: new_wasm_hash.clone(), unlock_ledger };
        env.storage().instance().set(&DataKey::PendingUpgrade, &pending);

        env.events().publish(
            (symbol_short!("vault"), symbol_short!("upg_prop")),
            EvtUpgProp {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                new_wasm_hash,
                unlock_ledger,
            },
        );
    }

    pub fn cancel_upgrade(env: Env) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().remove(&DataKey::PendingUpgrade);

        env.events().publish(
            (symbol_short!("vault"), symbol_short!("upg_cncl")),
            EvtUpgCncl {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin,
            },
        );
    }

    pub fn apply_upgrade(env: Env) {
        let pending: PendingUpgrade = env
            .storage()
            .instance()
            .get(&DataKey::PendingUpgrade)
            .expect("no pending upgrade");

        if env.ledger().sequence() < pending.unlock_ledger {
            panic!("time-lock not expired");
        }

        env.storage().instance().remove(&DataKey::PendingUpgrade);
        env.deployer().update_current_contract_wasm(pending.new_wasm_hash.clone());

        env.events().publish(
            (symbol_short!("vault"), symbol_short!("upg_done")),
            EvtUpgDone {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: env.current_contract_address(),
                new_wasm_hash: pending.new_wasm_hash.clone(),
            },
        );
    }

    pub fn transfer_admin(env: Env, new_admin: Address) {
        let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);

        env.events().publish(
            (symbol_short!("vault"), symbol_short!("adm_xfer")),
            EvtAdmXfer {
                version: 1,
                ledger: env.ledger().sequence(),
                actor: admin.clone(),
                old_admin: admin,
                new_admin,
            },
        );
    }

    pub fn upgrade_unlock_ledger(env: Env) -> u32 {
        env.storage()
            .instance()
            .get::<DataKey, PendingUpgrade>(&DataKey::PendingUpgrade)
            .map(|p| p.unlock_ledger)
            .unwrap_or(0)
    }
}

mod test;
