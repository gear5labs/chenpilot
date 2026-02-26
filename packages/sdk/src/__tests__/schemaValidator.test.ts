import {
  horizonValidator,
  sorobanValidator,
  SchemaValidationError,
} from "../schemaValidator";

describe("Schema Validation", () => {
  describe("horizonValidator", () => {
    describe("validateTransaction", () => {
      it("should validate valid Horizon transaction", () => {
        const validTx = {
          id: "tx123",
          hash: "abc123def456",
          ledger: 12345,
          created_at: "2025-01-01T00:00:00Z",
          successful: true,
        };

        const result = horizonValidator.validateTransaction(validTx);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should reject transaction missing required hash", () => {
        const invalidTx = {
          id: "tx123",
          ledger: 12345,
        };

        const result = horizonValidator.validateTransaction(invalidTx);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
        expect(result.errors[0].field).toBe("hash");
      });

      it("should reject transaction with invalid created_at type", () => {
        const invalidTx = {
          hash: "abc123",
          created_at: 12345,
        };

        const result = horizonValidator.validateTransaction(invalidTx);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === "created_at")).toBe(true);
      });

      it("should accept transaction without optional fields", () => {
        const minimalTx = {
          hash: "abc123",
        };

        const result = horizonValidator.validateTransaction(minimalTx);

        expect(result.valid).toBe(true);
      });
    });

    describe("validateAccountOffer", () => {
      it("should validate valid account offer", () => {
        const validOffer = {
          id: "offer123",
          seller: "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
          amount: "100.00",
          price: "1.5000",
          selling: {
            asset_type: "native",
          },
          buying: {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer:
              "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
          },
        };

        const result = horizonValidator.validateAccountOffer(validOffer);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should reject offer missing required fields", () => {
        const incompleteOffer = {
          id: "offer123",
          seller: "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
        };

        const result = horizonValidator.validateAccountOffer(incompleteOffer);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      });

      it("should reject offer with invalid selling structure", () => {
        const invalidOffer = {
          id: "offer123",
          seller: "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
          amount: "100.00",
          price: "1.5000",
          selling: "invalid",
          buying: {
            asset_type: "credit_alphanum4",
          },
        };

        const result = horizonValidator.validateAccountOffer(invalidOffer);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field.startsWith("selling"))).toBe(
          true
        );
      });

      it("should reject offer with missing asset_type in selling", () => {
        const invalidOffer = {
          id: "offer123",
          seller: "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
          amount: "100.00",
          price: "1.5000",
          selling: {
            asset_code: "EUR",
          },
          buying: {
            asset_type: "credit_alphanum4",
          },
        };

        const result = horizonValidator.validateAccountOffer(invalidOffer);

        expect(result.valid).toBe(false);
        expect(
          result.errors.some((e) => e.field === "selling.asset_type")
        ).toBe(true);
      });
    });

    describe("throwOnInvalidTransaction", () => {
      it("should return data when transaction is valid", () => {
        const validTx = {
          hash: "abc123",
        };

        const result = horizonValidator.throwOnInvalidTransaction(validTx);

        expect(result).toEqual(validTx);
      });

      it("should throw SchemaValidationError when transaction is invalid", () => {
        const invalidTx = {
          id: "tx123",
        };

        expect(() => {
          horizonValidator.throwOnInvalidTransaction(invalidTx);
        }).toThrow(SchemaValidationError);
      });

      it("should include errors in thrown exception", () => {
        const invalidTx = {};

        try {
          horizonValidator.throwOnInvalidTransaction(invalidTx);
          fail("Should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(SchemaValidationError);
          if (error instanceof SchemaValidationError) {
            expect(error.errors.length).toBeGreaterThan(0);
            expect(error.errors[0].field).toBe("hash");
          }
        }
      });
    });

    describe("throwOnInvalidAccountOffer", () => {
      it("should return data when offer is valid", () => {
        const validOffer = {
          id: "offer123",
          seller: "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
          amount: "100.00",
          price: "1.5000",
          selling: { asset_type: "native" },
          buying: { asset_type: "credit_alphanum4" },
        };

        const result = horizonValidator.throwOnInvalidAccountOffer(validOffer);

        expect(result).toEqual(validOffer);
      });

      it("should throw SchemaValidationError when offer is invalid", () => {
        const invalidOffer = {
          id: "offer123",
        };

        expect(() => {
          horizonValidator.throwOnInvalidAccountOffer(invalidOffer);
        }).toThrow(SchemaValidationError);
      });
    });
  });

  describe("sorobanValidator", () => {
    describe("validateTransaction", () => {
      it("should validate valid Soroban transaction", () => {
        const validTx = {
          status: "SUCCESS",
          ledger: 1000,
          createdAt: 1234567890,
          events: [],
        };

        const result = sorobanValidator.validateTransaction(validTx);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should reject transaction missing status", () => {
        const invalidTx = {
          ledger: 1000,
        };

        const result = sorobanValidator.validateTransaction(invalidTx);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === "status")).toBe(true);
      });

      it("should reject transaction with invalid status value", () => {
        const invalidTx = {
          status: "INVALID",
        };

        const result = sorobanValidator.validateTransaction(invalidTx);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === "status")).toBe(true);
      });

      it("should accept valid status values", () => {
        const statuses = ["SUCCESS", "FAILED", "NOT_FOUND"];

        for (const status of statuses) {
          const tx = { status };
          const result = sorobanValidator.validateTransaction(tx);
          expect(result.valid).toBe(true);
        }
      });

      it("should reject transaction with invalid events type", () => {
        const invalidTx = {
          status: "SUCCESS",
          events: "not-an-array",
        };

        const result = sorobanValidator.validateTransaction(invalidTx);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === "events")).toBe(true);
      });

      it("should validate transaction with events array", () => {
        const validTx = {
          status: "SUCCESS",
          events: [{ type: "contract", data: "test" }],
        };

        const result = sorobanValidator.validateTransaction(validTx);

        expect(result.valid).toBe(true);
      });

      it("should reject invalid event objects in array", () => {
        const invalidTx = {
          status: "SUCCESS",
          events: [null],
        };

        const result = sorobanValidator.validateTransaction(invalidTx);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === "events[0]")).toBe(true);
      });

      it("should reject transaction with invalid ledger type", () => {
        const invalidTx = {
          status: "SUCCESS",
          ledger: "not-a-number",
        };

        const result = sorobanValidator.validateTransaction(invalidTx);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === "ledger")).toBe(true);
      });
    });

    describe("validateBatchResponse", () => {
      it("should validate valid batch response", () => {
        const validBatch = [
          {
            id: 1,
            result: { status: "SUCCESS" },
          },
          {
            id: 2,
            result: { status: "FAILED" },
          },
        ];

        const result = sorobanValidator.validateBatchResponse(validBatch);

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it("should reject non-array batch response", () => {
        const invalidBatch = {
          id: 1,
          result: { status: "SUCCESS" },
        };

        const result = sorobanValidator.validateBatchResponse(invalidBatch);

        expect(result.valid).toBe(false);
        expect(result.errors[0].field).toBe("root");
      });

      it("should validate batch with error responses", () => {
        const validBatch = [
          {
            id: 1,
            result: { status: "SUCCESS" },
          },
          {
            id: 2,
            error: { code: -32600, message: "Invalid request" },
          },
        ];

        const result = sorobanValidator.validateBatchResponse(validBatch);

        expect(result.valid).toBe(true);
      });

      it("should reject batch item missing id", () => {
        const invalidBatch = [
          {
            result: { status: "SUCCESS" },
          },
        ];

        const result = sorobanValidator.validateBatchResponse(invalidBatch);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === "[0].id")).toBe(true);
      });

      it("should reject batch item with non-numeric id", () => {
        const invalidBatch = [
          {
            id: "not-a-number",
            result: { status: "SUCCESS" },
          },
        ];

        const result = sorobanValidator.validateBatchResponse(invalidBatch);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === "[0].id")).toBe(true);
      });

      it("should reject batch item missing result and error", () => {
        const invalidBatch = [
          {
            id: 1,
            jsonrpc: "2.0",
          },
        ];

        const result = sorobanValidator.validateBatchResponse(invalidBatch);

        expect(result.valid).toBe(false);
        expect(
          result.errors.some(
            (e) => e.field === "[0]" && e.message.includes("result or error")
          )
        ).toBe(true);
      });

      it("should reject batch with invalid error object", () => {
        const invalidBatch = [
          {
            id: 1,
            error: { code: "not-a-number", message: "Error" },
          },
        ];

        const result = sorobanValidator.validateBatchResponse(invalidBatch);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === "[0].error.code")).toBe(
          true
        );
      });

      it("should reject batch with error missing message", () => {
        const invalidBatch = [
          {
            id: 1,
            error: { code: -32600 },
          },
        ];

        const result = sorobanValidator.validateBatchResponse(invalidBatch);

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.field === "[0].error.message")).toBe(
          true
        );
      });

      it("should validate multiple errors in batch", () => {
        const invalidBatch = [
          {
            result: { status: "SUCCESS" },
          },
          {
            id: "not-a-number",
          },
        ];

        const result = sorobanValidator.validateBatchResponse(invalidBatch);

        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThanOrEqual(2);
      });
    });

    describe("throwOnInvalidTransaction", () => {
      it("should return data when transaction is valid", () => {
        const validTx = {
          status: "SUCCESS",
        };

        const result = sorobanValidator.throwOnInvalidTransaction(validTx);

        expect(result).toEqual(validTx);
      });

      it("should throw SchemaValidationError when transaction is invalid", () => {
        const invalidTx = {
          status: "INVALID",
        };

        expect(() => {
          sorobanValidator.throwOnInvalidTransaction(invalidTx);
        }).toThrow(SchemaValidationError);
      });
    });

    describe("throwOnInvalidBatchResponse", () => {
      it("should return data when batch is valid", () => {
        const validBatch = [
          {
            id: 1,
            result: { status: "SUCCESS" },
          },
        ];

        const result = sorobanValidator.throwOnInvalidBatchResponse(validBatch);

        expect(result).toEqual(validBatch);
      });

      it("should throw SchemaValidationError when batch is invalid", () => {
        const invalidBatch = {
          id: 1,
          result: { status: "SUCCESS" },
        };

        expect(() => {
          sorobanValidator.throwOnInvalidBatchResponse(invalidBatch);
        }).toThrow(SchemaValidationError);
      });

      it("should include errors in thrown exception", () => {
        const invalidBatch = [
          {
            result: { status: "SUCCESS" },
          },
        ];

        try {
          sorobanValidator.throwOnInvalidBatchResponse(invalidBatch);
          fail("Should have thrown");
        } catch (error) {
          expect(error).toBeInstanceOf(SchemaValidationError);
          if (error instanceof SchemaValidationError) {
            expect(error.errors.length).toBeGreaterThan(0);
          }
        }
      });
    });
  });

  describe("SchemaValidationError", () => {
    it("should have correct error name", () => {
      const error = new SchemaValidationError("Test error", []);
      expect(error.name).toBe("SchemaValidationError");
    });

    it("should store validation errors", () => {
      const validationErrors = [
        { field: "test", expected: "string", message: "Invalid" },
      ];
      const error = new SchemaValidationError("Test error", validationErrors);

      expect(error.errors).toEqual(validationErrors);
    });

    it("should be instance of Error", () => {
      const error = new SchemaValidationError("Test error", []);
      expect(error).toBeInstanceOf(Error);
    });
  });

  describe("Integration scenarios", () => {
    it("should catch breaking change in Horizon transaction", () => {
      const oldFormatTx = {
        hash: "abc123",
        ledger: "12345", // Breaking change: ledger as string instead of number
      };

      const result = horizonValidator.validateTransaction(oldFormatTx);
      expect(result.valid).toBe(false);
    });

    it("should catch breaking change in Soroban status", () => {
      const brokenTx = {
        status: "PENDING", // New status not yet known
      };

      const result = sorobanValidator.validateTransaction(brokenTx);
      expect(result.valid).toBe(false);
    });

    it("should detect missing required Horizon offer field", () => {
      const offer = {
        id: "offer123",
        seller: "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
        // Missing: amount, price, selling, buying
      };

      const result = horizonValidator.validateAccountOffer(offer);
      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThanOrEqual(4);
    });

    it("should provide helpful error messages for debugging", () => {
      const invalidTx = {
        status: 12345, // Type error
      };

      const result = sorobanValidator.validateTransaction(invalidTx);
      expect(result.errors[0].received).toBe("number");
      expect(result.errors[0].expected).toBe("string");
      expect(result.errors[0].message).toContain("should be");
    });
  });
});
