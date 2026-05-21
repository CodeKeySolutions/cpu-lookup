import * as cheerio from "cheerio";

const INTEL_ORIGIN = "https://www.intel.com";
const DEFAULT_ARK_URL = `${INTEL_ORIGIN}/content/www/us/en/ark.html`;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_CACHE_TTL_MS = 6 * 60 * 60 * 1_000;
const DEFAULT_SERIES_PAGE_LIMIT = 500;
const DEFAULT_DETAIL_CONCURRENCY = 6;

export class IntelSourceError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = "IntelSourceError";
    this.cause = cause;
  }
}

export class IntelArkCollector {
  constructor({
    fetchImpl = globalThis.fetch,
    arkUrl = DEFAULT_ARK_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    seriesPageLimit = DEFAULT_SERIES_PAGE_LIMIT,
    detailConcurrency = DEFAULT_DETAIL_CONCURRENCY,
    now = () => Date.now()
  } = {}) {
    if (!fetchImpl) {
      throw new Error("A fetch implementation is required.");
    }

    this.fetchImpl = fetchImpl;
    this.arkUrl = arkUrl;
    this.timeoutMs = timeoutMs;
    this.cacheTtlMs = cacheTtlMs;
    this.seriesPageLimit = seriesPageLimit;
    this.detailConcurrency = detailConcurrency;
    this.now = now;
    this.cache = null;
  }

  async collect({ refresh = false, limit } = {}) {
    const cappedLimit = normalizeLimit(limit);
    const canUseCache =
      !refresh &&
      !cappedLimit &&
      this.cache &&
      this.cache.expiresAt > this.now();

    if (canUseCache) {
      return {
        ...this.cache.result,
        cache: "hit"
      };
    }

    const rootHtml = await this.fetchHtml(this.arkUrl);
    const seriesUrls = await this.findProcessorSeries(rootHtml);
    const skuRefs = await this.findSkuRefs(seriesUrls);
    const requestedSkuRefs = cappedLimit ? skuRefs.slice(0, cappedLimit) : skuRefs;

    if (requestedSkuRefs.length === 0) {
      throw new IntelSourceError(
        "Intel ARK did not expose any CPU SKU pages from its processor series."
      );
    }

    const products = await mapWithConcurrency(
      requestedSkuRefs,
      this.detailConcurrency,
      async (skuRef) => {
        const html = await this.fetchHtml(skuRef.url);
        return parseSkuPage(html, skuRef);
      }
    );

    const result = {
      source: "Intel Product Specifications (ARK)",
      sourceUrl: this.arkUrl,
      collectedAt: new Date(this.now()).toISOString(),
      count: products.length,
      discoveredCount: skuRefs.length,
      products: products.sort((a, b) => a.name.localeCompare(b.name)),
      cache: "miss"
    };

    if (!cappedLimit) {
      this.cache = {
        expiresAt: this.now() + this.cacheTtlMs,
        result
      };
    }

    return result;
  }

  async collectNew({ knownProducts = [], limit = 4 } = {}) {
    const cappedLimit = normalizeLimit(limit) ?? 4;
    const rootHtml = await this.fetchHtml(this.arkUrl);
    const seriesUrls = await this.findProcessorSeries(rootHtml);
    const skuRefs = await this.findSkuRefs(seriesUrls);
    const knownKeys = new Set(knownProducts.flatMap(productKeys));
    const newSkuRefs = skuRefs
      .filter((skuRef) => !productKeys(skuRef).some((key) => knownKeys.has(key)))
      .slice(0, cappedLimit);
    const products = await mapWithConcurrency(
      newSkuRefs,
      this.detailConcurrency,
      async (skuRef) => {
        const html = await this.fetchHtml(skuRef.url);
        return parseSkuPage(html, skuRef);
      }
    );

    return {
      source: "Intel Product Specifications (ARK)",
      sourceUrl: this.arkUrl,
      collectedAt: new Date(this.now()).toISOString(),
      count: products.length,
      discoveredCount: skuRefs.length,
      products: products.sort((a, b) => a.name.localeCompare(b.name)),
      cache: "miss",
      partial: true
    };
  }

  async findProcessorSeries(rootHtml) {
    const $ = cheerio.load(rootHtml);
    const links = extractSeriesLinks($, this.arkUrl);
    const directProcessorSeries = links.filter((link) =>
      processorText(link.name)
    );

    // ARK has occasionally rendered its top-level selector with names in
    // embedded markup instead of link text. Keep series links in that case.
    const series = directProcessorSeries.length > 0 ? directProcessorSeries : links;

    if (series.length === 0) {
      throw new IntelSourceError(
        "Intel ARK root page did not contain processor series links."
      );
    }

    return uniqueByUrl(series);
  }

  async findSkuRefs(seedSeries) {
    const queue = [...seedSeries];
    const visitedSeries = new Set();
    const skuRefs = new Map();

    while (queue.length > 0 && visitedSeries.size < this.seriesPageLimit) {
      const series = queue.shift();

      if (visitedSeries.has(series.url)) {
        continue;
      }

      visitedSeries.add(series.url);
      const html = await this.fetchHtml(series.url);
      const $ = cheerio.load(html);

      for (const skuRef of extractSkuLinks($, series)) {
        skuRefs.set(skuRef.url, skuRef);
      }

      for (const childSeries of extractSeriesLinks($, series.url)) {
        if (!visitedSeries.has(childSeries.url)) {
          queue.push({
            ...childSeries,
            family: series.family ?? series.name
          });
        }
      }
    }

    return [...skuRefs.values()];
  }

