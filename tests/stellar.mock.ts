// Jest globals are available after installing @types/jest
// No import needed for jest global
/* eslint-disable @typescript-eslint/no-explicit-any */
import { jest } from "@jest/globals";

export const mockStellarSdk: Record<string, unknown> = {
  Keypair: {
    random: jest.fn(() => ({
      publicKey: () => "GD77MOCKPUBLICKEY1234567890",
      secret: () => "SABC...MOCKSECRET",
    })),
    fromSecret: jest.fn(() => ({
      publicKey: () => "GD77MOCKPUBLICKEY1234567890",
      sign: jest.fn().mockReturnValue(Buffer.from("mock_signature")),
    })),
  },
  Horizon: {
    Server: jest.fn().mockImplementation(() => ({
      loadAccount: jest.fn().mockResolvedValue({
      // Use "as any" before .mockResolvedValue to stop the 'never' error
      loadAccount: (jest.fn() as any).mockResolvedValue({
        id: "GD77MOCKPUBLICKEY1234567890",
        balances: [
          { asset_type: "native", balance: "100.0000" },
          { asset_code: "USDC", balance: "50.00" },
        ],
        sequenceNumber: () => "12345",
      }),
      submitTransaction: jest.fn().mockResolvedValue({
        hash: "mock_hash_123",
        ledger: 45678,
      }),
      strictReceivePaths: jest.fn().mockImplementation(() => ({
        call: jest.fn().mockResolvedValue({
        call: (jest.fn() as any).mockResolvedValue({
          records: [{ source_amount: "10.00", source_asset_type: "native" }],
        }),
      })),
    })),
  },
  Asset: function (
    this: Record<string, unknown>,
    code: string,
    issuer: string,
  ) {
  Asset: function (this: any, code: string, issuer: string) {
    this.code = code;
    this.issuer = issuer;
    this.isNative = () => !code;
  },
  TransactionBuilder: jest.fn().mockImplementation(() => ({
    addOperation: jest.fn().mockReturnThis(),
    addMemo: jest.fn().mockReturnThis(),
    setTimeout: jest.fn().mockReturnThis(),
    build: jest.fn().mockReturnThis(),
    sign: jest.fn().mockReturnThis(),
  })),
  Operation: {
    payment: jest.fn().mockReturnValue({ type: "payment" }),
    pathPaymentStrictReceive: jest
      .fn()
      .mockReturnValue({ type: "pathPayment" }),
  },
  Network: {
    TESTNET: "Test SDF Network ; September 2015",
  },
};

jest.mock("@stellar/stellar-sdk", () => mockStellarSdk);
jest.mock("stellar-sdk", () => mockStellarSdk);
