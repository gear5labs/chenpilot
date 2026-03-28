#![no_std]
use soroban_sdk::{contract, contractimpl, Env, Symbol, String};

#[contract]
pub struct CoreVaultContract;

#[contractimpl]
impl CoreVaultContract {
    pub fn hello(env: Env, to: String) -> String {
        to
    }
}

mod test;