  async fetchHtml(url) {
    const signal = AbortSignal.timeout(this.timeoutMs);
    let response;

    try {
      response = await this.fetchImpl(url, {
        headers: {
          accept: "text/html,application/xhtml+xml",
          "accept-language": "en-US,en;q=0.9",
          "user-agent":
            "Mozilla/5.0 (compatible; IntelCpuSpecsApi/1.0; +https://intel.com)"
        },
        signal
      });
    } catch (error) {
      throw new IntelSourceError(`Could not fetch Intel page ${url}.`, error);
    }

    if (!response.ok) {
      throw new IntelSourceError(
        `Intel page ${url} returned HTTP ${response.status}.`
      );
    }

    const html = await response.text();

    if (/access denied/i.test(html) && /edgesuite|permission/i.test(html)) {
      throw new IntelSourceError(`Intel blocked the fetch for ${url}.`);
    }

    return html;
  }
}

export function parseSkuPage(html, skuRef) {
  const $ = cheerio.load(html);
  const sections = {};

  $(".tech-section").each((_, sectionNode) => {
    const section = $(sectionNode);
    const sectionName = cleanText(
      section.find("h2, h3, h4").first().text() || "Specifications"
    );
    const rows = readSpecRows($, section);

    if (Object.keys(rows).length > 0) {
      sections[sectionName] = rows;
    }
  });

  if (Object.keys(sections).length === 0) {
    const fallbackRows = readSpecRows($, $("body"));

    if (Object.keys(fallbackRows).length > 0) {
      sections.Specifications = fallbackRows;
    }
  }

  return {
    id: skuIdFromUrl(skuRef.url),
    name: cleanText($("h1").first().text()) || skuRef.name,
    family: skuRef.family,
    url: skuRef.url,
    specs: sections
  };
}

function extractSeriesLinks($, baseUrl) {
  return $("a[href]")
    .map((_, node) => {
      const url = canonicalIntelUrl($(node).attr("href"), baseUrl);

      if (!url || !/\/ark\/products\/series\/\d+\//.test(url)) {
        return null;
      }

      const name = cleanText($(node).text());
      return {
        name: name || seriesNameFromUrl(url),
        family: name || seriesNameFromUrl(url),
        url
      };
    })
    .get()
    .filter(Boolean);
}

function extractSkuLinks($, series) {
  return $("a[href]")
    .map((_, node) => {
      const url = canonicalIntelUrl($(node).attr("href"), series.url);

      if (!url || !/\/products\/sku\/\d+\//.test(url)) {
        return null;
      }

      const name = cleanText($(node).text()) || skuNameFromUrl(url);
      const specsUrl = url.endsWith("/specifications.html")
        ? url
        : url.replace(/\.html$/, "/specifications.html");

      return {
        name,
        family: series.family ?? series.name,
        url: specsUrl
      };
    })
    .get()
    .filter(Boolean);
}

function readSpecRows($, scope) {
  const rows = {};

  scope.find(".tech-section-row").each((_, rowNode) => {
    const row = $(rowNode);
    addRow(
      rows,
      row.find(".tech-label").first().text(),
      row.find(".tech-data").first().text()
    );
  });

  scope.find("tr").each((_, rowNode) => {
    const cells = $(rowNode).find("th, td");

    if (cells.length >= 2) {
      addRow(rows, $(cells[0]).text(), $(cells[1]).text());
    }
  });

  return rows;
}

function addRow(rows, label, value) {
  const key = cleanText(label);
  const specValue = cleanText(value);

  if (key && specValue && !rows[key]) {
    rows[key] = specValue;
  }
}

function canonicalIntelUrl(href, baseUrl) {
  if (!href || href.startsWith("#") || href.startsWith("javascript:")) {
    return null;
  }

  let url;

  try {
    url = new URL(href, baseUrl);
  } catch {
    return null;
  }

  if (url.origin !== INTEL_ORIGIN) {
    return null;
  }

  url.search = "";
  url.hash = "";
  return url.toString();
}

function uniqueByUrl(items) {
  return [...new Map(items.map((item) => [item.url, item])).values()];
}

function productKeys(product) {
  return [product.id || skuIdFromUrl(product.url), product.url].filter(Boolean);
}

function processorText(text) {
  return /processor|xeon|atom|pentium|celeron|core/i.test(text);
}

function normalizeLimit(limit) {
  if (limit === undefined || limit === null || limit === "") {
    return undefined;
  }

  const number = Number.parseInt(limit, 10);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function skuIdFromUrl(url) {
  return url.match(/\/sku\/(\d+)\//)?.[1] ?? null;
}

function seriesNameFromUrl(url) {
  return cleanSlug(url.match(/\/series\/\d+\/([^/]+)\.html/)?.[1]);
}

function skuNameFromUrl(url) {
  return cleanSlug(url.match(/\/sku\/\d+\/([^/]+?)(?:\/|\.html)/)?.[1]);
}

function cleanSlug(slug = "") {
  return slug.replaceAll("-", " ");
}

function cleanText(value = "") {
  return value.replace(/\s+/g, " ").trim();
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(Math.max(concurrency, 1), items.length) },
      worker
    )
  );

  return results;
}
