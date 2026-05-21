import assert from "node:assert/strict";
import { test } from "node:test";
import { IntelArkCollector, parseSkuPage } from "../src/intelArkCollector.js";

const rootUrl = "https://www.intel.com/content/www/us/en/ark.html";
const coreSeriesUrl =
  "https://www.intel.com/content/www/us/en/ark/products/series/1/intel-core-processors.html";
const ultraSeriesUrl =
  "https://www.intel.com/content/www/us/en/ark/products/series/2/intel-core-ultra-processors.html";
const ultraChildSeriesUrl =
  "https://www.intel.com/content/www/us/en/ark/products/series/3/intel-core-ultra-series-2.html";
const coreSkuUrl =
  "https://www.intel.com/content/www/us/en/products/sku/11/intel-core-i5-processor/specifications.html";
const ultraSkuUrl =
  "https://www.intel.com/content/www/us/en/products/sku/22/intel-core-ultra-processor/specifications.html";

test("collector crawls Intel processor series and returns SKU specs", async () => {
  const collector = new IntelArkCollector({
    fetchImpl: fetchFromFixtures({
      [rootUrl]: `
        <a href="${coreSeriesUrl}">Intel Core Processors</a>
        <a href="${ultraSeriesUrl}">Intel Core Ultra Processors</a>
        <a href="/content/www/us/en/ark/products/series/99/chipsets.html">Chipsets</a>
      `,
      [coreSeriesUrl]: `
        <a href="/content/www/us/en/products/sku/11/intel-core-i5-processor.html">
          Intel Core i5 Processor
        </a>
      `,
      [ultraSeriesUrl]: `
        <a href="${ultraChildSeriesUrl}">Intel Core Ultra Series 2</a>
      `,
      [ultraChildSeriesUrl]: `
        <a href="/content/www/us/en/products/sku/22/intel-core-ultra-processor/specifications.html">
          Intel Core Ultra 9 Processor
        </a>
      `,
      [coreSkuUrl]: skuPage("Intel Core i5 Processor", "14", "65 W"),
      [ultraSkuUrl]: skuPage("Intel Core Ultra 9 Processor", "24", "125 W")
    }),
    now: () => Date.UTC(2026, 4, 21)
  });

  const result = await collector.collect();

  assert.equal(result.source, "Intel Product Specifications (ARK)");
  assert.equal(result.count, 2);
  assert.equal(result.discoveredCount, 2);
  assert.equal(result.products[0].id, "11");
  assert.equal(
    result.products[0].specs["CPU Specifications"]["Total Cores"],
    "14"
  );
  assert.equal(
    result.products[1].specs["CPU Specifications"]["Processor Base Power"],
    "125 W"
  );
});

test("collector caches full crawls but not limited crawls", async () => {
  let fetchCount = 0;
  const collector = new IntelArkCollector({
    fetchImpl: async (url) => {
      fetchCount += 1;
      return fetchFromFixtures({
        [rootUrl]: `<a href="${coreSeriesUrl}">Intel Core Processors</a>`,
        [coreSeriesUrl]: `<a href="/content/www/us/en/products/sku/11/intel-core-i5-processor.html">CPU</a>`,
        [coreSkuUrl]: skuPage("CPU", "6", "35 W")
      })(url);
    }
  });

  await collector.collect({ limit: 1 });
  await collector.collect();
  const cached = await collector.collect();

  assert.equal(cached.cache, "hit");
  assert.equal(fetchCount, 6);
});

test("collector fetches only unseen Intel SKU specs for incremental sync", async () => {
  const fetched = [];
  const collector = new IntelArkCollector({
    fetchImpl: async (url) => {
      fetched.push(url);
      return fetchFromFixtures({
        [rootUrl]: `<a href="${coreSeriesUrl}">Intel Core Processors</a>`,
        [coreSeriesUrl]: `
          <a href="/content/www/us/en/products/sku/11/intel-core-i5-processor.html">CPU 11</a>
          <a href="/content/www/us/en/products/sku/22/intel-core-ultra-processor.html">CPU 22</a>
        `,
        [ultraSkuUrl]: skuPage("Intel Core Ultra Processor", "8", "65 W")
      })(url);
    },
    now: () => Date.UTC(2026, 4, 21)
  });

  const result = await collector.collectNew({
    knownProducts: [{ id: "11", url: coreSkuUrl }],
    limit: 4
  });

  assert.equal(result.count, 1);
  assert.equal(result.products[0].id, "22");
  assert.equal(fetched.includes(coreSkuUrl), false);
  assert.equal(fetched.includes(ultraSkuUrl), true);
});

test("SKU parser keeps Intel tech sections grouped by heading", () => {
  const product = parseSkuPage(skuPage("CPU", "8", "45 W"), {
    family: "Intel Core",
    name: "CPU",
    url: coreSkuUrl
  });

  assert.deepEqual(product.specs["CPU Specifications"], {
    "Total Cores": "8",
    "Processor Base Power": "45 W"
  });
});

function fetchFromFixtures(fixtures) {
  return async (url) => {
    const html = fixtures[url];

    if (!html) {
      return new Response("missing", { status: 404 });
    }

    return new Response(html, {
      status: 200,
      headers: { "content-type": "text/html" }
    });
  };
}

function skuPage(name, cores, power) {
  return `
    <main>
      <h1>${name}</h1>
      <section class="tech-section">
        <h3>CPU Specifications</h3>
        <div class="tech-section-row">
          <div class="tech-label">Total Cores</div>
          <div class="tech-data">${cores}</div>
        </div>
        <div class="tech-section-row">
          <div class="tech-label">Processor Base Power</div>
          <div class="tech-data">${power}</div>
        </div>
      </section>
    </main>
  `;
}
