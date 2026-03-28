#![cfg(test)]

use super::*;
use soroban_sdk::{Env, String};

#[test]
fn test_hello() {
    let env = Env::default();
    let contract_id = env.register_contract(None, CoreVaultContract);
    let client = CoreVaultContractClient::new(&env, &contract_id);

    let word = String::from_str(&env, "Dev");
    let res = client.hello(&word);
    assert_eq!(res, word);
}
