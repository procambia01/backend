//src/app.ts
import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import { config } from '@/config/env';
import corsOptions from '@/config/cors';
import { errorHandler, notFound } from '@/middleware/error.middleware';
import { httpLogger } from '@/middleware/logger.middleware';
import { generalRateLimit } from '@/middleware/rateLimit.middleware';
import routes from '@/routes';
import logger from '@/utils/logger.util';

class App {
  public app: Application;

  constructor() {
    this.app = express();
    this.initializeMiddlewares();
    this.initializeRoutes();
    this.initializeErrorHandling();
  }

  private initializeMiddlewares(): void {
    this.app.use(
      helmet({
        contentSecurityPolicy: config.isProduction,
        crossOriginEmbedderPolicy: config.isProduction,
      })
    );
    this.app.use(cors(corsOptions));
    // Stripe requires the raw, unparsed request body to verify webhook
    // signatures — this MUST be registered before express.json() and
    // MUST match the exact mount path used in routes/index.ts.
    this.app.use(
      '/api/v1/subscriptions/webhook',
      express.raw({ type: 'application/json' })
    );
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));
    this.app.use(cookieParser(config.security.cookieSecret));
    this.app.use(compression());
    this.app.use(httpLogger);
    if (config.isProduction) {
      this.app.use('/api', generalRateLimit);
    }
    this.app.set('trust proxy', 1);
    logger.info('✅ Middlewares initialized');
  }

  private initializeRoutes(): void {
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        message: 'Server is healthy',
        timestamp: new Date().toISOString(),
        environment: config.nodeEnv,
      });
    });
    this.app.use('/api', routes);
    this.app.get('/', (req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        message: `${config.appName} API`,
        version: '1.0.0',
        environment: config.nodeEnv,
        documentation: `${config.apiUrl}/api/docs`,
      });
    });
    logger.info('✅ Routes initialized');
  }

  private initializeErrorHandling(): void {
    this.app.use(notFound);
    this.app.use(errorHandler);
    logger.info('✅ Error handling initialized');
  }

  public getApp(): Application {
    return this.app;
  }
}

export default new App().getApp();
