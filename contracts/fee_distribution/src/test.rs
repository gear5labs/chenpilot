#![cfg(test)]

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{token, Address, Env};

fn create_token<'a>(env: &Env, admin: &Address) -> (Address, token::Client<'a>, token::StellarAssetClient<'a>) {
    let contract_id = env.register_stellar_asset_contract(admin.clone());
    let token = token::Client::new(env, &contract_id);
    let stellar_asset_client = token::StellarAssetClient::new(env, &contract_id);
    (contract_id, token, stellar_asset_client)
}

#[test]
fn test_distribute_emits_reconcilable_record() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let ai_agent_pool = Address::generate(&env);
    let lp_pool = Address::generate(&env);
    let fee_source = Address::generate(&env);
    let (token_addr, token_client, stellar_asset) = create_token(&env, &admin);
    let contract_id = env.register_contract(None, FeeDistributionContract);
    let client = FeeDistributionContractClient::new(&env, &contract_id);
    client.initialize(&admin, &treasury, &ai_agent_pool, &lp_pool, &3000, &2000);
    stellar_asset.mint(&fee_source, &10000);
    token_client.approve(&fee_source, &contract_id, &10000, &(env.ledger().sequence() + 100));
    let record = client.distribute(&token_addr, &fee_source, &10000);
    assert_eq!(record.nonce, 1);
    assert_eq!(record.treasury_share, 3000);
    assert_eq!(record.ai_agent_share, 2000);
    assert_eq!(record.lp_share, 5000);
    assert_eq!(token_client.balance(&treasury), 3000);
    assert_eq!(token_client.balance(&ai_agent_pool), 2000);
    assert_eq!(token_client.balance(&lp_pool), 5000);
    assert!(client.last_distribution().is_some());
}

#[test]
fn test_rounding_dust_goes_to_lp() {
    let env = Env::default();
    env.mock_all_auths();
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let ai_agent_pool = Address::generate(&env);
    let lp_pool = Address::generate(&env);
    let fee_source = Address::generate(&env);
    let (token_addr, token_client, stellar_asset) = create_token(&env, &admin);
    let contract_id = env.register_contract(None, FeeDistributionContract);
    let client = FeeDistributionContractClient::new(&env, &contract_id);
    client.initialize(&admin, &treasury, &ai_agent_pool, &lp_pool, &3333, &3333);
    stellar_asset.mint(&fee_source, &10);
    token_client.approve(&fee_source, &contract_id, &10, &(env.ledger().sequence() + 100));
    let record = client.distribute(&token_addr, &fee_source, &10);
    assert_eq!(record.lp_share, 4);
    assert_eq!(token_client.balance(&lp_pool), 4);
}

#[test]
#[should_panic(expected = "amount must be positive")]
fn test_non_positive_distribution_rejected() {
    let env = Env::default();
    let admin = Address::generate(&env);
    let contract_id = env.register_contract(None, FeeDistributionContract);
    let client = FeeDistributionContractClient::new(&env, &contract_id);
    client.initialize(&admin, &admin, &admin, &admin, &0, &0);
    client.distribute(&admin, &admin, &0);
}
