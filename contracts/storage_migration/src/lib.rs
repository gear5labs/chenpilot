//! # storage_migration
//!
//! Versioned, idempotent storage migration framework for Soroban contracts.
//!
//! ## Problem
//!
//! A WASM upgrade can compile successfully while silently reinterpreting
//! existing storage keys or value shapes, permanently corrupting on-chain
//! state.  This crate provides the primitives that make intentional
//! migrations:
//!
//! 1. **Explicit** — every migration is a named, typed function.
//! 2. **Versioned** — migrations are numbered; the framework records which
//!    version was last applied so they are never run twice.
//! 3. **Idempotent** — re-running the same migration on an already-migrated
//!    ledger is a safe no-op.
//! 4. **Inspectable** — the schema version and migration log are readable
//!    on-chain, enabling off-chain tooling to verify state before approving
//!    an upgrade proposal.
//!
//! ## Usage
//!
//! ```rust,ignore
//! // In your contract's upgrade entry point, after apply_wasm_hash:
//! use storage_migration::{MigrationRunner, require_migration_idempotent};
//!
//! fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
//!     // ... auth checks, timelock checks ...
//!     env.deployer().update_current_contract_wasm(new_wasm_hash);
//!
//!     let mut runner = MigrationRunner::load(&env);
//!     runner.run_if_pending(&env, 1, migrate_v0_to_v1);
//!     runner.run_if_pending(&env, 2, migrate_v1_to_v2);
//!     runner.save(&env);
//! }
//!
//! fn migrate_v0_to_v1(env: &Env) {
//!     // Read old layout, write new layout.
//!     // Any panic here rolls back the entire upgrade transaction — safe by
//!     // default.
//! }
//! ```

#![no_std]

use soroban_sdk::{contracttype, symbol_short, Env, Vec, String};

// ─── Storage key ──────────────────────────────────────────────────────────────

/// Internal storage key used by this framework.
/// Contracts MUST NOT define a DataKey variant named `MigrationState` to
/// avoid collisions.  (The framework uses its own independent key so it
/// doesn't interfere with contract-specific DataKey numbering.)
#[contracttype]
#[derive(Clone)]
enum MigrationDataKey {
    /// Stores the `MigrationState` struct.
    MigrationState,
}

// ─── Persisted state ─────────────────────────────────────────────────────────

/// The on-chain migration record.  Stored in instance storage so it persists
/// alongside the contract's own configuration.
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct MigrationState {
    /// Schema version currently applied to this contract instance.
    /// Starts at 0 (pre-first-migration).  Each applied migration increments
    /// this by 1.
    pub schema_version: u32,

    /// Ledger at which the most recent migration was applied.
    pub last_migrated_at: u32,

    /// Ordered list of migration IDs that have been successfully applied.
    /// Used for audit and off-chain reconciliation.
    pub applied_migrations: Vec<String>,
}

impl MigrationState {
    /// Initial state before any migration has run.
    pub fn new(env: &Env) -> Self {
        MigrationState {
            schema_version: 0,
            last_migrated_at: 0,
            applied_migrations: Vec::new(env),
        }
    }
}

// ─── MigrationRunner ─────────────────────────────────────────────────────────

/// Orchestrates sequential, idempotent migrations.
///
/// Load from chain with [`MigrationRunner::load`], call
/// [`MigrationRunner::run_if_pending`] for each migration in order, then
/// persist with [`MigrationRunner::save`].
pub struct MigrationRunner {
    state: MigrationState,
}

impl MigrationRunner {
    /// Load the current migration state from instance storage.
    /// If no state exists, returns a default (schema_version = 0).
    pub fn load(env: &Env) -> Self {
        let state = env
            .storage()
            .instance()
            .get::<MigrationDataKey, MigrationState>(&MigrationDataKey::MigrationState)
            .unwrap_or_else(|| MigrationState::new(env));
        MigrationRunner { state }
    }

    /// Return the current schema version without mutating state.
    pub fn schema_version(&self) -> u32 {
        self.state.schema_version
    }

    /// Run `migration_fn` if and only if `target_version - 1` is the current
    /// schema version.  This is the core idempotency guarantee: each migration
    /// runs exactly once, regardless of how many times `upgrade` is called with
    /// the same WASM hash.
    ///
    /// # Panics
    ///
    /// Panics via `env.panic_with_error` if `target_version` is 0 (the
    /// pre-migration baseline cannot be "applied"), or if `target_version`
    /// would skip a version (migrations must be applied in strict sequence).
    pub fn run_if_pending(
        &mut self,
        env: &Env,
        target_version: u32,
        migration_id: &str,
        migration_fn: impl FnOnce(&Env),
    ) {
        if target_version == 0 {
            panic!("target_version 0 is invalid — version 0 is the pre-migration baseline");
        }

        let current = self.state.schema_version;

        if current + 1 < target_version {
            // A required intermediate migration was skipped — hard fail to
            // prevent partial upgrades from silently corrupting state.
            panic!(
                "migration sequence violation: current schema version is {} but target is {}; \
                 intermediate migrations must run first",
                current, target_version
            );
        }

        if current >= target_version {
            // Already applied — safe no-op (idempotency guarantee).
            return;
        }

        // current + 1 == target_version: run the migration.
        migration_fn(env);

        self.state.schema_version = target_version;
        self.state.last_migrated_at = env.ledger().sequence();
        self.state
            .applied_migrations
            .push_back(String::from_str(env, migration_id));
    }

