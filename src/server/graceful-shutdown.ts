import type {Server} from 'node:http';

type ShutdownSignal = 'SIGINT' | 'SIGTERM';

interface ShutdownLogger {
  info(message: string): void;
  error(message: string): void;
}

interface ShutdownOptions {
  timeoutMs?: number;
  logger?: ShutdownLogger;
  forceExit?: (code: number) => never;
}

interface ShutdownServer {
  close(callback: (error?: Error) => void): unknown;
  closeAllConnections(): void;
}

export function createGracefulShutdownHandler(
  server: ShutdownServer,
  options: ShutdownOptions = {},
): (signal: ShutdownSignal) => void {
  const timeoutMs = options.timeoutMs ?? 10_000;
  const logger = options.logger ?? console;
  const forceExit = options.forceExit ?? ((code: number) => process.exit(code));
  let shuttingDown = false;

  return (signal: ShutdownSignal): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Graceful shutdown requested by ${signal}`);

    const deadline = setTimeout(() => {
      logger.error(`Graceful shutdown exceeded ${timeoutMs}ms; closing active connections`);
      server.closeAllConnections();
      forceExit(1);
    }, timeoutMs);
    deadline.unref();

    server.close(error => {
      clearTimeout(deadline);
      if (error) {
        logger.error('Graceful shutdown failed');
        forceExit(1);
      }
      logger.info(`Graceful shutdown complete after ${signal}`);
    });
  };
}

export function installGracefulShutdown(server: Server): void {
  const shutdown = createGracefulShutdownHandler(server);
  process.once('SIGTERM', shutdown);
  process.once('SIGINT', shutdown);
}
