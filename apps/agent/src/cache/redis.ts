import Redis from "ioredis";
import { config } from "../config.js";

export const redis = new Redis(config.redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 100, 2000);
    return delay;
  },
  lazyConnect: true,
});

redis.on("connect", () => {
  console.log("⚡ Connected to Redis at", config.redisUrl);
});

redis.on("error", (err) => {
  console.warn("⚠️ Redis connection issue:", err.message);
});

export class CacheService {
  /**
   * Get parsed JSON from Redis cache.
   */
  static async get<T>(key: string): Promise<T | null> {
    try {
      const data = await redis.get(key);
      if (!data) return null;
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  /**
   * Set JSON in Redis cache with TTL in seconds.
   */
  static async set(key: string, value: any, ttlSeconds: number = 300): Promise<void> {
    try {
      await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
    } catch (err) {
      console.warn(`Failed to set cache key "${key}":`, err);
    }
  }

  /**
   * Invalidate one or more keys.
   */
  static async del(...keys: string[]): Promise<void> {
    try {
      if (keys.length > 0) {
        await redis.del(...keys);
      }
    } catch (err) {
      console.warn("Failed to delete cache keys:", err);
    }
  }

  /**
   * Rate limiting using sliding window / token count in Redis.
   */
  static async checkRateLimit(
    identifier: string,
    limit: number = 20,
    windowSeconds: number = 60
  ): Promise<{ allowed: boolean; remaining: number; resetIn: number }> {
    const key = `ratelimit:${identifier}`;
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
      // If Redis is unreachable, fail-open gracefully
      return { allowed: true, remaining: limit, resetIn: windowSeconds };
    }
  }
}
