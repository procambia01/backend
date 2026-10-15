//src/server.ts
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app';
import { config } from '@/config/env';
import { connectDatabase, disconnectDatabase, ensureGeoIndexes } from '@/config/database';
import redisClient from '@/config/redis';
import logger from '@/utils/logger.util';
import { initializeSocket } from '@/websocket/socket';

class Server {
  private httpServer: http.Server;
  private io: SocketIOServer;
  private isShuttingDown: boolean = false;

  constructor() {
    this.httpServer = http.createServer(app);
    this.io = new SocketIOServer(this.httpServer, {
      cors: {
        origin: config.cors.allowedOrigins,
        credentials: true,
      },
    });
  }

  public async initialize(): Promise<void> {
    try {
      await connectDatabase();
      logger.info('✅ Database connected');
      await ensureGeoIndexes();

      const redisHealthy = await redisClient.healthCheck();
      if (redisHealthy) {
        logger.info('✅ Redis connected');
      } else {
        logger.warn('⚠️ Redis connection failed, some features may not work');
      }

      initializeSocket(this.io);

      if (config.cron.enabled) {
        const { startScheduler } = await import('@/jobs/scheduler');
        startScheduler();
        logger.info('✅ Scheduler started');
      }

      logger.info('✅ Server initialization complete');
    } catch (error) {
      logger.error('❌ Server initialization failed:', error);
      process.exit(1);
    }
  }

  public async start(): Promise<void> {
    try {
      await this.initialize();

      this.httpServer.listen(config.port, () => {
        logger.info(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 ${config.appName}
║                                                               ║
║   Environment: ${config.nodeEnv.toUpperCase()}
║   Server URL:  ${config.apiUrl}
║   Port:        ${config.port}
║                                                               ║
║   Status:      ✅ RUNNING                                     ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
        `);
        logger.info('📡 Server is ready to accept connections');
      });

      this.httpServer.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
          logger.error(`❌ Port ${config.port} is already in use`);
        } else {
          logger.error('❌ Server error:', error);
        }
        process.exit(1);
      });
    } catch (error) {
      logger.error('❌ Failed to start server:', error);
      process.exit(1);
    }
  }

  public async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress...');
      return;
    }

    this.isShuttingDown = true;
    logger.info(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

    try {
      const { stopScheduler } = await import('@/jobs/scheduler');
      stopScheduler();
      this.httpServer.close(() => {
        logger.info('✅ HTTP server closed');
      });
      this.io.close(() => {
        logger.info('✅ WebSocket connections closed');
      });
      await disconnectDatabase();
      logger.info('✅ Database disconnected');
      await redisClient.disconnect();
      logger.info('✅ Redis disconnected');
      logger.info('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }

  public setupProcessHandlers(): void {
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('uncaughtException', (error: Error) => {
      logger.error('❌ Uncaught Exception:', error);
      this.shutdown('UNCAUGHT_EXCEPTION');
    });
    process.on('unhandledRejection', (reason: any) => {
      // Redis is an optional dependency by design (see redis.ts / the
      // "⚠️ Redis connection failed, some features may not work" log) —
      // a transient Redis outage should degrade rate limiting/caching,
      // not take the entire API down for every user. Known,
      // recoverable Redis connection errors are logged and swallowed
      // here; anything else still triggers a full shutdown, since an
      // unhandled rejection of unknown origin can leave the process in
      // a genuinely unsafe state.
      const message = reason?.message ?? String(reason);
      const isRecoverableRedisError =
        /Connection is closed|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message) &&
        (reason?.constructor?.name?.toLowerCase().includes('redis') ||
          /redis/i.test(reason?.stack ?? ''));

      if (isRecoverableRedisError) {
        logger.warn(`⚠️ Unhandled Redis rejection (non-fatal, continuing): ${message}`);
        return;
      }

      logger.error('❌ Unhandled Rejection:', reason);
      this.shutdown('UNHANDLED_REJECTION');
    });
    process.on('warning', (warning: Error) => {
      logger.warn('⚠️ Warning:', warning);
    });
  }
}

const server = new Server();
server.setupProcessHandlers();
server.start().catch((error) => {
  logger.error('❌ Fatal error starting server:', error);
  process.exit(1);
});

export default server;
