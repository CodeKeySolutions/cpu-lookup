import assert from "node:assert/strict";
import { test } from "node:test";
import { startIntelCpuSync } from "../src/intelCpuSync.js";

test("Intel sync schedules its configured batch size", async () => {
  let scheduled;
  let stopped;
  const calls = [];
  const sync = startIntelCpuSync(
    {
      async syncNew(options) {
        calls.push(options);
        return { addedCount: 1, count: 3 };
      }
    },
    {
      intervalMs: 300_000,
      limit: 4,
      logger: {},
      setTimer(callback, intervalMs) {
        scheduled = { callback, intervalMs };
        return {};
      },
      clearTimer(timer) {
        stopped = timer;
      }
    }
  );

  await scheduled.callback();
  sync.stop();

  assert.equal(scheduled.intervalMs, 300_000);
  assert.deepEqual(calls, [{ limit: 4 }]);
  assert.deepEqual(stopped, {});
});

test("Intel sync does not overlap slow checks", async () => {
  let scheduled;
  let release;
  let callCount = 0;
  startIntelCpuSync(
    {
      async syncNew() {
        callCount += 1;
        await new Promise((resolve) => {
          release = resolve;
        });
        return { addedCount: 0, count: 1 };
      }
    },
    {
      logger: {},
      setTimer(callback) {
        scheduled = callback;
        return {};
      }
    }
  );

  const first = scheduled();
  await scheduled();
  release();
  await first;

  assert.equal(callCount, 1);
});
