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
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: config.isProduction,
      crossOriginEmbedderPolicy: config.isProduction,
    }));

    // CORS
    this.app.use(cors(corsOptions));

    // Body parser
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Cookie parser
    this.app.use(cookieParser(config.security.cookieSecret));

    // Compression
    this.app.use(compression());

    // HTTP request logger
    this.app.use(httpLogger);

    // Rate limiting
    if (config.isProduction) {
      this.app.use('/api', generalRateLimit);
    }

    // Trust proxy (for rate limiting, IP detection)
    this.app.set('trust proxy', 1);

    logger.info('✅ Middlewares initialized');
  }

  private initializeRoutes(): void {
    // Health check
    this.app.get('/health', (req: Request, res: Response) => {
      res.status(200).json({
        success: true,
        message: 'Server is healthy',
        timestamp: new Date().toISOString(),
        environment: config.nodeEnv,
      });
    });

    // API routes
    this.app.use('/api', routes);

    // Root route
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
    // 404 handler
    this.app.use(notFound);

    // Global error handler
    this.app.use(errorHandler);

    logger.info('✅ Error handling initialized');
  }

  public getApp(): Application {
    return this.app;
  }
}

export default new App().getApp();