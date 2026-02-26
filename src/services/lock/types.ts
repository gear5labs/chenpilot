export interface LockOptions {
  ttl?: number; // Lock TTL in milliseconds
  retryDelay?: number; // Delay between retries in milliseconds
  maxRetries?: number; // Maximum number of retries
}

export interface LockResult {
  acquired: boolean;
  lockKey: string;
  lockValue?: string;
  ttl?: number;
  error?: string;
}

export interface LockInfo {
  key: string;
  value: string;
  ttl: number;
  createdAt: number;
}

export interface LockService {
  acquireLock(
    resourceKey: string,
    identifier: string,
    options?: LockOptions
  ): Promise<LockResult>;

  releaseLock(resourceKey: string, identifier: string): Promise<boolean>;

  extendLock(
    resourceKey: string,
    identifier: string,
    ttl: number
  ): Promise<boolean>;

  isLocked(resourceKey: string): Promise<boolean>;

  getLockInfo(resourceKey: string): Promise<LockInfo | null>;
}
