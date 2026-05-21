import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { selectCpuDataset } from "./cpuDatasetFilters.js";

export const DEFAULT_DATASET_PATH = "./data/cpus/intel.json";

export class IntelCpuDataset {
  constructor({
    collector,
    datasetPath = process.env.INTEL_CPU_DATASET_PATH ?? DEFAULT_DATASET_PATH,
    readJson = readDatasetJson,
    writeJson = writeDatasetJson
  }) {
    if (!collector) {
      throw new Error("An Intel collector is required.");
    }

    this.collector = collector;
    this.datasetPath = datasetPath;
    this.readJson = readJson;
    this.writeJson = writeJson;
  }

  async get({
    chipset,
    cores,
    ecc,
    ram,
    refresh = false,
    limit,
    server,
    socket,
    speed,
    threads
  } = {}) {
    const cappedLimit = normalizeLimit(limit);
    const filters = { chipset, cores, ecc, ram, server, socket, speed, threads };

    if (!refresh) {
      const cached = await this.read();

      if (hasProducts(cached)) {
        return markDatasetCache(
          selectCpuDataset(cached, { ...filters, limit: cappedLimit }),
          "dataset"
        );
      }
    }

    if (cappedLimit) {
      const dataset = await this.collector.collect({
        refresh,
        limit: cappedLimit
      });

      const partialDataset = markPartial(dataset);
      await this.write(partialDataset);
      return markDatasetCache(
        selectCpuDataset(partialDataset, { ...filters, limit: cappedLimit }),
        "partial"
      );
    }

    const dataset = await this.collector.collect({ refresh: true });
    await this.write(dataset);
    return markDatasetCache(selectCpuDataset(dataset, filters), "refresh");
  }

  async read() {
    try {
      return await this.readJson(this.datasetPath);
    } catch (error) {
      if (error.code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  async write(dataset) {
    await this.writeJson(this.datasetPath, stripCacheState(dataset));
  }

  async syncNew({ limit = 4 } = {}) {
    const cached = await this.read();
    const existing = hasProducts(cached) ? cached : emptyDataset();
    const newDataset = await this.collector.collectNew({
      knownProducts: existing.products,
      limit
    });
    const existingKeys = new Set(existing.products.map(productKey));
    const newProducts = newDataset.products.filter(
      (product) => !existingKeys.has(productKey(product))
    );
    const mergedProducts = mergeProducts(existing.products, newProducts);
    const nextDataset = {
      ...existing,
      source: newDataset.source ?? existing.source,
      sourceUrl: newDataset.sourceUrl ?? existing.sourceUrl,
      collectedAt: existing.collectedAt ?? newDataset.collectedAt,
      lastCheckedAt: newDataset.collectedAt,
      count: mergedProducts.length,
      discoveredCount: Math.max(
        existing.discoveredCount ?? 0,
        newDataset.discoveredCount ?? 0
      ),
      products: mergedProducts,
      partial: existing.partial ?? true
    };

    await this.write(nextDataset);

    return {
      checkedAt: nextDataset.lastCheckedAt,
      addedCount: newProducts.length,
      count: nextDataset.count,
      dataset: markDatasetCache(nextDataset, "sync")
    };
  }
}

async function readDatasetJson(datasetPath) {
  return JSON.parse(await readFile(datasetPath, "utf8"));
}

async function writeDatasetJson(datasetPath, dataset) {
  await mkdir(dirname(datasetPath), { recursive: true });

  const tempPath = `${datasetPath}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(dataset, null, 2)}\n`, "utf8");
  await rename(tempPath, datasetPath);
}

function markDatasetCache(dataset, cache) {
  return {
    ...dataset,
    cache
  };
}

function stripCacheState(dataset) {
  const { cache, ...snapshot } = dataset;
  return snapshot;
}

function hasProducts(dataset) {
  return Boolean(dataset && Array.isArray(dataset.products));
}

function markPartial(dataset) {
  return {
    ...dataset,
    partial: true
  };
}

function emptyDataset() {
  return {
    count: 0,
    products: [],
    partial: true
  };
}

function mergeProducts(existingProducts, newProducts) {
  const products = new Map();

  for (const product of [...existingProducts, ...newProducts]) {
    products.set(productKey(product), product);
  }

  return [...products.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function productKey(product) {
  return product.id || product.url || product.name;
}

function normalizeLimit(limit) {
  if (limit === undefined || limit === null || limit === "") {
    return undefined;
  }

  const number = Number.parseInt(limit, 10);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}
