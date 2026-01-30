import { Keypair } from "@stellar/stellar-sdk";

export function generateStellarKeypair() {
  const keypair = Keypair.random();
  return {
    publicKey: keypair.publicKey(),
    secretKey: keypair.secret(),
  };
}
