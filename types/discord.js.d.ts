declare module "discord.js" {
  export class Client {
    constructor(options: Record<string, unknown>);
    once(event: string, handler: (...args: unknown[]) => void): void;
    on(event: string, handler: (...args: unknown[]) => void): void;
    login(token: string): Promise<string>;
    user?: { username: string; tag: string };
  }
  export class Message {}
  export const REST: Record<string, unknown>;
  export const Routes: Record<string, unknown>;
  export const GatewayIntentBits: Record<string, unknown>;
}
