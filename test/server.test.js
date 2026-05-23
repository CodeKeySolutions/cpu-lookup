import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { IntelSourceError } from "../src/intelArkCollector.js";
import { createServer } from "../src/server.js";

let baseUrl;
let server;
let amdOptions;
let rapidApiHost;
let rapidApiProxySecret;

before(async () => {
  rapidApiHost = process.env.RAPIDAPI_HOST;
  rapidApiProxySecret = process.env.RAPIDAPI_PROXY_SECRET;
  delete process.env.RAPIDAPI_HOST;
  delete process.env.RAPIDAPI_PROXY_SECRET;

  server = createServer(
    {
      async get({ limit, refresh }) {
        if (refresh) {
          throw new IntelSourceError("Intel rate limited the crawl.");
        }

        return {
          source: "Intel Product Specifications (ARK)",
          count: Number(limit) || 2,
          products: [{ id: "intel-1" }]
        };
      }
    },
    {
      async get(options) {
        amdOptions = options;
        return {
          source: "AMD Processor Specifications",
          count: Number(options.limit) || 3,
          products: [{ id: "amd-1" }]
        };
      }
    }
  );

  await new Promise((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );

  if (rapidApiProxySecret === undefined) {
    delete process.env.RAPIDAPI_PROXY_SECRET;
  } else {
    process.env.RAPIDAPI_PROXY_SECRET = rapidApiProxySecret;
  }

  if (rapidApiHost === undefined) {
    delete process.env.RAPIDAPI_HOST;
  } else {
    process.env.RAPIDAPI_HOST = rapidApiHost;
  }
});

test("GET /health returns service health", async () => {
  const response = await fetch(`${baseUrl}/health`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test("GET /api/intel/cpus passes collection options", async () => {
  const response = await fetch(`${baseUrl}/api/intel/cpus?limit=1`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, [{ id: "intel-1" }]);
});

test("GET /api/intel/cpus reports Intel source failures", async () => {
  const response = await fetch(`${baseUrl}/api/intel/cpus?refresh=true`);
  const body = await response.json();

  assert.equal(response.status, 502);
  assert.equal(body.error, "intel_source_unavailable");
});

test("GET /api/intel/cpus rejects direct calls when RapidAPI verification is enabled", async () => {
  process.env.RAPIDAPI_PROXY_SECRET = "provider-secret";

  try {
    const response = await fetch(`${baseUrl}/api/intel/cpus?limit=1`);
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, "rapidapi_unauthorized");
  } finally {
    delete process.env.RAPIDAPI_PROXY_SECRET;
  }
});

test("GET /api/intel/cpus rejects the wrong RapidAPI proxy secret", async () => {
  process.env.RAPIDAPI_PROXY_SECRET = "provider-secret";

  try {
    const response = await fetch(`${baseUrl}/api/intel/cpus?limit=1`, {
      headers: {
        "X-RapidAPI-Proxy-Secret": "wrong-secret"
      }
    });
    const body = await response.json();

    assert.equal(response.status, 401);
    assert.equal(body.error, "rapidapi_unauthorized");
  } finally {
    delete process.env.RAPIDAPI_PROXY_SECRET;
  }
});

test("GET /api/intel/cpus accepts RapidAPI proxy headers when verification is enabled", async () => {
  process.env.RAPIDAPI_PROXY_SECRET = "provider-secret";

  try {
    const response = await fetch(`${baseUrl}/api/intel/cpus?limit=1`, {
      headers: {
        "X-RapidAPI-Proxy-Secret": "provider-secret"
      }
    });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body, [{ id: "intel-1" }]);
  } finally {
    delete process.env.RAPIDAPI_PROXY_SECRET;
  }
});

test("GET /api/intel/cpus checks the configured RapidAPI host", async () => {
  process.env.RAPIDAPI_PROXY_SECRET = "provider-secret";
  process.env.RAPIDAPI_HOST = "cpu-lookup.p.rapidapi.com";

  try {
    const wrongHost = await fetch(`${baseUrl}/api/intel/cpus?limit=1`, {
      headers: {
        "X-RapidAPI-Proxy-Secret": "provider-secret",
        "X-RapidAPI-Host": "other-api.p.rapidapi.com"
      }
    });
    const correctHost = await fetch(`${baseUrl}/api/intel/cpus?limit=1`, {
      headers: {
        "X-RapidAPI-Proxy-Secret": "provider-secret",
        "X-RapidAPI-Host": "cpu-lookup.p.rapidapi.com"
      }
    });

    assert.equal(wrongHost.status, 401);
    assert.equal((await wrongHost.json()).error, "rapidapi_unauthorized");
    assert.equal(correctHost.status, 200);
    assert.deepEqual(await correctHost.json(), [{ id: "intel-1" }]);
  } finally {
    delete process.env.RAPIDAPI_HOST;
    delete process.env.RAPIDAPI_PROXY_SECRET;
  }
});

test("GET /api/amd/cpus passes collection options", async () => {
  const response = await fetch(
    `${baseUrl}/api/amd/cpus?limit=1&socket=AM5&chipset=X870&columns=id,name&server=false&ecc=true&ram=DDR5&cores=16&threads=32&speed=5.7`
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, [{ id: "amd-1" }]);
  assert.deepEqual(amdOptions, {
    chipset: "X870",
    columns: "id,name",
    cores: "16",
    ecc: "true",
    ram: "DDR5",
    refresh: false,
    limit: "1",
    server: "false",
    socket: "AM5",
    speed: "5.7",
    threads: "32"
  });
});

test("GET /api/amd/cpus accepts column as a columns alias", async () => {
  const response = await fetch(`${baseUrl}/api/amd/cpus?column=id,name`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, [{ id: "amd-1" }]);
  assert.equal(amdOptions.columns, "id,name");
});
