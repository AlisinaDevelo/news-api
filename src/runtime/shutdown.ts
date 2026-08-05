import { abortShutdown, beginDraining } from "./lifecycle";

export interface ShutdownServer {
  close(callback: (error?: Error) => void): void;
  closeAllConnections?: () => void;
}

export interface ShutdownHandlerOptions {
  server: ShutdownServer;
  timeoutMs: number;
  cleanup: () => Promise<void>;
  exit?: (code: number) => void;
  onStart?: (signal: string) => void;
  onRepeat?: (signal: string) => void;
  onForced?: () => void;
  onCloseError?: (error: Error) => void;
  onClosed?: () => void;
  onCleanupError?: (error: unknown) => void;
}

export function createShutdownHandler(options: ShutdownHandlerOptions): (signal: string) => void {
  let started = false;
  let finalized = false;
  let cleanupStarted = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const exit = options.exit ?? ((code: number) => process.exit(code));

  const startCleanup = (exitCode?: number): void => {
    if (cleanupStarted) {
      return;
    }
    cleanupStarted = true;
    void Promise.resolve()
      .then(() => options.cleanup())
      .catch((error: unknown) => {
        options.onCleanupError?.(error);
      })
      .finally(() => {
        if (exitCode !== undefined) {
          exit(exitCode);
        }
      });
  };

  const forceExit = (): void => {
    if (finalized) {
      return;
    }
    finalized = true;
    abortShutdown();
    options.server.closeAllConnections?.();
    options.onForced?.();
    startCleanup();
    exit(1);
  };

  const finish = (error?: Error): void => {
    if (finalized) {
      return;
    }
    finalized = true;
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (error) {
      options.onCloseError?.(error);
      startCleanup(1);
      return;
    }
    options.onClosed?.();
    startCleanup(0);
  };

  return (signal: string): void => {
    if (started) {
      options.onRepeat?.(signal);
      return;
    }
    started = true;
    beginDraining();
    options.onStart?.(signal);
    timeout = setTimeout(forceExit, options.timeoutMs);
    timeout.unref?.();
    try {
      options.server.close(finish);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  };
}
