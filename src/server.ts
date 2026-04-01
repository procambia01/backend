//src/server.ts
import http from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './app';
import { config } from '@/config/env';
import { connectDatabase, disconnectDatabase } from '@/config/database';
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

  /**
   * Initialize server and all services
   */
  public async initialize(): Promise<void> {
    try {
      // Connect to database
      await connectDatabase();
      logger.info('✅ Database connected');

      // Check Redis connection
      const redisHealthy = await redisClient.healthCheck();
      if (redisHealthy) {
        logger.info('✅ Redis connected');
      } else {
        logger.warn('⚠️ Redis connection failed, some features may not work');
      }

      // Initialize WebSocket
      initializeSocket(this.io);
      logger.info('✅ WebSocket initialized');

      // Initialize cron jobs (if enabled)
      if (config.cron.enabled) {
        const { initializeCronJobs } = await import('@/cron');
        initializeCronJobs();
        logger.info('✅ Cron jobs initialized');
      }

      logger.info('✅ Server initialization complete');
    } catch (error) {
      logger.error('❌ Server initialization failed:', error);
      process.exit(1);
    }
  }

  /**
   * Start the server
   */
  public async start(): Promise<void> {
    try {
      await this.initialize();

      this.httpServer.listen(config.port, () => {
        logger.info(`
╔═══════════════════════════════════════════════════════════════╗
║                                                               ║
║   🚀 ${config.appName}                                        ║
║                                                               ║
║   Environment: ${config.nodeEnv.toUpperCase()}               ║
║   Server URL:  ${config.apiUrl}                              ║
║   Port:        ${config.port}                                ║
║                                                               ║
║   Status:      ✅ RUNNING                                     ║
║                                                               ║
╚═══════════════════════════════════════════════════════════════╝
        `);

        logger.info('📡 Server is ready to accept connections');
      });

      // Handle server errors
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

  /**
   * Graceful shutdown
   */
  public async shutdown(signal: string): Promise<void> {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress...');
      return;
    }

    this.isShuttingDown = true;
    logger.info(`\n🛑 Received ${signal}. Starting graceful shutdown...`);

    try {
      // Stop accepting new connections
      this.httpServer.close(() => {
        logger.info('✅ HTTP server closed');
      });

      // Close WebSocket connections
      this.io.close(() => {
        logger.info('✅ WebSocket connections closed');
      });

      // Disconnect from database
      await disconnectDatabase();
      logger.info('✅ Database disconnected');

      // Disconnect from Redis
      await redisClient.disconnect();
      logger.info('✅ Redis disconnected');

      logger.info('✅ Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('❌ Error during shutdown:', error);
      process.exit(1);
    }
  }

  /**
   * Setup process event handlers
   */
  public setupProcessHandlers(): void {
    // Graceful shutdown on SIGTERM
    process.on('SIGTERM', () => {
      this.shutdown('SIGTERM');
    });

    // Graceful shutdown on SIGINT (Ctrl+C)
    process.on('SIGINT', () => {
      this.shutdown('SIGINT');
    });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error) => {
      logger.error('❌ Uncaught Exception:', error);
      this.shutdown('UNCAUGHT_EXCEPTION');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any) => {
      logger.error('❌ Unhandled Rejection:', reason);
      this.shutdown('UNHANDLED_REJECTION');
    });

    // Handle warnings
    process.on('warning', (warning: Error) => {
      logger.warn('⚠️ Warning:', warning);
    });
  }
}

// Create and start server
const server = new Server();
server.setupProcessHandlers();
server.start().catch((error) => {
  logger.error('❌ Fatal error starting server:', error);
  process.exit(1);
});

export default server;  