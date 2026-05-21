import { AmdCpuCollector, AmdSourceError } from "./amdCpuCollector.js";
import { AmdCpuDataset } from "./amdCpuDataset.js";
import { IntelArkCollector, IntelSourceError } from "./intelArkCollector.js";
import { IntelCpuDataset } from "./intelCpuDataset.js";
import { createR2JsonStore } from "./r2JsonStore.js";
import { checkRapidApiRequest } from "./rapidApiAuth.js";

const INTEL_DATASET_KEY = "cpus/intel.json";
const AMD_DATASET_KEY = "cpus/amd.json";

export function createWorkerServices(env) {
  const jsonStore = createR2JsonStore(env.CPU_DATA);
  const intelCollector = new IntelArkCollector();
  const amdCollector = new AmdCpuCollector({
    requestIntervalMs: envNumber(env.AMD_REQUEST_INTERVAL_MS),
    maxRetries: envNumber(env.AMD_MAX_RETRIES)
  });

  return {
    intelDataset: new IntelCpuDataset({
      collector: intelCollector,
      datasetPath: INTEL_DATASET_KEY,
      readJson: jsonStore.readJson,
      writeJson: jsonStore.writeJson
    }),
    amdDataset: new AmdCpuDataset({
      collector: amdCollector,
      datasetPath: AMD_DATASET_KEY,
      readJson: jsonStore.readJson,
      writeJson: jsonStore.writeJson
    })
  };
}

export async function fetchCpuApi(request, services, env = {}) {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/health") {
    return json({ ok: true });
  }

  if (request.method === "GET" && url.pathname === "/api/intel/cpus") {
    const auth = rapidApiResponse(request, env);

    if (auth) {
      return auth;
    }

    return datasetResponse(services.intelDataset, url, IntelSourceError, "intel");
  }

  if (request.method === "GET" && url.pathname === "/api/amd/cpus") {
    const auth = rapidApiResponse(request, env);

    if (auth) {
      return auth;
    }

    return datasetResponse(services.amdDataset, url, AmdSourceError, "amd");
  }

  return json(
    {
      error: "not_found",
      message: "Use GET /api/intel/cpus or GET /api/amd/cpus for CPU specs."
    },
    404
  );
}

function rapidApiResponse(request, env) {
  const auth = checkRapidApiRequest(request.headers, env.RAPIDAPI_PROXY_SECRET);

  if (auth.ok) {
    return null;
  }

  return json(
    {
      error: "rapidapi_unauthorized",
      message: auth.message
    },
    401
  );
}

export async function syncIntelFromSchedule(env, services = createWorkerServices(env)) {
  return services.intelDataset.syncNew({
    limit: envNumber(env.INTEL_SYNC_LIMIT) ?? 4
  });
}

async function datasetResponse(dataset, url, SourceError, source) {
  try {
    return json(await dataset.get(datasetOptions(url)));
  } catch (error) {
    const sourceFailure = error instanceof SourceError;

    return json(
      {
        error: sourceFailure ? `${source}_source_unavailable` : "internal_error",
        message: error.message
      },
      sourceFailure ? 502 : 500
    );
  }
}

function datasetOptions(url) {
  return {
    chipset: url.searchParams.get("chipset"),
    cores: url.searchParams.get("cores"),
    ecc: url.searchParams.get("ecc"),
    ram: url.searchParams.get("ram"),
    refresh: url.searchParams.get("refresh") === "true",
    limit: url.searchParams.get("limit"),
    server: url.searchParams.get("server"),
    socket: url.searchParams.get("socket"),
    speed: url.searchParams.get("speed"),
    threads: url.searchParams.get("threads")
  };
}

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store"
    }
  });
}

function envNumber(value) {
  const number = Number.parseInt(value ?? "", 10);
  return Number.isInteger(number) && number >= 0 ? number : undefined;
}

export default {
  async fetch(request, env) {
    return fetchCpuApi(request, createWorkerServices(env), env);
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(
      syncIntelFromSchedule(env).catch((error) => {
        console.warn(`Intel scheduled sync failed: ${error.message}`);
      })
    );
  }
};
