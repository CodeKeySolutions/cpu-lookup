import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { IntelSourceError } from "../src/intelArkCollector.js";
import { createServer } from "../src/server.js";

let baseUrl;
let server;
let amdOptions;
let rapidApiProxySecret;

before(async () => {
  rapidApiProxySecret = process.env.RAPIDAPI_PROXY_SECRET;
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
          products: []
        };
      }
    },
    {
      async get(options) {
        amdOptions = options;
        return {
          source: "AMD Processor Specifications",
          count: Number(options.limit) || 3,
          products: []
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
  assert.equal(body.count, 1);
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
    assert.equal(body.count, 1);
  } finally {
    delete process.env.RAPIDAPI_PROXY_SECRET;
  }
});

test("GET /api/amd/cpus passes collection options", async () => {
  const response = await fetch(
    `${baseUrl}/api/amd/cpus?limit=1&socket=AM5&chipset=X870&server=false&ecc=true&ram=DDR5&cores=16&threads=32&speed=5.7`
  );
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.count, 1);
  assert.deepEqual(amdOptions, {
    chipset: "X870",
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
