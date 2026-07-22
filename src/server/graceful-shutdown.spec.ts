import {describe, expect, it, vi} from 'vitest';
import {createGracefulShutdownHandler} from './graceful-shutdown';

describe('graceful shutdown', () => {
  it('stops accepting work once and completes without forcing an exit', () => {
    let closeCallback: ((error?: Error) => void) | undefined;
    const server = {
      close: vi.fn(callback => {
        closeCallback = callback;
        return server;
      }),
      closeAllConnections: vi.fn(),
    };
    const logger = {info: vi.fn(), error: vi.fn()};
    const forceExit = vi.fn() as unknown as (code: number) => never;
    const shutdown = createGracefulShutdownHandler(server, {logger, forceExit});

    shutdown('SIGTERM');
    shutdown('SIGINT');
    closeCallback?.();

    expect(server.close).toHaveBeenCalledTimes(1);
    expect(server.closeAllConnections).not.toHaveBeenCalled();
    expect(forceExit).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenLastCalledWith('Graceful shutdown complete after SIGTERM');
  });

  it('bounds shutdown and closes active connections after the deadline', () => {
    vi.useFakeTimers();
    const server = {
      close: vi.fn(() => server),
      closeAllConnections: vi.fn(),
    };
    const logger = {info: vi.fn(), error: vi.fn()};
    const forceExit = vi.fn() as unknown as (code: number) => never;
    const shutdown = createGracefulShutdownHandler(server, {
      timeoutMs: 25,
      logger,
      forceExit,
    });

    shutdown('SIGTERM');
    vi.advanceTimersByTime(25);

    expect(server.closeAllConnections).toHaveBeenCalledOnce();
    expect(forceExit).toHaveBeenCalledWith(1);
    vi.useRealTimers();
  });
});
