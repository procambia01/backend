import express, { Application, Request, Response } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { config } from '@/config/env';
import corsOptions from '@/config/cors';
import { checkDatabaseHealth } from '@/config/database';
import { errorHandler, notFound } from '@/middleware/error.middleware';
import { requestLogger } from '@/middleware/logger.middleware';
import routes from '@/routes';
import webhookRoutes from '@/routes/webhooks.routes';

export const API_PREFIX = '/api/v1';

export function createApp(): Application {
  const app = express();
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestLogger);
  app.use(helmet({ contentSecurityPolicy: config.isProduction, crossOriginEmbedderPolicy: config.isProduction }));
  app.use(cors(corsOptions));

  // Stripe needs the raw bytes: mount the webhook BEFORE any JSON body parser.
  app.use(`${API_PREFIX}/webhooks`, webhookRoutes);

  app.use(compression());
  app.use(
    express.json({
      limit: '256kb',
      verify: (req, _res, buf) => {
        (req as Request).rawBody = buf;
      },
    }),
  );
  app.use(express.urlencoded({ extended: false, limit: '64kb' }));

  app.get('/health', (_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: { status: 'ok', time: new Date().toISOString() }, meta: {}, error: null });
  });
  app.get('/ready', async (_req: Request, res: Response) => {
    const db = await checkDatabaseHealth();
    res.status(db ? 200 : 503).json({ success: db, data: { database: db }, meta: {}, error: db ? null : { code: 'SERVICE_UNAVAILABLE', message: 'Not ready', details: null } });
  });

  app.use(API_PREFIX, routes);
  app.get('/', (_req: Request, res: Response) => {
    res.status(200).json({ success: true, data: { name: config.appName, version: '2.0.0', domain: 'cashmouver.com' }, meta: {}, error: null });
  });

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

export default createApp();
