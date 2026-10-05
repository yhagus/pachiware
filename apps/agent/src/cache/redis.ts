import Redis from "ioredis";
import { config } from "../config.js";

// Native In-Memory Store (Zero Third-Party Dependency Fallback)
interface CacheEntry {
  value: any;
  expiresAt: number;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

class InMemoryCache {
  private store = new Map<string, CacheEntry>();
  private rateLimits = new Map<string, RateLimitEntry>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  set(key: string, value: any, ttlSeconds: number = 300): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
  }

  del(...keys: string[]): void {
    for (const k of keys) {
      this.store.delete(k);
    }
  }

  checkRateLimit(
    identifier: string,
    limit: number = 20,
    windowSeconds: number = 60
  ): { allowed: boolean; remaining: number; resetIn: number } {
    const now = Date.now();
    const entry = this.rateLimits.get(identifier);

    if (!entry || now > entry.resetAt) {
      this.rateLimits.set(identifier, {
        count: 1,
        resetAt: now + windowSeconds * 1000,
      });
      return { allowed: true, remaining: limit - 1, resetIn: windowSeconds };
    }

    entry.count += 1;
    const remaining = Math.max(0, limit - entry.count);
    const resetIn = Math.max(1, Math.ceil((entry.resetAt - now) / 1000));

    return {
      allowed: entry.count <= limit,
      remaining,
      resetIn,
    };
  }
}

export const memoryCache = new InMemoryCache();

let isConnected = false;

export function isRedisConnected(): boolean {
  return isConnected;
}

function createRedis(url: string): Redis {
  const client = new Redis(url, {
  maxRetriesPerRequest: 1,
  enableOfflineQueue: false,
  retryStrategy(times) {
    // If Redis is unreachable after 2 quick attempts, stop trying and stay on in-memory fallback
    if (times > 2) {
      return null;
    }
    return 500;
  },
  lazyConnect: true,
  });
  client.on("ready", () => { if (redis === client) isConnected = true; });
  client.on("close", () => { if (redis === client) isConnected = false; });
  client.on("error", () => { if (redis === client) isConnected = false; });
  return client;
}
export let redis = createRedis(config.redisUrl);
export async function reconnectRedis(url: string) {
  redis.disconnect();
  isConnected = false;
  redis = createRedis(url);
  await redis.connect().catch(() => {});
}

export class CacheService {
  /**
   * Get parsed JSON from Redis cache or native in-memory fallback.
   */
  static async get<T>(key: string): Promise<T | null> {
    if (isConnected) {
      try {
        const data = await redis.get(key);
        if (data) return JSON.parse(data) as T;
      } catch {
        // Fall through to memoryCache
      }
    }
    return memoryCache.get<T>(key);
  }

  /**
   * Set JSON in Redis cache and native in-memory fallback with TTL in seconds.
   */
  static async set(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
    memoryCache.set(key, value, ttlSeconds);
    if (isConnected) {
      try {
        await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
      } catch {
        // Safe to ignore, memoryCache is already active
      }
    }
  }

  /**
   * Invalidate one or more keys from both Redis and memory cache.
   */
  static async del(...keys: string[]): Promise<void> {
    memoryCache.del(...keys);
    if (isConnected && keys.length > 0) {
      try {
        await redis.del(...keys);
      } catch {
        // Safe to ignore
      }
    }
  }

  /**
   * Rate limiting using sliding window / token count (Redis with in-memory fallback).
   */
  static async checkRateLimit(
    identifier: string,
    limit: number = 20,
    windowSeconds: number = 60
  ): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    if (isConnected) {
      const key = identifier.startsWith("ratelimit:") ? identifier : `ratelimit:${identifier}`;
      try {
        const current = await redis.incr(key);
        if (current === 1) {
          await redis.expire(key, windowSeconds);
        }
        const ttl = await redis.ttl(key);
        const remaining = Math.max(0, limit - current);

        return {
          allowed: current <= limit,
          remaining,
          resetIn: ttl > 0 ? ttl : windowSeconds,
        };
      } catch {
        // Fall through to in-memory rate limiter
      }
    }

    return memoryCache.checkRateLimit(identifier, limit, windowSeconds);
  }
}

export function tenantKey(tenantId: string, suffix: string): string {
  if (["agent:config", "skills:active"].includes(suffix)) return `${suffix}:${tenantId}`;
  const [namespace, ...parts] = suffix.split(":");
  return `${namespace}:${tenantId}:${parts.join(":")}`;
}
