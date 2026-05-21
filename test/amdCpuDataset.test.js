import assert from "node:assert/strict";
import { test } from "node:test";
import { AmdCpuDataset } from "../src/amdCpuDataset.js";

test("AMD dataset reads saved snapshots before collecting", async () => {
  const saved = dataset();
  const cache = new AmdCpuDataset({
    collector: {
      async collect() {
        throw new Error("The saved AMD dataset should be served.");
      }
    },
    readJson: async () => saved,
    writeJson: async () => {
      throw new Error("The saved AMD dataset should not be written.");
    }
  });

  const result = await cache.get({ limit: 1 });

  assert.equal(result.cache, "dataset");
  assert.equal(result.count, 1);
});

test("AMD dataset ignores malformed snapshots", async () => {
  const cache = new AmdCpuDataset({
    collector: {
      async collect(options) {
        return {
          ...dataset(),
          count: options.limit,
          cache: "miss"
        };
      }
    },
    readJson: async () => ({}),
    writeJson: async (_path, value) => {
      assert.equal(value.partial, true);
    }
  });

  const result = await cache.get({ limit: 1 });

  assert.equal(result.cache, "partial");
  assert.equal(result.count, 1);
});

test("AMD full cache misses write a dataset snapshot", async () => {
  let written;
  const cache = new AmdCpuDataset({
    collector: {
      async collect() {
        return {
          ...dataset(),
          cache: "miss"
        };
      }
    },
    readJson: async () => {
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    },
    writeJson: async (_path, value) => {
      written = value;
    }
  });

  const result = await cache.get();

  assert.equal(result.cache, "refresh");
  assert.equal(written.count, 2);
  assert.equal(written.cache, undefined);
});

test("AMD full reads use partial snapshots before collecting", async () => {
  let collected = false;
  const cache = new AmdCpuDataset({
    collector: {
      async collect() {
        collected = true;
        return dataset();
      }
    },
    readJson: async () => ({
      ...dataset(),
      count: 1,
      partial: true,
      products: dataset().products.slice(0, 1)
    }),
    writeJson: async () => {
      throw new Error("A saved AMD partial snapshot should not be replaced.");
    }
  });

  const result = await cache.get();

  assert.equal(collected, false);
  assert.equal(result.cache, "dataset");
});

function dataset() {
  return {
    source: "AMD Processor Specifications",
    sourceUrls: ["https://www.amd.com/en/products/specifications/processors.html"],
    collectedAt: "2026-05-21T12:00:00.000Z",
    count: 2,
    products: [
      { id: "amd-ryzen-9-9950x", name: "AMD Ryzen 9 9950X", specs: {} },
      { id: "amd-ryzen-5-9600x", name: "AMD Ryzen 5 9600X", specs: {} }
    ]
  };
}
