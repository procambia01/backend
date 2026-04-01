// src/services/exchangeRate.service.ts
import axios from 'axios';
import { prisma } from '@/config/database';
import redisClient from '@/config/redis';
import { config } from '@/config/env';
import logger from '@/utils/logger.util';
import { BadRequestError } from '@/utils/error.util';

export class ExchangeRateService {
  private cacheExpiry = 3600; // 1 hour

  /**
   * Get exchange rate between two currencies
   */
  async getRate(from: string, to: string): Promise<number> {
    if (!from || !to) {
      throw new BadRequestError('Both currencies are required');
    }

    if (from === to) {
      return 1; // Same currency
    }

    const cacheKey = `rate:${from}:${to}`;

    try {
      // Check cache first
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        logger.debug(`Cache hit for ${from} to ${to}`);
        return parseFloat(cached as string);
      }

      // Fetch from external API
      const rate = await this.fetchRateFromAPI(from, to);

      // Cache result with expiry (EX is in seconds)
      await redisClient.set(cacheKey, rate.toString(), this.cacheExpiry);

      // Store in database for historical tracking
      await prisma.exchangeRateSnapshot.create({
        data: {
          fromCurrency: from.toUpperCase(),
          toCurrency: to.toUpperCase(),
          rate,
          source: 'API',
        },
      });

      logger.info(`Fetched rate: 1 ${from} = ${rate} ${to}`);

      return rate;
    } catch (error) {
      logger.error(`Error getting exchange rate for ${from} to ${to}:`, error);
      
      // Fallback to database if API fails
      const lastKnownRate = await this.getLastKnownRate(from, to);
      if (lastKnownRate) {
        logger.warn(`Using last known rate for ${from} to ${to}`);
        return lastKnownRate;
      }

      throw new Error(`Unable to fetch exchange rate for ${from} to ${to}`);
    }
  }

  /**
   * Fetch rate from external API
   */
  private async fetchRateFromAPI(from: string, to: string): Promise<number> {
    try {
      const url = `${config.exchangeRate.apiUrl}/${from.toUpperCase()}`;
      const response = await axios.get(url, {
        timeout: 5000,
        headers: {
          'Accept': 'application/json',
        },
      });

      const rate = response.data.rates?.[to.toUpperCase()];
      
      if (!rate) {
        throw new Error(`Rate not found for ${to}`);
      }

      return parseFloat(rate);
    } catch (error) {
      logger.error('Exchange rate API error:', error);
      throw error;
    }
  }

  /**
   * Get last known rate from database
   */
  private async getLastKnownRate(from: string, to: string): Promise<number | null> {
    const snapshot = await prisma.exchangeRateSnapshot.findFirst({
      where: {
        fromCurrency: from.toUpperCase(),
        toCurrency: to.toUpperCase(),
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    return snapshot ? snapshot.rate : null;
  }

  /**
   * Get multiple rates
   */
  async getMultipleRates(from: string, toCurrencies: string[]): Promise<Record<string, number>> {
    const rates: Record<string, number> = {};

    await Promise.all(
      toCurrencies.map(async (to) => {
        rates[to] = await this.getRate(from, to);
      })
    );

    return rates;
  }

  /**
   * Convert amount between currencies
   */
  async convertCurrency(amount: number, from: string, to: string): Promise<number> {
    const rate = await this.getRate(from, to);
    return amount * rate;
  }

  /**
   * Get historical rates
   */
  async getHistoricalRates(from: string, to: string, days: number = 30) {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const snapshots = await prisma.exchangeRateSnapshot.findMany({
      where: {
        fromCurrency: from.toUpperCase(),
        toCurrency: to.toUpperCase(),
        createdAt: {
          gte: startDate,
        },
      },
      orderBy: {
        createdAt: 'asc',
      },
    });

    return snapshots.map(snapshot => ({
      date: snapshot.createdAt,
      rate: snapshot.rate,
    }));
  }

  /**
   * Clear cache for a currency pair
   */
  async clearCache(from: string, to: string): Promise<void> {
    const cacheKey = `rate:${from}:${to}`;
    await redisClient.delete(cacheKey);
    logger.info(`Cleared cache for ${from} to ${to}`);
  }

  /**
   * Clear all exchange rate caches
   */
  async clearAllCaches(): Promise<void> {
    const pattern = 'rate:*';
    const keys = await redisClient.keys(pattern);
    
    if (keys.length > 0) {
      // Delete keys one by one
      await Promise.all(keys.map(key => redisClient.delete(key)));
      logger.info(`Cleared ${keys.length} exchange rate caches`);
    }
  }
}