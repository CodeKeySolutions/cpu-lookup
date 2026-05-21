import assert from "node:assert/strict";
import { test } from "node:test";
import { IntelCpuDataset } from "../src/intelCpuDataset.js";

test("dataset serves its saved snapshot without collecting from Intel", async () => {
  let collectCount = 0;
  const saved = dataset("2026-05-20T12:00:00.000Z");
  const cache = new IntelCpuDataset({
    collector: {
      async collect() {
        collectCount += 1;
        return dataset("2026-05-21T12:00:00.000Z");
      }
    },
    readJson: async () => saved,
    writeJson: async () => {
      throw new Error("The saved snapshot should not be replaced.");
    }
  });

  const result = await cache.get();

  assert.equal(result.collectedAt, saved.collectedAt);
  assert.equal(result.cache, "dataset");
  assert.equal(collectCount, 0);
});

test("limited reads use the saved snapshot when it exists", async () => {
  const saved = {
    ...dataset("2026-05-20T12:00:00.000Z"),
    count: 2,
    products: [
      { id: "1", name: "CPU 1", specs: {} },
      { id: "2", name: "CPU 2", specs: {} }
    ]
  };
  const cache = new IntelCpuDataset({
    collector: {
      async collect() {
        throw new Error("A saved snapshot should satisfy this read.");
      }
    },
    readJson: async () => saved,
    writeJson: async () => {
      throw new Error("A saved snapshot should not be replaced.");
    }
  });

  const result = await cache.get({ limit: "1" });

  assert.equal(result.cache, "dataset");
  assert.equal(result.count, 1);
  assert.deepEqual(result.products.map((product) => product.id), ["1"]);
});

test("dataset ignores malformed snapshots", async () => {
  const cache = new IntelCpuDataset({
    collector: {
      async collect(options) {
        return {
          ...dataset("2026-05-21T12:00:00.000Z"),
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

  const result = await cache.get({ limit: "1" });

  assert.equal(result.cache, "partial");
  assert.equal(result.count, 1);
});

test("full cache misses write a dataset snapshot", async () => {
  let written;
  const cache = new IntelCpuDataset({
    collector: {
      async collect() {
        return {
          ...dataset("2026-05-21T12:00:00.000Z"),
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
  assert.equal(written.count, 1);
  assert.equal(written.cache, undefined);
});

test("dataset refresh collects and writes a full snapshot", async () => {
  const collected = dataset("2026-05-21T12:00:00.000Z");
  const calls = [];
  let written;
  const cache = new IntelCpuDataset({
    collector: {
      async collect(options) {
        calls.push(options);
        return {
          ...collected,
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

  const result = await cache.get({ refresh: true });

  assert.deepEqual(calls, [{ refresh: true }]);
  assert.equal(result.cache, "refresh");
  assert.equal(written.cache, undefined);
  assert.equal(written.collectedAt, collected.collectedAt);
});

test("limited cache misses write a partial dataset", async () => {
  const calls = [];
  let written;
  const cache = new IntelCpuDataset({
    collector: {
      async collect(options) {
        calls.push(options);
        return {
          ...dataset("2026-05-21T12:00:00.000Z"),
          count: options.limit
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

  const result = await cache.get({ limit: "2" });

  assert.deepEqual(calls, [{ refresh: false, limit: 2 }]);
  assert.equal(result.cache, "partial");
  assert.equal(result.count, 1);
  assert.equal(written.partial, true);
});

test("full reads use partial snapshots before collecting", async () => {
  let collected = false;
  const cache = new IntelCpuDataset({
    collector: {
      async collect() {
        collected = true;
        return dataset("2026-05-21T12:00:00.000Z");
      }
    },
    readJson: async () => ({
      ...dataset("2026-05-20T12:00:00.000Z"),
      partial: true
    }),
    writeJson: async () => {
      throw new Error("A saved partial snapshot should not be replaced.");
    }
  });

  const result = await cache.get();

  assert.equal(collected, false);
  assert.equal(result.cache, "dataset");
});

test("incremental sync merges only new Intel products into the snapshot", async () => {
  let written;
  const saved = dataset("2026-05-20T12:00:00.000Z");
  const cache = new IntelCpuDataset({
    collector: {
      async collectNew({ knownProducts, limit }) {
        assert.deepEqual(knownProducts.map((product) => product.id), ["1"]);
        assert.equal(limit, 4);
        return {
          ...dataset("2026-05-21T12:00:00.000Z"),
          count: 2,
          discoveredCount: 5,
          products: [
            { id: "1", name: "CPU", specs: {} },
            { id: "2", name: "CPU 2", specs: {} }
          ]
        };
      }
    },
    readJson: async () => saved,
    writeJson: async (_path, value) => {
      written = value;
    }
  });

  const result = await cache.syncNew();

  assert.equal(result.addedCount, 1);
  assert.equal(result.count, 2);
  assert.deepEqual(written.products.map((product) => product.id), ["1", "2"]);
  assert.equal(written.discoveredCount, 5);
  assert.equal(written.lastCheckedAt, "2026-05-21T12:00:00.000Z");
});

function dataset(collectedAt) {
  return {
    source: "Intel Product Specifications (ARK)",
    sourceUrl: "https://www.intel.com/content/www/us/en/ark.html",
    collectedAt,
    count: 1,
    discoveredCount: 1,
    products: [{ id: "1", name: "CPU", specs: {} }]
  };
}
