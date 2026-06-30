#![cfg(test)]

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env};

fn create_token<'a>(env: &Env, admin: &Address) -> (Address, token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_id = env.register_stellar_asset_contract(admin.clone());
    let token = token::Client::new(env, &contract_id);
    let stellar_asset_client = token::StellarAssetClient::new(env, &contract_id);
    (contract_id, token, stellar_asset_client)
}

#[test]
fn test_registration_and_staking() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let treasury = Address::generate(&env);
    let (token_addr, token_client, stellar_asset) = create_token(&env, &admin);
    let contract_id = env.register_contract(None, RelayerSlashingContract);
    let client = RelayerSlashingContractClient::new(&env, &contract_id);
    client.initialize(&admin, &token_addr, &treasury, &5000, &10);
    stellar_asset.mint(&relayer, &1000);
    client.register_relayer(&relayer, &1000);
    let info = client.get_relayer_info(&relayer).unwrap();
    assert_eq!(info.stake_amount, 1000);
    assert_eq!(info.status, RelayerStatus::Active);
    assert_eq!(token_client.balance(&contract_id), 1000);
}

#[test]
fn test_dispute_and_slash_relayer() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let treasury = Address::generate(&env);
    let (token_addr, token_client, stellar_asset) = create_token(&env, &admin);
    let contract_id = env.register_contract(None, RelayerSlashingContract);
    let client = RelayerSlashingContractClient::new(&env, &contract_id);
    client.initialize(&admin, &token_addr, &treasury, &5000, &10);
    stellar_asset.mint(&relayer, &1000);
    client.register_relayer(&relayer, &1000);
    client.dispute_relayer(&relayer);
    client.slash_relayer(&relayer);
    let info = client.get_relayer_info(&relayer).unwrap();
    assert_eq!(info.stake_amount, 500);
    assert_eq!(info.status, RelayerStatus::Slashed);
    assert_eq!(token_client.balance(&treasury), 500);
}

#[test]
fn test_withdraw_success_after_unbonding() {
    let env = Env::default();
    env.ledger().set_timestamp(0);
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let (token_addr, token_client, stellar_asset) = create_token(&env, &admin);
    let contract_id = env.register_contract(None, RelayerSlashingContract);
    let client = RelayerSlashingContractClient::new(&env, &contract_id);
    client.initialize(&admin, &token_addr, &admin, &5000, &60);
    stellar_asset.mint(&relayer, &1000);
    client.register_relayer(&relayer, &1000);
    client.request_unstake(&relayer);
    env.ledger().set_timestamp(70);
    client.withdraw_stake(&relayer);
    assert_eq!(token_client.balance(&relayer), 1000);
    assert_eq!(client.get_relayer_info(&relayer).unwrap().status, RelayerStatus::Withdrawn);
}

#[test]
#[should_panic(expected = "Unbonding period not met")]
fn test_withdraw_fails_within_unbonding_period() {
    let env = Env::default();
    env.ledger().set_timestamp(0);
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let relayer = Address::generate(&env);
    let (token_addr, _token_client, stellar_asset) = create_token(&env, &admin);
    let contract_id = env.register_contract(None, RelayerSlashingContract);
    let client = RelayerSlashingContractClient::new(&env, &contract_id);
    client.initialize(&admin, &token_addr, &admin, &5000, &60);
    stellar_asset.mint(&relayer, &1000);
    client.register_relayer(&relayer, &1000);
    client.request_unstake(&relayer);
    env.ledger().set_timestamp(30);
    client.withdraw_stake(&relayer);
}
