import Redis from 'ioredis';
import { config } from './env';
import logger from '@/utils/logger.util';

class RedisClient {
  private client: Redis;
  private subscriber: Redis;
  private publisher: Redis;

  constructor() {
    // Create Redis clients based on configuration
    this.client = this.createRedisClient();
    this.subscriber = this.createRedisClient();
    this.publisher = this.createRedisClient();

    this.setupEventHandlers();
  }

  private createRedisClient(): Redis {
    if (config.redis.url) {
      // If URL is provided, use it directly
      return new Redis(config.redis.url);
    } else {
      // Otherwise, use individual options
      return new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        retryStrategy: (times: number) => {
          const delay = Math.min(times * 50, 2000);
          return delay;
        },
        maxRetriesPerRequest: 3,
      });
    }
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => {
      logger.info('✅ Redis client connected');
    });

    this.client.on('ready', () => {
      logger.info('Redis client ready');
    });

    this.client.on('error', (error) => {
      logger.error('Redis client error:', error);
    });

    this.client.on('close', () => {
      logger.warn('Redis client connection closed');
    });

    this.client.on('reconnecting', () => {
      logger.info('Redis client reconnecting...');
    });

    this.subscriber.on('connect', () => {
      logger.info('Redis subscriber connected');
    });

    this.publisher.on('connect', () => {
      logger.info('Redis publisher connected');
    });
  }

  // Get the main Redis client
  getClient(): Redis {
    return this.client;
  }

  // Get subscriber
  getSubscriber(): Redis {
    return this.subscriber;
  }

  // Get publisher
  getPublisher(): Redis {
    return this.publisher;
  }

  // SET with expiry
  async set(key: string, value: any, expiryInSeconds?: number): Promise<void> {
    const serializedValue = JSON.stringify(value);
    if (expiryInSeconds) {
      await this.client.setex(key, expiryInSeconds, serializedValue);
    } else {
      await this.client.set(key, serializedValue);
    }
  }

  // GET
  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  }

  // DELETE
  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }

  // DELETE multiple keys
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length > 0) {
      await this.client.del(...keys);
    }
  }

  // EXISTS
  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  // EXPIRE
  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }

  // TTL
  async ttl(key: string): Promise<number> {
    return await this.client.ttl(key);
  }

  // KEYS (use with caution in production)
  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }

  // INCR
  async increment(key: string): Promise<number> {
    return await this.client.incr(key);
  }

  // DECR
  async decrement(key: string): Promise<number> {
    return await this.client.decr(key);
  }

  // INCRBY
  async incrementBy(key: string, value: number): Promise<number> {
    return await this.client.incrby(key, value);
  }

  // HSET (Hash set)
  async hset(key: string, field: string, value: any): Promise<void> {
    const serializedValue = JSON.stringify(value);
    await this.client.hset(key, field, serializedValue);
  }

  // HGET (Hash get)
  async hget<T>(key: string, field: string): Promise<T | null> {
    const value = await this.client.hget(key, field);
    if (!value) return null;
    return JSON.parse(value) as T;
  }

  // HGETALL (Hash get all)
  async hgetall<T>(key: string): Promise<Record<string, T>> {
    const values = await this.client.hgetall(key);
    const parsed: Record<string, T> = {};
    
    for (const [field, value] of Object.entries(values)) {
      parsed[field] = JSON.parse(value) as T;
    }
    
    return parsed;
  }

  // HDEL (Hash delete)
  async hdel(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field);
  }

  // SADD (Set add)
  async sadd(key: string, ...members: string[]): Promise<void> {
    await this.client.sadd(key, ...members);
  }

  // SMEMBERS (Set members)
  async smembers(key: string): Promise<string[]> {
    return await this.client.smembers(key);
  }

  // SISMEMBER (Set is member)
  async sismember(key: string, member: string): Promise<boolean> {
    const result = await this.client.sismember(key, member);
    return result === 1;
  }

  // SREM (Set remove)
  async srem(key: string, ...members: string[]): Promise<void> {
    await this.client.srem(key, ...members);
  }

  // ZADD (Sorted set add)
  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member);
  }

  // ZRANGE (Sorted set range)
  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return await this.client.zrange(key, start, stop);
  }

  // ZREM (Sorted set remove)
  async zrem(key: string, member: string): Promise<void> {
    await this.client.zrem(key, member);
  }

  // PUBLISH
  async publish(channel: string, message: any): Promise<void> {
    const serializedMessage = JSON.stringify(message);
    await this.publisher.publish(channel, serializedMessage);
  }

  // SUBSCRIBE
  subscribe(channel: string, callback: (message: any) => void): void {
    this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        try {
          const parsed = JSON.parse(message);
          callback(parsed);
        } catch (error) {
          logger.error('Error parsing Redis message:', error);
        }
      }
    });
  }

  // UNSUBSCRIBE
  async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel);
  }

  // FLUSHDB (clear current database - use with caution)
  async flushdb(): Promise<void> {
    if (!config.isProduction) {
      await this.client.flushdb();
    } else {
      logger.warn('FLUSHDB is disabled in production');
    }
  }

  // Health check
  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis health check failed:', error);
      return false;
    }
  }

  // Graceful shutdown
  async disconnect(): Promise<void> {
    try {
      await this.client.quit();
      await this.subscriber.quit();
      await this.publisher.quit();
      logger.info('Redis clients disconnected');
    } catch (error) {
      logger.error('Error disconnecting Redis clients:', error);
    }
  }
}

// Create singleton instance
const redisClient = new RedisClient();

export default redisClient;