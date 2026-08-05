let draining = false;
let shutdownController = new AbortController();

export function isDraining(): boolean {
  return draining;
}

export function beginDraining(): boolean {
  if (draining) {
    return false;
  }
  draining = true;
  return true;
}

export function shutdownSignal(): AbortSignal {
  return shutdownController.signal;
}

export function abortShutdown(): boolean {
  if (shutdownController.signal.aborted) {
    return false;
  }
  shutdownController.abort();
  return true;
}

/** @internal tests */
export function resetLifecycleForTests(): void {
  draining = false;
  shutdownController = new AbortController();
}
