interface BackgroundWorkOptions {
  firmsRefreshIntervalMs: number;
  isFirmsActive: () => boolean;
  refreshFirmsData: () => void | Promise<void>;
  watchEffisHealth: () => () => void;
}

export interface BackgroundWorkController {
  start: () => void;
  pause: () => void;
  resume: (hiddenForMs: number) => void;
  syncFirmsPolling: () => void;
  recordFirmsRefresh: () => void;
}

/** Owns long-running polling so page lifecycle code can pause and resume it
 * without knowing anything about providers, health reports, or map UI. */
export function createBackgroundWorkController(
  options: BackgroundWorkOptions,
): BackgroundWorkController {
  let firmsTimer: number | undefined;
  let stopEffisHealthWatch: (() => void) | undefined;
  let lastFirmsRefreshAt = 0;
  let paused = false;

  const startHealthWatch = (): void => {
    if (paused) return;
    stopEffisHealthWatch ??= options.watchEffisHealth();
  };

  const stopFirmsPolling = (): void => {
    window.clearInterval(firmsTimer);
    firmsTimer = undefined;
  };

  const syncFirmsPolling = (): void => {
    if (paused || !options.isFirmsActive()) {
      stopFirmsPolling();
      return;
    }
    firmsTimer ??= window.setInterval(
      options.refreshFirmsData,
      options.firmsRefreshIntervalMs,
    );
  };

  return {
    start: () => {
      paused = false;
      startHealthWatch();
      syncFirmsPolling();
    },
    pause: () => {
      if (paused) return;
      paused = true;
      stopFirmsPolling();
      stopEffisHealthWatch?.();
      stopEffisHealthWatch = undefined;
    },
    resume: (hiddenForMs) => {
      paused = false;
      startHealthWatch();
      syncFirmsPolling();
      if (!options.isFirmsActive()) return;

      const dataIsStale =
        lastFirmsRefreshAt === 0 ||
        hiddenForMs >= options.firmsRefreshIntervalMs ||
        Date.now() - lastFirmsRefreshAt >= options.firmsRefreshIntervalMs;
      if (dataIsStale) void options.refreshFirmsData();
    },
    syncFirmsPolling,
    recordFirmsRefresh: () => {
      lastFirmsRefreshAt = Date.now();
    },
  };
}
