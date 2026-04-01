// src/cron/exchangeRate.cron.ts
import { ExchangeRateService } from '@/services/exchangeRate.service';
import logger from '@/utils/logger.util';

const exchangeRateService = new ExchangeRateService();

/**
 * Update exchange rates from external API
 */
export async function updateExchangeRates(): Promise<void> {
  try {
    logger.info('Fetching latest exchange rates...');

    // Define currency pairs to update
    const currencyPairs = [
      { from: 'USD', to: 'NGN' },
      { from: 'EUR', to: 'NGN' },
      { from: 'GBP', to: 'NGN' },
      { from: 'USD', to: 'EUR' },
      { from: 'USD', to: 'GBP' },
      { from: 'EUR', to: 'GBP' },
    ];

    // Update each currency pair
    for (const pair of currencyPairs) {
      try {
        await exchangeRateService.getRate(pair.from, pair.to);
        logger.info(`Updated ${pair.from}/${pair.to} exchange rate`);
      } catch (error) {
        logger.error(`Failed to update ${pair.from}/${pair.to}:`, error);
      }
    }

    logger.info('Exchange rate update completed');
  } catch (error) {
    logger.error('Exchange rate update error:', error);
    throw error;
  }
}