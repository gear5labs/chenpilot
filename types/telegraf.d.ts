declare module "telegraf" {
  export class Telegraf {
    constructor(token: string);
    launch(): void | Promise<void>;
    on(
      event: string,
      handler: (ctx: Record<string, unknown>) => Promise<void> | void
    ): void;
    start(
      handler: (ctx: Record<string, unknown>) => Promise<void> | void
    ): void;
    help(handler: (ctx: Record<string, unknown>) => Promise<void> | void): void;
  }
}
