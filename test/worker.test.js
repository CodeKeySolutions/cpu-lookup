import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createWorkerServices,
  fetchCpuApi,
  syncIntelFromSchedule
} from "../src/worker.js";
import { DEFAULT_AMD_DATASET_PATH } from "../src/amdCpuDataset.js";
import { DEFAULT_DATASET_PATH } from "../src/intelCpuDataset.js";

test("dataset defaults remain Worker-safe path strings", () => {
  assert.equal(DEFAULT_DATASET_PATH, "./data/cpus/intel.json");
  assert.equal(DEFAULT_AMD_DATASET_PATH, "./data/cpus/amd.json");
});

test("Worker API returns filtered CPU datasets", async () => {
  let options;
  const response = await fetchCpuApi(
    new Request(
      "https://cpu.example/api/intel/cpus?limit=1&columns=id,name&cores=8&ram=DDR5&server=false"
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
  assert.deepEqual(await response.json(), []);
  assert.deepEqual(options, {
    chipset: null,
    columns: "id,name",
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

test("Worker API rejects direct calls when RapidAPI verification is enabled", async () => {
  const response = await fetchCpuApi(
    new Request("https://cpu.example/api/intel/cpus"),
    {
      intelDataset: {
        async get() {
          throw new Error("Unauthorized Worker calls should not reach the dataset.");
        }
      }
    },
    {
      RAPIDAPI_PROXY_SECRET: "provider-secret"
    }
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "rapidapi_unauthorized");
});

test("Worker API rejects the wrong RapidAPI proxy secret", async () => {
  const response = await fetchCpuApi(
    new Request("https://cpu.example/api/intel/cpus", {
      headers: {
        "X-RapidAPI-Proxy-Secret": "wrong-secret"
      }
    }),
    {
      intelDataset: {
        async get() {
          throw new Error("Unauthorized Worker calls should not reach the dataset.");
        }
      }
    },
    {
      RAPIDAPI_PROXY_SECRET: "provider-secret"
    }
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "rapidapi_unauthorized");
});

test("Worker API accepts RapidAPI proxy headers when verification is enabled", async () => {
  const response = await fetchCpuApi(
    new Request("https://cpu.example/api/amd/cpus?limit=1", {
      headers: {
        "X-RapidAPI-Proxy-Secret": "provider-secret"
      }
    }),
    {
      amdDataset: {
        async get() {
          return { count: 1, products: [{ id: "amd-1" }] };
        }
      }
    },
    {
      RAPIDAPI_PROXY_SECRET: "provider-secret"
    }
  );

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), [{ id: "amd-1" }]);
});

test("Worker API checks the configured RapidAPI host", async () => {
  const response = await fetchCpuApi(
    new Request("https://cpu.example/api/amd/cpus?limit=1", {
      headers: {
        "X-RapidAPI-Proxy-Secret": "provider-secret",
        "X-RapidAPI-Host": "other-api.p.rapidapi.com"
      }
    }),
    {
      amdDataset: {
        async get() {
          throw new Error("Wrong RapidAPI hosts should not reach the dataset.");
        }
      }
    },
    {
      RAPIDAPI_HOST: "cpu-lookup.p.rapidapi.com",
      RAPIDAPI_PROXY_SECRET: "provider-secret"
    }
  );

  assert.equal(response.status, 401);
  assert.equal((await response.json()).error, "rapidapi_unauthorized");
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
