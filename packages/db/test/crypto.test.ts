import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  decryptSecret,
  encryptSecret,
  generateApiKey,
  hashApiKey,
  safeEqual,
} from "../src/crypto";

const ENV_KEYS = ["PLATFORM_ENCRYPTION_KEY", "AGENT_SECRET_KEY", "NODE_ENV"] as const;
type SavedEnvironment = Record<(typeof ENV_KEYS)[number], string | undefined>;

let savedEnvironment: SavedEnvironment;

function setEnvironment(values: Partial<SavedEnvironment>): void {
  for (const key of ENV_KEYS) {
    const value = values[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function encryptionKey(byte = 7): string {
  return Buffer.alloc(32, byte).toString("base64");
}

beforeEach(() => {
  savedEnvironment = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]])) as SavedEnvironment;
  setEnvironment({ PLATFORM_ENCRYPTION_KEY: encryptionKey(), NODE_ENV: "test" });
});

afterEach(() => {
  setEnvironment(savedEnvironment);
});

describe("secret encryption", () => {
  test("round trips empty and Unicode plaintext", () => {
    expect(decryptSecret(encryptSecret(""))).toBe("");
    expect(decryptSecret(encryptSecret("Pachiware 🔐 — 日本語"))).toBe("Pachiware 🔐 — 日本語");
  });

  test("uses a new nonce for each encryption", () => {
    const first = encryptSecret("same plaintext");
    const second = encryptSecret("same plaintext");

    expect(first).not.toBe(second);
    expect(first.split(":")[1]).not.toBe(second.split(":")[1]);
    expect(decryptSecret(first)).toBe("same plaintext");
    expect(decryptSecret(second)).toBe("same plaintext");
  });

  test("rejects tampered nonce, tag, and ciphertext", () => {
    const encrypted = encryptSecret("confidential");

    for (const index of [1, 2, 3]) {
      const parts = encrypted.split(":");
      const bytes = Buffer.from(parts[index], "base64");
      bytes[0] ^= 1;
      parts[index] = bytes.toString("base64");

      expect(() => decryptSecret(parts.join(":"))).toThrow("Encrypted secret authentication failed");
    }
  });

  test("rejects malformed envelopes, encodings, and versions", () => {
    const encrypted = encryptSecret("secret");
    const [, nonce, tag, ciphertext] = encrypted.split(":");

    for (const invalid of [
      "v2:" + nonce + ":" + tag + ":" + ciphertext,
      "v1:" + nonce + ":" + tag,
      "v1:not-base64:" + tag + ":" + ciphertext,
      "v1:" + nonce + ":" + tag + ":not-base64",
      "v1:" + Buffer.alloc(11).toString("base64") + ":" + tag + ":" + ciphertext,
      "v1:" + nonce + ":" + Buffer.alloc(15).toString("base64") + ":" + ciphertext,
    ]) {
      expect(() => decryptSecret(invalid)).toThrow("Invalid encrypted secret envelope");
    }
  });

  test("rejects a ciphertext encrypted with another key source", () => {
    setEnvironment({ PLATFORM_ENCRYPTION_KEY: undefined, AGENT_SECRET_KEY: "first-development-source", NODE_ENV: "test" });
    const encrypted = encryptSecret("secret");

    setEnvironment({ PLATFORM_ENCRYPTION_KEY: undefined, AGENT_SECRET_KEY: "changed-development-source", NODE_ENV: "test" });
    expect(() => decryptSecret(encrypted)).toThrow("Encrypted secret authentication failed");
  });

  test("requires an explicit encryption key in production", () => {
    setEnvironment({ PLATFORM_ENCRYPTION_KEY: undefined, AGENT_SECRET_KEY: "development-secret", NODE_ENV: "production" });
    expect(() => encryptSecret("secret")).toThrow("PLATFORM_ENCRYPTION_KEY is required in production");
  });

  test("derives a deterministic development fallback and requires its source", () => {
    setEnvironment({ PLATFORM_ENCRYPTION_KEY: undefined, AGENT_SECRET_KEY: "stable-development-secret", NODE_ENV: "test" });
    const first = encryptSecret("same plaintext");
    expect(decryptSecret(first)).toBe("same plaintext");

    delete process.env.AGENT_SECRET_KEY;
    expect(() => encryptSecret("secret")).toThrow("Set PLATFORM_ENCRYPTION_KEY or AGENT_SECRET_KEY for development");
  });

  test("validates configured encryption keys strictly", () => {
    for (const invalidKey of [
      "not base64",
      Buffer.alloc(31).toString("base64"),
      encryptionKey().replace(/=$/, ""),
      encryptionKey() + "\n",
    ]) {
      setEnvironment({ PLATFORM_ENCRYPTION_KEY: invalidKey, NODE_ENV: "test" });
      expect(() => encryptSecret("secret")).toThrow("PLATFORM_ENCRYPTION_KEY must be a canonical base64-encoded 32-byte key");
    }
  });
});

describe("API-key crypto helpers", () => {
  test("hashes with SHA-256", () => {
    expect(hashApiKey("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  test("compares equal, unequal, different-length, and Unicode values safely", () => {
    expect(safeEqual("same", "same")).toBe(true);
    expect(safeEqual("same", "different")).toBe(false);
    expect(safeEqual("same", "same-but-longer")).toBe(false);
    expect(safeEqual("dunia 🌍", "dunia 🌍")).toBe(true);
    expect(safeEqual("dunia 🌍", "dunia 🌎")).toBe(false);
  });

  test("generates unique URL-safe keys and exposes their prefix", () => {
    const keys = Array.from({ length: 10 }, () => generateApiKey("pk_"));

    expect(new Set(keys.map(({ raw }) => raw)).size).toBe(keys.length);
    for (const { raw, keyPrefix } of keys) {
      expect(raw).toStartWith("pk_");
      expect(raw).toMatch(/^pk_[A-Za-z0-9_-]+$/);
      expect(raw).toHaveLength(35);
      expect(keyPrefix).toBe(raw.slice(0, 12));
      expect(keyPrefix).toHaveLength(12);
    }
  });

  test("rejects invalid API-key prefixes", () => {
    for (const prefix of ["", "too_long_", "has-dash", "has space", "unicode_🌍"]) {
      expect(() => generateApiKey(prefix)).toThrow("API key prefix must contain 1-8 alphanumeric or underscore characters");
    }
  });
});
