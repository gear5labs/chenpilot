import {
  ContractClient,
  createContractBinding,
  decodeObject,
  validateResultSpec,
} from "../contractClient";
import { SchemaValidationError } from "../schemaValidator";

function mockFetch(result: unknown): jest.MockedFunction<typeof fetch> {
  return jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ result }),
  } as Response);
}

describe("ContractClient", () => {
  it("decodes query results with a typed decoder", async () => {
    type VaultState = { admin: string; paused: boolean };
    const fetcher = mockFetch({ result: { admin: "GADMIN", paused: false } });
    const client = new ContractClient({
      network: "testnet",
      fetcher,
    });

    const result = await client.query<VaultState>({
      contractId: "CCONTRACT",
      method: "state",
      decoder: decodeObject<VaultState>(["admin", "paused"]),
    });

    expect(result.decoded.admin).toBe("GADMIN");
    expect(result.compatibility.compatible).toBe(true);
  });

  it("surfaces fees, auth entries, warnings, and approval checkpoints", async () => {
    const fetcher = mockFetch({
      result: { retval: "ok", auth: [{ address: "GUSER" }] },
      minResourceFee: "1200",
      transactionData: "AAAA",
      warnings: [{ code: "large_fee", message: "Fee exceeds policy" }],
    });
    const client = new ContractClient({ network: "testnet", fetcher });

    const result = await client.simulate({
      contractId: "CCONTRACT",
      method: "withdraw",
      args: ["100"],
      decoder: (value) => String(value),
    });

    expect(result.decoded).toBe("ok");
    expect(result.feeEstimate.minResourceFee).toBe("1200");
    expect(result.authEntries).toHaveLength(1);
    expect(result.transactionDataXdr).toBe("AAAA");
    expect(result.approvalRequirements.map((r) => r.checkpoint)).toEqual([
      "fee",
      "auth",
      "manual",
    ]);
  });

  it("sends idempotency keys during execution", async () => {
    const fetcher = mockFetch({ hash: "txhash", status: "PENDING" });
    const client = new ContractClient({ network: "testnet", fetcher });

    const result = await client.execute({
      contractId: "CCONTRACT",
      method: "deposit",
      signedTransactionXdr: "SIGNED_XDR",
      idempotencyKey: "deposit-1",
    });

    expect(result.status).toBe("PENDING");
    expect(result.hash).toBe("txhash");
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "Idempotency-Key": "deposit-1" }),
      })
    );
  });

  it("adds compatibility warnings for unsupported networks", async () => {
    const fetcher = mockFetch({ result: { admin: "GADMIN" } });
    const client = new ContractClient({
      network: "mainnet",
      fetcher,
      compatibility: { supportedNetworks: ["testnet"] },
    });

    const result = await client.query({
      contractId: "CCONTRACT",
      method: "admin",
    });

    expect(result.compatibility.compatible).toBe(false);
    expect(result.compatibility.warnings[0]).toContain("mainnet");
  });

  it("creates typed query and simulation bindings", async () => {
    const fetcher = mockFetch({ result: { retval: 7 } });
    const client = new ContractClient({ network: "testnet", fetcher });
    const vault = createContractBinding(client, {
      balance: {
        contractId: "CCONTRACT",
        method: "balance",
        kind: "query",
        decoder: (value) => Number(value),
      },
      previewWithdraw: {
        contractId: "CCONTRACT",
        method: "withdraw",
        kind: "simulate",
        decoder: (value) => Number(value),
      },
    } as const);

    await expect(vault.balance("GUSER")).resolves.toMatchObject({ decoded: 7 });
    await expect(vault.previewWithdraw("100")).resolves.toMatchObject({
      decoded: 7,
    });
  });
});

describe("result spec validation", () => {
  it("passes when decoded result satisfies the spec", async () => {
    const fetcher = mockFetch({ result: { admin: "GADMIN", paused: false } });
    const client = new ContractClient({ network: "testnet", fetcher });

    const result = await client.query({
      contractId: "CCONTRACT",
      method: "state",
      decoder: decodeObject(["admin", "paused"]),
      resultSpec: validateResultSpec({ admin: "string", paused: "boolean" }),
    });

    expect(result.decoded).toMatchObject({ admin: "GADMIN", paused: false });
  });

  it("throws SchemaValidationError when a field has the wrong type", async () => {
    // paused comes back as a string instead of boolean
    const fetcher = mockFetch({ result: { admin: "GADMIN", paused: "yes" } });
    const client = new ContractClient({ network: "testnet", fetcher });

    await expect(
      client.query({
        contractId: "CCONTRACT",
        method: "state",
        resultSpec: validateResultSpec({ admin: "string", paused: "boolean" }),
      })
    ).rejects.toThrow(SchemaValidationError);
  });

  it("throws SchemaValidationError when a required field is missing", async () => {
    const fetcher = mockFetch({ result: { admin: "GADMIN" } }); // paused missing
    const client = new ContractClient({ network: "testnet", fetcher });

    await expect(
      client.query({
        contractId: "CCONTRACT",
        method: "state",
        resultSpec: validateResultSpec({ admin: "string", paused: "boolean" }),
      })
    ).rejects.toThrow(SchemaValidationError);
  });

  it("error contains field-level details", async () => {
    const fetcher = mockFetch({ result: { admin: 42 } });
    const client = new ContractClient({ network: "testnet", fetcher });

    const err = await client
      .query({
        contractId: "CCONTRACT",
        method: "state",
        resultSpec: validateResultSpec({ admin: "string" }),
      })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(SchemaValidationError);
    const errors = (err as SchemaValidationError).errors;
    expect(errors[0].field).toBe("admin");
    expect(errors[0].expected).toBe("string");
    expect(errors[0].received).toBe("number");
  });

  it("resultSpec on a bound method spec is forwarded correctly", async () => {
    const fetcher = mockFetch({ result: { retval: "bad" } }); // number expected
    const client = new ContractClient({ network: "testnet", fetcher });

    const vault = createContractBinding(client, {
      balance: {
        contractId: "CCONTRACT",
        method: "balance",
        kind: "query",
        decoder: (v) => ({ amount: v }),
        resultSpec: validateResultSpec({ amount: "number" }),
      },
    } as const);

    await expect(vault.balance("GUSER")).rejects.toThrow(SchemaValidationError);
  });
});
