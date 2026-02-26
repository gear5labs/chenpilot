/**
 * Horizon Client for Stellar API interactions with cursor-based pagination support
 */

export interface PaginationOptions {
  cursor?: string;
  limit?: number;
}

export interface AccountOffer {
  id: string;
  paging_token: string;
  seller: string;
  selling: {
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  };
  buying: {
    asset_type: string;
    asset_code?: string;
    asset_issuer?: string;
  };
  amount: string;
  price_r: {
    n: number;
    d: number;
  };
  price: string;
  last_modified_ledger: number;
  last_modified_time: string;
}

export interface PaginatedResponse<T> {
  records: T[];
  nextCursor?: string;
  prevCursor?: string;
}

interface HorizonLinkObject {
  href: string;
}

interface HorizonLinks {
  self: HorizonLinkObject;
  next?: HorizonLinkObject;
  prev?: HorizonLinkObject;
}

interface HorizonApiResponse<T> {
  _links: HorizonLinks;
  _embedded?: {
    records: T[];
  };
  records?: T[];
}

interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

type FetchLike = (url: string, options?: FetchOptions) => Promise<Response>;

interface Response {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}

export interface HorizonClientOptions {
  baseUrl?: string;
  fetchFn?: FetchLike;
}

/**
 * Horizon Client for accessing Stellar Horizon API with cursor-based pagination
 */
export class HorizonClient {
  private baseUrl: string;
  private fetch: FetchLike;

  constructor(options: HorizonClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "https://horizon.stellar.org";
    this.fetch = options.fetchFn ?? globalThis.fetch;
  }

  /**
   * Fetch account offers with cursor-based pagination
   * @param accountId - The account ID to fetch offers for
   * @param options - Pagination options (cursor and limit)
   * @returns Paginated response with account offers
   */
  async getAccountOffers(
    accountId: string,
    options?: PaginationOptions
  ): Promise<PaginatedResponse<AccountOffer>> {
    const params = new URLSearchParams();

    if (options?.cursor) {
      params.append("cursor", options.cursor);
    }

    if (options?.limit) {
      // Horizon API has a maximum limit of 200
      params.append("limit", Math.min(options.limit, 200).toString());
    } else {
      // Default limit
      params.append("limit", "50");
    }

    const url = `${this.baseUrl}/accounts/${accountId}/offers?${params.toString()}`;

    const response = await this.fetch(url);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to fetch account offers: ${response.status} ${errorText}`
      );
    }

    const data = (await response.json()) as HorizonApiResponse<AccountOffer>;

    // Extract next and previous cursors from Horizon links
    let nextCursor: string | undefined;
    let prevCursor: string | undefined;

    if (data._links?.next?.href) {
      const nextUrl = new URL(data._links.next.href);
      nextCursor = nextUrl.searchParams.get("cursor") ?? undefined;
    }

    if (data._links?.prev?.href) {
      const prevUrl = new URL(data._links.prev.href);
      prevCursor = prevUrl.searchParams.get("cursor") ?? undefined;
    }

    const records = data._embedded?.records ?? data.records ?? [];

    return {
      records,
      nextCursor,
      prevCursor,
    };
  }

  /**
   * Async iterator for iterating through all account offers
   * Automatically handles pagination using cursors
   * @param accountId - The account ID to fetch offers for
   * @param pageSize - Number of records per page (default: 50, max: 200)
   */
  async *iterateAccountOffers(
    accountId: string,
    pageSize: number = 50
  ): AsyncGenerator<AccountOffer> {
    let cursor: string | undefined;
    let hasMore = true;

    while (hasMore) {
      const page = await this.getAccountOffers(accountId, {
        cursor,
        limit: pageSize,
      });

      for (const record of page.records) {
        yield record;
      }

      if (!page.nextCursor) {
        hasMore = false;
      } else {
        cursor = page.nextCursor;
      }
    }
  }
}
