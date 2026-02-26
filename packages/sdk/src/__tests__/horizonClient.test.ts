import { HorizonClient, AccountOffer } from "../horizonClient";

// Mock fetch function
const createMockFetch = (responses: Map<string, unknown>) => {
  return async (url: string) => {
    const key = url.split("?")[0]; // Get base URL without query params
    const data = responses.get(key);

    if (!data) {
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
        text: async () => "Not found",
      };
    }

    return {
      ok: true,
      status: 200,
      json: async () => data,
      text: async () => JSON.stringify(data),
    };
  };
};

describe("HorizonClient", () => {
  describe("getAccountOffers", () => {
    it("should fetch account offers with default pagination", async () => {
      const mockOffers = [
        {
          id: "1",
          paging_token: "token1",
          seller: "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
          selling: { asset_type: "native" },
          buying: {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer:
              "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
          },
          amount: "100.00",
          price_r: { n: 1, d: 1 },
          price: "1.0000",
          last_modified_ledger: 123456,
          last_modified_time: "2025-01-01T00:00:00Z",
        },
      ];

      const mockResponse = {
        _links: {
          self: {
            href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=50",
          },
          next: {
            href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=50&cursor=token1",
          },
        },
        _embedded: {
          records: mockOffers,
        },
      };

      const mockResponses = new Map([
        [
          "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers",
          mockResponse,
        ],
      ]);

      const client = new HorizonClient({
        baseUrl: "https://horizon.stellar.org",
        fetchFn: createMockFetch(mockResponses),
      });

      const result = await client.getAccountOffers(
        "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
      );

      expect(result.records).toHaveLength(1);
      expect(result.records[0].id).toBe("1");
      expect(result.nextCursor).toBe("token1");
      expect(result.prevCursor).toBeUndefined();
    });

    it("should support cursor-based pagination", async () => {
      const mockOffers1 = [
        {
          id: "1",
          paging_token: "token1",
          seller: "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
          selling: { asset_type: "native" },
          buying: {
            asset_type: "credit_alphanum4",
            asset_code: "USD",
            asset_issuer:
              "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
          },
          amount: "100.00",
          price_r: { n: 1, d: 1 },
          price: "1.0000",
          last_modified_ledger: 123456,
          last_modified_time: "2025-01-01T00:00:00Z",
        },
      ];

      const mockOffers2 = [
        {
          id: "2",
          paging_token: "token2",
          seller: "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
          selling: { asset_type: "native" },
          buying: {
            asset_type: "credit_alphanum4",
            asset_code: "EUR",
            asset_issuer:
              "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
          },
          amount: "200.00",
          price_r: { n: 2, d: 1 },
          price: "2.0000",
          last_modified_ledger: 123457,
          last_modified_time: "2025-01-01T01:00:00Z",
        },
      ];

      const mockResponses = new Map([
        [
          "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers",
          {
            _links: {
              self: {
                href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=10",
              },
              next: {
                href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=10&cursor=token1",
              },
            },
            _embedded: { records: mockOffers1 },
          },
        ],
      ]);

      const client = new HorizonClient({
        baseUrl: "https://horizon.stellar.org",
        fetchFn: async (url: string) => {
          if (url.includes("cursor=token1")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                _links: {
                  self: {
                    href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=10&cursor=token1",
                  },
                  prev: {
                    href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=10",
                  },
                },
                _embedded: { records: mockOffers2 },
              }),
              text: async () => "",
            };
          }

          const baseData = mockResponses.get(url.split("?")[0]);
          return {
            ok: true,
            status: 200,
            json: async () => baseData,
            text: async () => JSON.stringify(baseData),
          };
        },
      });

      const firstPage = await client.getAccountOffers(
        "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
        { limit: 10 }
      );

      expect(firstPage.records).toHaveLength(1);
      expect(firstPage.records[0].id).toBe("1");
      expect(firstPage.nextCursor).toBe("token1");

      if (firstPage.nextCursor) {
        const secondPage = await client.getAccountOffers(
          "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
          { cursor: firstPage.nextCursor, limit: 10 }
        );

        expect(secondPage.records).toHaveLength(1);
        expect(secondPage.records[0].id).toBe("2");
        expect(secondPage.prevCursor).toBeUndefined();
      }
    });

    it("should respect limit parameter and cap at 200", async () => {
      const mockResponse = {
        _links: {
          self: { href: "https://horizon.stellar.org/accounts/test/offers" },
        },
        _embedded: { records: [] },
      };

      let capturedUrl = "";

      const client = new HorizonClient({
        baseUrl: "https://horizon.stellar.org",
        fetchFn: async (url: string) => {
          capturedUrl = url;
          return {
            ok: true,
            status: 200,
            json: async () => mockResponse,
            text: async () => JSON.stringify(mockResponse),
          };
        },
      });

      // Request with limit > 200 should be capped at 200
      await client.getAccountOffers(
        "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
        {
          limit: 500,
        }
      );

      expect(capturedUrl).toContain("limit=200");

      // Request with limit < 200 should use that limit
      await client.getAccountOffers(
        "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
        {
          limit: 75,
        }
      );

      expect(capturedUrl).toContain("limit=75");
    });

    it("should use default limit of 50 when not specified", async () => {
      const mockResponse = {
        _links: {
          self: { href: "https://horizon.stellar.org/accounts/test/offers" },
        },
        _embedded: { records: [] },
      };

      let capturedUrl = "";

      const client = new HorizonClient({
        baseUrl: "https://horizon.stellar.org",
        fetchFn: async (url: string) => {
          capturedUrl = url;
          return {
            ok: true,
            status: 200,
            json: async () => mockResponse,
            text: async () => JSON.stringify(mockResponse),
          };
        },
      });

      await client.getAccountOffers(
        "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
      );

      expect(capturedUrl).toContain("limit=50");
    });

    it("should throw error on failed request", async () => {
      const client = new HorizonClient({
        baseUrl: "https://horizon.stellar.org",
        fetchFn: async () => ({
          ok: false,
          status: 404,
          json: async () => ({}),
          text: async () => "Not found",
        }),
      });

      await expect(
        client.getAccountOffers(
          "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
        )
      ).rejects.toThrow("Failed to fetch account offers");
    });
  });

  describe("iterateAccountOffers", () => {
    it("should iterate through offers using async generator", async () => {
      const mockOffers1 = Array.from({ length: 3 }, (_, i) => ({
        id: `${i + 1}`,
        paging_token: `token${i + 1}`,
        seller: "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
        selling: { asset_type: "native" },
        buying: {
          asset_type: "credit_alphanum4",
          asset_code: "USD",
          asset_issuer:
            "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
        },
        amount: "100.00",
        price_r: { n: 1, d: 1 },
        price: "1.0000",
        last_modified_ledger: 123456 + i,
        last_modified_time: "2025-01-01T00:00:00Z",
      }));

      const mockOffers2 = Array.from({ length: 2 }, (_, i) => ({
        id: `${i + 4}`,
        paging_token: `token${i + 4}`,
        seller: "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
        selling: { asset_type: "native" },
        buying: {
          asset_type: "credit_alphanum4",
          asset_code: "EUR",
          asset_issuer:
            "GBUQWP3BOUZX34ULNQG23RQ6F4BWFIYK536QOXYUKQ7NRXVGD7YDPFH",
        },
        amount: "200.00",
        price_r: { n: 2, d: 1 },
        price: "2.0000",
        last_modified_ledger: 123460,
        last_modified_time: "2025-01-01T01:00:00Z",
      }));

      const client = new HorizonClient({
        baseUrl: "https://horizon.stellar.org",
        fetchFn: async (url: string) => {
          if (url.includes("cursor=token3")) {
            return {
              ok: true,
              status: 200,
              json: async () => ({
                _links: {
                  self: { href: url },
                  prev: { href: "https://horizon.stellar.org/..." },
                },
                _embedded: { records: mockOffers2 },
              }),
              text: async () => "",
            };
          }

          return {
            ok: true,
            status: 200,
            json: async () => ({
              _links: {
                self: { href: url },
                next: {
                  href: "https://horizon.stellar.org/accounts/GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J/offers?limit=3&cursor=token3",
                },
              },
              _embedded: { records: mockOffers1 },
            }),
            text: async () => "",
          };
        },
      });

      const offers: AccountOffer[] = [];

      for await (const offer of client.iterateAccountOffers(
        "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J",
        3
      )) {
        offers.push(offer);
      }

      expect(offers).toHaveLength(5);
      expect(offers[0].id).toBe("1");
      expect(offers[4].id).toBe("5");
    });

    it("should use default page size of 50 when not specified", async () => {
      let capturedUrl = "";

      const client = new HorizonClient({
        baseUrl: "https://horizon.stellar.org",
        fetchFn: async (url: string) => {
          capturedUrl = url;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              _links: { self: { href: url } },
              _embedded: { records: [] },
            }),
            text: async () => "",
          };
        },
      });

      for await (const _offer of client.iterateAccountOffers(
        "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
      )) {
        // Just iterate once to verify pagination setup
        void _offer; // Use the variable to satisfy ESLint
        break;
      }

      expect(capturedUrl).toContain("limit=50");
    });
  });

  describe("custom fetch function", () => {
    it("should use custom fetch function if provided", async () => {
      let fetchCalled = false;

      const customFetch = async () => {
        fetchCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            _links: { self: { href: "" } },
            _embedded: { records: [] },
          }),
          text: async () => "",
        };
      };

      const client = new HorizonClient({
        baseUrl: "https://horizon.stellar.org",
        fetchFn: customFetch,
      });

      await client.getAccountOffers(
        "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
      );

      expect(fetchCalled).toBe(true);
    });
  });

  describe("default base URL", () => {
    it("should use public Horizon server by default", async () => {
      let capturedUrl = "";

      const client = new HorizonClient({
        fetchFn: async (url: string) => {
          capturedUrl = url;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              _links: { self: { href: url } },
              _embedded: { records: [] },
            }),
            text: async () => "",
          };
        },
      });

      await client.getAccountOffers(
        "GBBD47UZQ5PL46VYUWWK7VJT3BNNNL2DJNQB6JQ4YQQB7O2KH6F6PQ5J"
      );

      expect(capturedUrl).toContain("https://horizon.stellar.org");
    });
  });
});