    /// Persist the updated migration state to instance storage.
    /// Call this once after all `run_if_pending` calls in an upgrade.
    pub fn save(&self, env: &Env) {
        env.storage()
            .instance()
            .set(&MigrationDataKey::MigrationState, &self.state);
    }
}

// ─── Standalone helpers ───────────────────────────────────────────────────────

/// Read the current schema version from instance storage without creating a
/// full runner.  Useful for off-chain tooling that reads contract state
/// without triggering a migration.
pub fn current_schema_version(env: &Env) -> u32 {
    env.storage()
        .instance()
        .get::<MigrationDataKey, MigrationState>(&MigrationDataKey::MigrationState)
        .map(|s| s.schema_version)
        .unwrap_or(0)
}

/// Read the full migration state.  Returns `None` if no migration has ever
/// run on this contract instance.
pub fn migration_state(env: &Env) -> Option<MigrationState> {
    env.storage()
        .instance()
        .get::<MigrationDataKey, MigrationState>(&MigrationDataKey::MigrationState)
}

/// Assert that the contract is already at `expected_version`.  Panics if not.
/// Useful as a pre-condition check at the top of a migration function to catch
/// double-application of a migration that was mistakenly wired incorrectly.
pub fn require_schema_version(env: &Env, expected_version: u32) {
    let actual = current_schema_version(env);
    if actual != expected_version {
        panic!(
            "schema version mismatch: expected {}, actual {}",
            expected_version, actual
        );
    }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;
    use soroban_sdk::testutils::Ledger;
    use soroban_sdk::{Env, IntoVal};

    #[test]
    fn test_initial_state_is_version_zero() {
        let env = Env::default();
        env.mock_all_auths();
        let version = current_schema_version(&env);
        assert_eq!(version, 0);
    }

    #[test]
    fn test_single_migration_increments_version() {
        let env = Env::default();
        env.mock_all_auths();

        let mut runner = MigrationRunner::load(&env);
        assert_eq!(runner.schema_version(), 0);

        runner.run_if_pending(&env, 1, "test_migration_v1", |_env| {
            // migration body — no-op in test
        });

        runner.save(&env);

        assert_eq!(current_schema_version(&env), 1);
    }

    #[test]
    fn test_migration_is_idempotent() {
        let env = Env::default();
        env.mock_all_auths();

        let mut runner = MigrationRunner::load(&env);
        let mut call_count = 0u32;

        runner.run_if_pending(&env, 1, "idempotent_test", |_env| {
            call_count += 1;
        });
        runner.save(&env);

        // Run again — should NOT call the migration fn a second time
        let mut runner2 = MigrationRunner::load(&env);
        runner2.run_if_pending(&env, 1, "idempotent_test", |_env| {
            call_count += 1;
        });
        runner2.save(&env);

        assert_eq!(call_count, 1, "migration ran more than once");
        assert_eq!(current_schema_version(&env), 1);
    }

    #[test]
    fn test_sequential_migrations() {
        let env = Env::default();
        env.mock_all_auths();

        let mut runner = MigrationRunner::load(&env);
        runner.run_if_pending(&env, 1, "v1", |_env| {});
        runner.run_if_pending(&env, 2, "v2", |_env| {});
        runner.run_if_pending(&env, 3, "v3", |_env| {});
        runner.save(&env);

        assert_eq!(current_schema_version(&env), 3);

        let state = migration_state(&env).expect("state must exist");
        assert_eq!(state.applied_migrations.len(), 3);
    }

    #[test]
    fn test_partial_upgrade_resumes_correctly() {
        let env = Env::default();
        env.mock_all_auths();

        // First upgrade: only v1
        {
            let mut runner = MigrationRunner::load(&env);
            runner.run_if_pending(&env, 1, "v1", |_env| {});
            runner.save(&env);
        }

        // Second upgrade: v1 (already done) + v2 (new)
        {
            let mut runner = MigrationRunner::load(&env);
            runner.run_if_pending(&env, 1, "v1", |_env| {});
            runner.run_if_pending(&env, 2, "v2", |_env| {});
            runner.save(&env);
        }

        assert_eq!(current_schema_version(&env), 2);
        let state = migration_state(&env).unwrap();
        // v1 should appear exactly once
        assert_eq!(state.applied_migrations.len(), 2);
    }

    #[test]
    #[should_panic]
    fn test_skipping_version_panics() {
        let env = Env::default();
        env.mock_all_auths();

        let mut runner = MigrationRunner::load(&env);
        // Skipping straight to version 2 without version 1
        runner.run_if_pending(&env, 2, "v2_without_v1", |_env| {});
    }

    #[test]
    fn test_require_schema_version_passes() {
        let env = Env::default();
        env.mock_all_auths();

        let mut runner = MigrationRunner::load(&env);
        runner.run_if_pending(&env, 1, "v1", |_env| {});
        runner.save(&env);

        // Should not panic
        require_schema_version(&env, 1);
    }

    #[test]
    #[should_panic]
    fn test_require_schema_version_panics_on_mismatch() {
        let env = Env::default();
        env.mock_all_auths();

        require_schema_version(&env, 5);
    }
}
