import assert from "node:assert/strict";
import { test } from "node:test";
import { createR2JsonStore } from "../src/r2JsonStore.js";

test("R2 JSON store reads and writes JSON snapshot objects", async () => {
  let put;
  const store = createR2JsonStore({
    async get(key) {
      assert.equal(key, "cpus/intel.json");
      return {
        async json() {
          return { count: 1 };
        }
      };
    },
    async put(key, body, options) {
      put = { key, body, options };
    }
  });

  assert.deepEqual(await store.readJson("cpus/intel.json"), { count: 1 });

  await store.writeJson("cpus/intel.json", { products: [] });

  assert.equal(put.key, "cpus/intel.json");
  assert.equal(put.body, '{\n  "products": []\n}\n');
  assert.equal(put.options.httpMetadata.contentType, "application/json");
});

test("R2 JSON store exposes missing objects as ENOENT", async () => {
  const store = createR2JsonStore({
    async get() {
      return null;
    },
    async put() {}
  });

  await assert.rejects(store.readJson("cpus/amd.json"), {
    code: "ENOENT"
  });
});
