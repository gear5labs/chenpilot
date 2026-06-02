import fs from "fs";
import path from "path";
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const DATA_DIR = path.resolve(process.cwd(), "data");
const SECRETS_FILE = path.join(DATA_DIR, "secrets.json");

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(SECRETS_FILE))
    fs.writeFileSync(SECRETS_FILE, JSON.stringify({}));
}

function getMasterKey(): Buffer {
  const key =
    process.env.SECRET_MASTER_KEY || "dev-master-key-please-change-000000000";
  // Use first 32 bytes for AES-256
  return Buffer.from(key.padEnd(32, "0")).slice(0, 32);
}

function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const key = getMasterKey();
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString("base64");
}

function decrypt(payload: string): string {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.slice(0, 12);
  const tag = raw.slice(12, 28);
  const encrypted = raw.slice(28);
  const key = getMasterKey();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}

export class SecretManager {
  private store: Record<string, string> = {};

  constructor() {
    ensureDataDir();
    try {
      const raw = fs.readFileSync(SECRETS_FILE, "utf8");
      this.store = JSON.parse(raw || "{}");
    } catch {
      this.store = {};
    }
  }

  public async init(): Promise<void> {
    // placeholder for future KMS integrations
    return;
  }

  public setSecret(key: string, value: string): void {
    const encrypted = encrypt(value);
    this.store[key] = encrypted;
    fs.writeFileSync(SECRETS_FILE, JSON.stringify(this.store, null, 2));
  }

  public getSecret(key: string): string | undefined {
    const val = this.store[key];
    if (!val) return undefined;
    try {
      return decrypt(val);
    } catch {
      return undefined;
    }
  }

  public hasSecret(key: string): boolean {
    return key in this.store;
  }

  public exportRawStore(): Record<string, string> {
    return { ...this.store };
  }
}

const defaultManager = new SecretManager();
export default defaultManager;
