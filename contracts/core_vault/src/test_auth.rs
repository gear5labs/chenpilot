#![cfg(test)]

use super::*;
use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};
use unified_auth::{UnifiedAuthContract, UnifiedAuthContractClient, UnifiedRole as AuthRole};

fn dummy_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

struct Fixture<'a> {
    admin: Address,
    auth: UnifiedAuthContractClient<'a>,
    vault: CoreVaultContractClient<'a>,
    token: Address,
}

fn setup(env: &Env) -> Fixture<'_> {
    let super_admin = Address::generate(env);
    let auth_id = env.register_contract(None, UnifiedAuthContract);
    let auth = UnifiedAuthContractClient::new(env, &auth_id);
    auth.init(&super_admin);

    let admin = Address::generate(env);
    let token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let vault_id = env.register_contract(None, CoreVaultContract);
    let vault = CoreVaultContractClient::new(env, &vault_id);
    vault.init(&admin, &token, &auth_id);

    Fixture {
        admin,
        auth,
        vault,
        token,
    }
}

#[test]
fn legacy_admin_works_until_migration_completes() {
    let env = Env::default();
    env.mock_all_auths();
    let fix = setup(&env);

    fix.vault.set_backend_status(&false);
    assert!(!fix.vault.is_backend_online());
    assert!(!fix.vault.is_auth_migration_complete());
}

#[test]
fn legacy_only_admin_is_rejected_after_migration() {
    let env = Env::default();
    env.mock_all_auths();
    let fix = setup(&env);
    fix.vault.complete_auth_migration();

    assert!(fix.vault.try_set_backend_status(&false).is_err());
    assert!(fix.vault.try_propose_upgrade(&dummy_hash(&env)).is_err());
    assert!(fix.vault.try_pause().is_err());
}

#[test]
fn each_role_can_perform_only_its_operations() {
    let env = Env::default();
    env.mock_all_auths();
    let fix = setup(&env);

    fix.auth.grant_role(&fix.admin, &AuthRole::VaultAdmin);
    fix.vault.complete_auth_migration();

    fix.vault.set_backend_status(&false);
    assert!(!fix.vault.is_backend_online());
    assert!(fix.vault.try_propose_upgrade(&dummy_hash(&env)).is_err());
    assert!(fix.vault.try_pause().is_err());

    fix.vault.set_backend_status(&true);
}

#[test]
fn emergency_admin_can_pause_and_recover_but_not_upgrade() {
    let env = Env::default();
    env.mock_all_auths();
    let fix = setup(&env);
    fix.auth
        .grant_role(&fix.admin, &AuthRole::EmergencyAdmin);
    fix.vault.complete_auth_migration();

    fix.vault.pause();
    assert!(fix.vault.is_paused());
    fix.vault.unpause();

    fix.vault.set_backend_status(&false);
    assert!(fix.vault.try_propose_upgrade(&dummy_hash(&env)).is_err());

    let user = Address::generate(&env);
    soroban_sdk::token::StellarAssetClient::new(&env, &fix.token).mint(&user, &50);
    fix.vault.set_backend_status(&true);
    fix.vault.deposit(&user, &50);
    fix.vault.set_backend_status(&false);
    fix.vault.force_exit_request(&user);
    fix.vault.recovery(&user);
    assert!(fix.vault.get_force_exit(&user).is_none());
}

#[test]
fn upgrade_admin_flow_and_revocation() {
    let env = Env::default();
    env.mock_all_auths();
    let fix = setup(&env);
    fix.auth
        .grant_role(&fix.admin, &AuthRole::UpgradeAdmin);
    fix.vault.complete_auth_migration();

    let hash = dummy_hash(&env);
    fix.vault.propose_upgrade(&hash);
    assert!(fix.vault.upgrade_unlock_ledger() > 0);
    assert!(fix.vault.try_set_backend_status(&false).is_err());

    fix.auth
        .revoke_role(&fix.admin, &AuthRole::UpgradeAdmin);
    assert!(fix.vault.try_cancel_upgrade().is_err());

    fix.auth
        .grant_role(&fix.admin, &AuthRole::UpgradeAdmin);
    fix.vault.cancel_upgrade();
    assert_eq!(fix.vault.upgrade_unlock_ledger(), 0);
}

#[test]
fn unauthorized_caller_cannot_complete_migration() {
    let env = Env::default();
    let fix = setup(&env);
    assert!(fix.vault.try_complete_auth_migration().is_err());
    assert!(fix.vault.try_propose_upgrade(&dummy_hash(&env)).is_err());
}

#[test]
fn repeated_backend_status_and_upgrade_are_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let fix = setup(&env);

    assert!(fix.vault.try_set_backend_status(&true).is_err());
    fix.vault.set_backend_status(&false);
    assert!(fix.vault.try_set_backend_status(&false).is_err());

    let hash = dummy_hash(&env);
    fix.vault.propose_upgrade(&hash);
    assert!(fix.vault.try_propose_upgrade(&hash).is_err());
    fix.vault.cancel_upgrade();
    assert!(fix.vault.try_cancel_upgrade().is_err());
}

#[test]
fn repeated_recovery_is_rejected() {
    let env = Env::default();
    env.mock_all_auths();
    let fix = setup(&env);
    let user = Address::generate(&env);
    soroban_sdk::token::StellarAssetClient::new(&env, &fix.token).mint(&user, &20);
    fix.vault.deposit(&user, &20);
    fix.vault.set_backend_status(&false);
    fix.vault.force_exit_request(&user);
    fix.vault.recovery(&user);
    assert!(fix.vault.try_recovery(&user).is_err());
    assert!(fix.vault.get_deposit(&user).is_some());
}
