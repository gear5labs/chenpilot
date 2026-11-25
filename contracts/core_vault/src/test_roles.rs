#![cfg(test)]

//! Role-matrix coverage for every privileged core_vault entry point.
//! The table in AUTHORIZATION_MATRICES.md is the source of truth.

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger, LedgerInfo},
    token::StellarAssetClient,
    Address, BytesN, Env,
};

fn setup(env: &Env) -> (Address, Address, CoreVaultContractClient) {
    let admin = Address::generate(env);
    let vault_token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let unified_auth = Address::generate(env);
    let contract_id = env.register_contract(None, CoreVaultContract);
    let client = CoreVaultContractClient::new(env, &contract_id);
    client.init(&admin, &vault_token, &unified_auth);
    (admin, vault_token, client)
}

fn dummy_hash(env: &Env) -> BytesN<32> {
    BytesN::from_array(env, &[7u8; 32])
}

fn must_reject<F: FnOnce()>(f: F) {
    assert!(
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).is_err(),
        "privileged entry point must reject unauthorized callers"
    );
}

#[test]
fn authorized_admin_can_call_privileged_entry_points() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, token, client) = setup(&env);
    let user = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&user, &1_000);
    client.deposit(&user, &200);

    client.set_backend_status(&true);
    client.pause();
    client.unpause();
    client.propose_upgrade(&dummy_hash(&env));
    client.cancel_upgrade();
    client.set_unified_auth(&Address::generate(&env));
    client.transfer_admin(&Address::generate(&env));
}

#[test]
fn unauthorized_caller_is_rejected_for_pause() {
    let env = Env::default();
    let (_admin, _token, client) = setup(&env);
    must_reject(|| {
        client.pause();
    });
}

#[test]
fn unauthorized_caller_is_rejected_for_unpause() {
    let env = Env::default();
    let (_admin, _token, client) = setup(&env);
    must_reject(|| {
        client.unpause();
    });
}

#[test]
fn unauthorized_caller_is_rejected_for_backend_status() {
    let env = Env::default();
    let (_admin, _token, client) = setup(&env);
    must_reject(|| {
        client.set_backend_status(&false);
    });
}

#[test]
fn unauthorized_caller_is_rejected_for_upgrade_and_admin_transfer() {
    let env = Env::default();
    let (_admin, _token, client) = setup(&env);
    must_reject(|| {
        client.propose_upgrade(&dummy_hash(&env));
    });
    must_reject(|| {
        client.cancel_upgrade();
    });
    must_reject(|| {
        client.set_unified_auth(&Address::generate(&env));
    });
    must_reject(|| {
        client.transfer_admin(&Address::generate(&env));
    });
}

#[test]
fn unauthorized_caller_is_rejected_for_recovery() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, token, client) = setup(&env);
    let user = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&user, &500);
    client.deposit(&user, &500);
    client.set_backend_status(&false);
    client.force_exit_request(&user);

    env.set_auths(&[]);
    must_reject(|| {
        client.recovery(&user);
    });
}

#[test]
fn pause_blocks_backend_status_and_upgrade_proposal() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, _token, client) = setup(&env);

    client.pause();
    must_reject(|| {
        client.set_backend_status(&false);
    });
    must_reject(|| {
        client.propose_upgrade(&dummy_hash(&env));
    });
}

#[test]
fn user_entry_points_still_require_the_user() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, token, client) = setup(&env);
    let user = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&user, &100);
    client.deposit(&user, &100);

    env.set_auths(&[]);
    must_reject(|| {
        client.withdrawal(&user, &10);
    });
}

#[test]
fn upgrade_mode_mutation_matrix() {
    let env = Env::default();
    env.mock_all_auths();
    let (_admin, token, client) = setup(&env);
    let user = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&user, &1_000);
    client.deposit(&user, &500);

    client.set_backend_status(&false);
    client.force_exit_request(&user);
    client.set_backend_status(&true);
    client.propose_upgrade(&dummy_hash(&env));
    assert!(client.is_upgrade_mode());

    assert!(client.try_deposit(&user, &10).is_err());
    assert!(client.try_set_backend_status(&false).is_err());
    assert!(client.try_transfer_admin(&Address::generate(&env)).is_err());
    assert!(client.try_set_unified_auth(&Address::generate(&env)).is_err());
    assert!(client.try_propose_upgrade(&dummy_hash(&env)).is_err());

    client.withdrawal(&user, &100);
    client.recovery(&user);
    client.pause();
    client.unpause();
    client.cancel_upgrade();
    assert!(!client.is_upgrade_mode());
    assert_eq!(client.get_deposit(&user), Some(400));

    let env = Env::default();
    env.mock_all_auths();
    let (_admin, token, client) = setup(&env);
    let user = Address::generate(&env);
    StellarAssetClient::new(&env, &token).mint(&user, &100);
    client.deposit(&user, &100);
    client.set_backend_status(&false);
    client.force_exit_request(&user);
    client.propose_upgrade(&dummy_hash(&env));
    env.ledger().set(LedgerInfo {
        timestamp: env.ledger().timestamp() + FORCE_EXIT_DELAY + 1,
        ..env.ledger().get()
    });
    client.force_exit_complete(&user);
    assert_eq!(client.get_deposit(&user), None);
}

#[test]
fn missing_unified_auth_fails_closed_except_for_admin_bootstrap() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let vault_token = env.register_stellar_asset_contract_v2(admin.clone()).address();
    let contract_id = env.register_contract(None, CoreVaultContract);
    let client = CoreVaultContractClient::new(&env, &contract_id);
    client.init_without_unified_auth(&admin, &vault_token);

    assert!(client.try_pause().is_err());
    assert!(client.try_unpause().is_err());
    assert!(client.try_set_backend_status(&false).is_err());
    assert!(client.try_recovery(&Address::generate(&env)).is_err());
    assert!(client.try_transfer_admin(&Address::generate(&env)).is_err());
    assert!(client.try_propose_upgrade(&dummy_hash(&env)).is_err());
    assert!(client.try_cancel_upgrade().is_err());
    assert!(client.try_apply_upgrade().is_err());
    assert!(client.try_set_unified_auth(&Address::generate(&env)).is_err());

    env.mock_all_auths();
    client.set_unified_auth(&Address::generate(&env));
    client.pause();
    client.unpause();
}
