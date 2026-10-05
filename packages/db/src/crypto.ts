import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

const VERSION = "v1";
const ALGORITHM = "aes-256-gcm";

function encryptionKey(): Buffer {
  const configured = process.env.PLATFORM_ENCRYPTION_KEY;
  if (configured !== undefined) {
    const key = Buffer.from(configured, "base64");
    if (key.length !== 32 || key.toString("base64") !== configured) {
      throw new Error("PLATFORM_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key");
    }
    return key;
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("PLATFORM_ENCRYPTION_KEY is required in production");
  }
  const secret = process.env.AGENT_SECRET_KEY;
  if (!secret) {
    throw new Error("Set PLATFORM_ENCRYPTION_KEY or AGENT_SECRET_KEY for development");
  }
  return createHash("sha256").update("pachiware:secret-encryption:v1\0").update(secret).digest();
}

/** Versioned envelope: version:nonce:authentication tag:ciphertext (base64). */
export function encryptSecret(plaintext: string): string {
  const nonce = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(VERSION));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, nonce.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(encrypted: string): string {
  const parts = encrypted.split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) {
    throw new Error("Invalid encrypted secret envelope");
  }
  const encoded = parts.slice(1);
  const [nonce, tag, ciphertext] = encoded.map((part) => Buffer.from(part, "base64"));
  if (encoded.some((part, i) => [nonce, tag, ciphertext][i].toString("base64") !== part)
    || nonce.length !== 12 || tag.length !== 16) {
    throw new Error("Invalid encrypted secret envelope");
  }

  const key = encryptionKey();
  try {
    const decipher = createDecipheriv(ALGORITHM, key, nonce);
    decipher.setAAD(Buffer.from(VERSION));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    throw new Error("Encrypted secret authentication failed");
  }
}

export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey, "utf8").digest("hex");
}

export function safeEqual(a: string, b: string): boolean {
  // Hashing gives timingSafeEqual fixed-size inputs even when lengths differ.
  const digest = (value: string) => createHash("sha256").update(value, "utf8").digest();
  return timingSafeEqual(digest(a), digest(b));
}

export function generateApiKey(prefix = "pk_live_"): { raw: string; keyPrefix: string } {
  if (!/^[A-Za-z0-9_]{1,8}$/.test(prefix)) {
    throw new Error("API key prefix must contain 1-8 alphanumeric or underscore characters");
  }
  const raw = prefix + randomBytes(24).toString("base64url");
  return { raw, keyPrefix: raw.slice(0, 12) };
}
