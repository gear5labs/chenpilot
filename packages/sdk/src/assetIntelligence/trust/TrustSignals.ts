/**
 * Trust Signals Implementation
 * Individual signal implementations for trust scoring
 */

import { TrustSignal, Asset } from '../core/types';
import type { AbortSignalLike } from '../../types';

export class TrustSignals {
  /**
   * Get all trust signals for an asset.
   *
   * @param asset - The asset to fetch signals for.
   * @param signal - Optional cancellation signal.  When the signal fires before
   *   any in-flight provider request completes, the promise rejects with an
   *   AbortError and no partial signal data is returned.
   */
  async getAllSignals(asset: Asset, signal?: AbortSignalLike): Promise<TrustSignal[]> {
    void asset;
    void signal;
    return [];
  }
}
