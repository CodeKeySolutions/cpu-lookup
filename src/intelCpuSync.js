const DEFAULT_INTERVAL_MS = 5 * 60 * 1_000;
const DEFAULT_BATCH_LIMIT = 4;

export function startIntelCpuSync(
  dataset,
  {
    intervalMs = DEFAULT_INTERVAL_MS,
    limit = DEFAULT_BATCH_LIMIT,
    logger = console,
    setTimer = setInterval,
    clearTimer = clearInterval
  } = {}
) {
  let syncing = false;
  const run = async () => {
    if (syncing) {
      return;
    }

    syncing = true;

    try {
      const result = await dataset.syncNew({ limit });
      logger.info?.(
        `Intel CPU sync checked ${result.count} cached products and added ${result.addedCount}.`
      );
    } catch (error) {
      logger.warn?.(`Intel CPU sync failed: ${error.message}`);
    } finally {
      syncing = false;
    }
  };
  const timer = setTimer(run, intervalMs);

  timer.unref?.();

  return {
    run,
    stop() {
      clearTimer(timer);
    }
  };
}
