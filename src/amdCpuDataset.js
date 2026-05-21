import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { selectCpuDataset } from "./cpuDatasetFilters.js";

export const DEFAULT_AMD_DATASET_PATH = "./data/cpus/amd.json";

export class AmdCpuDataset {
  constructor({
    collector,
    datasetPath = process.env.AMD_CPU_DATASET_PATH ?? DEFAULT_AMD_DATASET_PATH,
    readJson = readDatasetJson,
    writeJson = writeDatasetJson
  }) {
    if (!collector) {
      throw new Error("An AMD collector is required.");
    }

    this.collector = collector;
    this.datasetPath = datasetPath;
    this.readJson = readJson;
    this.writeJson = writeJson;
  }

  async get({
    chipset,
    columns,
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
    const filters = {
      chipset,
      columns,
      cores,
      ecc,
      ram,
      server,
      socket,
      speed,
      threads
    };

    if (!refresh) {
      const cached = await this.read();

      if (hasProducts(cached)) {
        return withCache(
          selectCpuDataset(cached, { ...filters, limit: cappedLimit }),
          "dataset"
        );
      }
    }

    if (cappedLimit) {
      const dataset = await this.collector.collect({ limit: cappedLimit });

      const partialDataset = markPartial(dataset);
      await this.write(partialDataset);
      return withCache(
        selectCpuDataset(partialDataset, { ...filters, limit: cappedLimit }),
        "partial"
      );
    }

    const dataset = await this.collector.collect();
    await this.write(dataset);
    return withCache(selectCpuDataset(dataset, filters), "refresh");
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
    await this.writeJson(this.datasetPath, stripCache(dataset));
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

function withCache(dataset, cache) {
  return {
    ...dataset,
    cache
  };
}

function stripCache(dataset) {
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

function normalizeLimit(limit) {
  if (limit === undefined || limit === null || limit === "") {
    return undefined;
  }

  const number = Number.parseInt(limit, 10);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}
