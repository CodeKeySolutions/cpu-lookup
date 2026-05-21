import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkerServices,
  fetchCpuApi,
  syncIntelFromSchedule
} from "../src/worker.js";

test("Worker API returns filtered CPU datasets", async () => {
  let options;
  const response = await fetchCpuApi(
    new Request(
      "https://cpu.example/api/intel/cpus?limit=1&cores=8&ram=DDR5&server=false"
    ),
    {
      intelDataset: {
        async get(value) {
          options = value;
          return { count: 1, products: [] };
        }
      }
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { count: 1, products: [] });
  assert.deepEqual(options, {
    chipset: null,
    cores: "8",
    ecc: null,
    ram: "DDR5",
    refresh: false,
    limit: "1",
    server: "false",
    socket: null,
    speed: null,
    threads: null
  });
});

test("Worker services read cached Intel rows from R2", async () => {
  const services = createWorkerServices({
    CPU_DATA: {
      async get(key) {
        assert.equal(key, "cpus/intel.json");
        return {
          async json() {
            return {
              count: 1,
              products: [
                {
                  id: "intel-1",
                  specs: {
                    "CPU Specifications": {
                      "Total Cores": "8"
                    }
                  }
                }
              ]
            };
          }
        };
      },
      async put() {
        throw new Error("A cached Worker read should not write R2.");
      }
    }
  });

  const result = await services.intelDataset.get({ cores: "8", limit: 1 });

  assert.equal(result.cache, "dataset");
  assert.equal(result.products[0].id, "intel-1");
});

test("Worker scheduled sync uses Cloudflare Intel sync limit", async () => {
  let options;

  const result = await syncIntelFromSchedule(
    { INTEL_SYNC_LIMIT: "4" },
    {
      intelDataset: {
        async syncNew(value) {
          options = value;
          return { addedCount: 2 };
        }
      }
    }
  );

  assert.deepEqual(options, { limit: 4 });
  assert.deepEqual(result, { addedCount: 2 });
});
