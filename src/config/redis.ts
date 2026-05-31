// src/config/redis.ts
import Redis from 'ioredis';
import { config } from './env';
import logger from '@/utils/logger.util';

class RedisClient {
  private client: Redis;
  private subscriber: Redis;
  private publisher: Redis;

  constructor() {
    this.client = this.createRedisClient();
    this.subscriber = this.createRedisClient();
    this.publisher = this.createRedisClient();
    this.setupEventHandlers();
  }

  private createRedisClient(): Redis {
    if (config.redis.url) {
      return new Redis(config.redis.url, {
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        tls: config.redis.url.startsWith('rediss://') ? {} : undefined,
        retryStrategy: (times: number) => {
          if (times > 10) return null;
          return Math.min(times * 300, 3000);
        },
      });
    } else {
      return new Redis({
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        db: config.redis.db,
        maxRetriesPerRequest: null,
        enableReadyCheck: false,
        retryStrategy: (times: number) => {
          if (times > 10) return null;
          return Math.min(times * 300, 3000);
        },
      });
    }
  }

  private setupEventHandlers(): void {
    this.client.on('connect', () => logger.info('✅ Redis client connected'));
    this.client.on('ready', () => logger.info('Redis client ready'));
    this.client.on('error', (error) => logger.error('Redis client error:', error));
    this.client.on('close', () => logger.warn('Redis client connection closed'));
    this.client.on('reconnecting', () => logger.info('Redis client reconnecting...'));
    this.subscriber.on('connect', () => logger.info('Redis subscriber connected'));
    this.subscriber.on('error', (e) => logger.error('Redis subscriber error:', e));
    this.publisher.on('connect', () => logger.info('Redis publisher connected'));
    this.publisher.on('error', (e) => logger.error('Redis publisher error:', e));
  }

  getClient(): Redis {
    return this.client;
  }
  getSubscriber(): Redis {
    return this.subscriber;
  }
  getPublisher(): Redis {
    return this.publisher;
  }

  async set(key: string, value: any, expiryInSeconds?: number): Promise<void> {
    const serializedValue = JSON.stringify(value);
    if (expiryInSeconds) {
      await this.client.setex(key, expiryInSeconds, serializedValue);
    } else {
      await this.client.set(key, serializedValue);
    }
  }

  async get<T>(key: string): Promise<T | null> {
    const value = await this.client.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  }

  async delete(key: string): Promise<void> {
    await this.client.del(key);
  }
  async deleteMany(keys: string[]): Promise<void> {
    if (keys.length > 0) await this.client.del(...keys);
  }
  async exists(key: string): Promise<boolean> {
    return (await this.client.exists(key)) === 1;
  }
  async expire(key: string, seconds: number): Promise<void> {
    await this.client.expire(key, seconds);
  }
  async ttl(key: string): Promise<number> {
    return await this.client.ttl(key);
  }
  async keys(pattern: string): Promise<string[]> {
    return await this.client.keys(pattern);
  }
  async increment(key: string): Promise<number> {
    return await this.client.incr(key);
  }
  async decrement(key: string): Promise<number> {
    return await this.client.decr(key);
  }
  async incrementBy(key: string, value: number): Promise<number> {
    return await this.client.incrby(key, value);
  }

  async hset(key: string, field: string, value: any): Promise<void> {
    await this.client.hset(key, field, JSON.stringify(value));
  }
  async hget<T>(key: string, field: string): Promise<T | null> {
    const value = await this.client.hget(key, field);
    if (!value) return null;
    return JSON.parse(value) as T;
  }
  async hgetall<T>(key: string): Promise<Record<string, T>> {
    const values = await this.client.hgetall(key);
    const parsed: Record<string, T> = {};
    for (const [field, value] of Object.entries(values)) {
      parsed[field] = JSON.parse(value) as T;
    }
    return parsed;
  }
  async hdel(key: string, field: string): Promise<void> {
    await this.client.hdel(key, field);
  }
  async sadd(key: string, ...members: string[]): Promise<void> {
    await this.client.sadd(key, ...members);
  }
  async smembers(key: string): Promise<string[]> {
    return await this.client.smembers(key);
  }
  async sismember(key: string, member: string): Promise<boolean> {
    return (await this.client.sismember(key, member)) === 1;
  }
  async srem(key: string, ...members: string[]): Promise<void> {
    await this.client.srem(key, ...members);
  }
  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.client.zadd(key, score, member);
  }
  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return await this.client.zrange(key, start, stop);
  }
  async zrem(key: string, member: string): Promise<void> {
    await this.client.zrem(key, member);
  }

  async publish(channel: string, message: any): Promise<void> {
    await this.publisher.publish(channel, JSON.stringify(message));
  }

  subscribe(channel: string, callback: (message: any) => void): void {
    this.subscriber.subscribe(channel);
    this.subscriber.on('message', (ch, message) => {
      if (ch === channel) {
        try {
          callback(JSON.parse(message));
        } catch (error) {
          logger.error('Error parsing Redis message:', error);
        }
      }
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel);
  }

  async flushdb(): Promise<void> {
    if (!config.isProduction) {
      await this.client.flushdb();
    } else {
      logger.warn('FLUSHDB is disabled in production');
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      const result = await this.client.ping();
      return result === 'PONG';
    } catch (error) {
      logger.error('Redis health check failed:', error);
      return false;
    }
  }

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

const redisClient = new RedisClient();
export default redisClient;
