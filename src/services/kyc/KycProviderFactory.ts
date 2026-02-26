import { KycProvider } from "./types";

export class KycProviderFactory {
  private providers = new Map<string, KycProvider>();
  private defaultProviderName: string;

  constructor(defaultProviderName: string) {
    this.defaultProviderName = defaultProviderName;
  }

  register(provider: KycProvider): void {
    this.providers.set(provider.name, provider);
  }

  setDefaultProvider(providerName: string): void {
    this.defaultProviderName = providerName;
  }

  getProvider(providerName?: string): KycProvider {
    const selectedProviderName = providerName || this.defaultProviderName;
    const provider = this.providers.get(selectedProviderName);

    if (!provider) {
      throw new Error(
        `KYC provider '${selectedProviderName}' is not registered`
      );
    }

    return provider;
  }

  getRegisteredProviders(): string[] {
    return Array.from(this.providers.keys());
  }
}
