declare module "ioredis" {
  export default class Redis {
    constructor(options?: Record<string, unknown>);
    on(event: string, handler: (err?: Error) => void): void;
    get(key: string): Promise<string | null>;
    setex(key: string, seconds: number, value: string): Promise<"OK">;
    mget(...keys: string[]): Promise<(string | null)[]>;
    del(...keys: string[]): Promise<number>;
    keys(pattern: string): Promise<string[]>;
    info(section?: string): Promise<string>;
    quit(): Promise<void>;
    ping(): Promise<string>;
  }
}
