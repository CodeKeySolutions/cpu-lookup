import * as cheerio from "cheerio";

const AMD_ORIGIN = "https://www.amd.com";
const DEFAULT_SOURCE_PAGES = [
  {
    family: "AMD Desktop, Laptop, and Workstation Processors",
    url: `${AMD_ORIGIN}/en/products/specifications/processors.html`
  },
  {
    family: "AMD Server Processors",
    url: `${AMD_ORIGIN}/en/products/specifications/server-processor.html`
  },
  {
    family: "AMD Embedded Processors",
    url: `${AMD_ORIGIN}/en/products/specifications/embedded.html`
  }
];
const DEFAULT_TIMEOUT_MS = 20_000;
const DEFAULT_REQUEST_INTERVAL_MS = 1_000;
const DEFAULT_MAX_RETRIES = 2;

export class AmdSourceError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "AmdSourceError";
    this.cause = cause;
  }
}

export class AmdCpuCollector {
  constructor({
    fetchImpl = globalThis.fetch,
    sourcePages = DEFAULT_SOURCE_PAGES,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    requestIntervalMs = DEFAULT_REQUEST_INTERVAL_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    sleep = wait,
    now = () => Date.now()
  } = {}) {
    if (!fetchImpl) {
      throw new Error("A fetch implementation is required.");
    }

    this.fetchImpl = fetchImpl;
    this.sourcePages = sourcePages;
    this.timeoutMs = timeoutMs;
    this.requestIntervalMs = requestIntervalMs;
    this.maxRetries = maxRetries;
    this.sleep = sleep;
    this.now = now;
    this.nextRequestAt = 0;
  }

  async collect({ limit } = {}) {
    const cappedLimit = normalizeLimit(limit);
    const products = [];

    for (const page of this.sourcePages) {
      const html = await this.fetchHtml(page.url);
      products.push(...parseAmdSpecificationPage(html, page));

      if (cappedLimit && products.length >= cappedLimit) {
        break;
      }
    }

    const sortedProducts = uniqueByKey(products, (product) =>
      product.url ? product.url : `${product.family}:${product.name}`
    ).sort((a, b) => a.name.localeCompare(b.name));
    const uniqueProducts = cappedLimit
      ? sortedProducts.slice(0, cappedLimit)
      : sortedProducts;

    if (uniqueProducts.length === 0) {
      throw new AmdSourceError(
        "AMD specification pages did not expose any CPU model rows."
      );
    }

    return {
      source: "AMD Processor Specifications",
      sourceUrls: this.sourcePages.map((page) => page.url),
      collectedAt: new Date(this.now()).toISOString(),
      count: uniqueProducts.length,
      products: uniqueProducts,
      cache: "miss"
    };
  }

  async fetchHtml(url) {
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      await this.waitForRequestSlot();
      let response;

      try {
        response = await this.fetchImpl(url, {
          headers: {
            accept: "text/html,application/xhtml+xml",
            "accept-language": "en-US,en;q=0.9",
            "user-agent":
              "Mozilla/5.0 (compatible; CpuSpecsApi/1.0; +https://amd.com)"
          },
          signal: AbortSignal.timeout(this.timeoutMs)
        });
      } catch (error) {
        if (attempt < this.maxRetries) {
          await this.sleep(this.retryDelayMs(attempt));
          continue;
        }

        throw new AmdSourceError(`Could not fetch AMD page ${url}.`, error);
      }

      if (response.ok) {
        return response.text();
      }

      if (retryableStatus(response.status) && attempt < this.maxRetries) {
        await this.sleep(retryAfterMs(response) ?? this.retryDelayMs(attempt));
        continue;
      }

      throw new AmdSourceError(`AMD page ${url} returned HTTP ${response.status}.`);
    }

    throw new AmdSourceError(`AMD page ${url} exhausted its retries.`);
  }

  async waitForRequestSlot() {
    const delayMs = this.nextRequestAt - this.now();

    if (delayMs > 0) {
      await this.sleep(delayMs);
    }

    this.nextRequestAt = this.now() + this.requestIntervalMs;
  }

  retryDelayMs(attempt) {
    return this.requestIntervalMs * 2 ** (attempt + 1);
  }
}

export function parseAmdSpecificationPage(html, page) {
  const $ = cheerio.load(html);
  const products = [];

  $("table").each((_, tableNode) => {
    const table = $(tableNode);
    const headers = readHeaders($, table);

    if (!headers.some(isModelHeader)) {
      return;
    }

    table.find("tbody tr, tr").each((__, rowNode) => {
      const cells = $(rowNode).find("td");

      if (cells.length === 0) {
        return;
      }

      const product = productFromRow($, cells, headers, page);

      if (product) {
        products.push(product);
      }
    });
  });

  return products;
}

function productFromRow($, cells, headers, page) {
  const specs = {};
  let name = "";
  let url = "";

  cells.each((index, cellNode) => {
    const cell = $(cellNode);
    const header = headers[index] || `Column ${index + 1}`;
    const value = cleanText(cell.text());

    if (!value) {
      return;
    }

    if (isModelHeader(header) && !name) {
      name = value;
      url = canonicalAmdUrl(cell.find("a[href]").first().attr("href"), page.url);
      return;
    }

    specs[header] = value;
  });

  if (!name) {
    return null;
  }

  return {
    id: amdId(url, name),
    name,
    family: page.family,
    url: url || page.url,
    specs: {
      Specifications: specs
    }
  };
}

function readHeaders($, table) {
  const nodes = table.find("thead th");
  const headerNodes = nodes.length > 0 ? nodes : table.find("tr").first().find("th");

  return headerNodes
    .map((_, headerNode) => cleanText($(headerNode).text()))
    .get();
}

function canonicalAmdUrl(href, baseUrl) {
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
    return "";
  }

  let url;

  try {
    url = new URL(href, baseUrl);
  } catch {
    return "";
  }

  if (url.origin !== AMD_ORIGIN) {
    return "";
  }

  url.search = "";
  url.hash = "";
  return url.toString();
}

function amdId(url, name) {
  const pathSlug = url.match(/\/([^/]+)\.html$/)?.[1];
  return pathSlug || name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function isModelHeader(header) {
  return /^name$/i.test(header) || /model|product name|processor name/i.test(header);
}

function retryableStatus(status) {
  return status === 429 || status === 503 || status === 504;
}

function retryAfterMs(response) {
  const seconds = Number.parseFloat(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

function normalizeLimit(limit) {
  if (limit === undefined || limit === null || limit === "") {
    return undefined;
  }

  const number = Number.parseInt(limit, 10);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function uniqueByKey(items, key) {
  return [...new Map(items.map((item) => [key(item), item])).values()];
}

function cleanText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

function wait(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
