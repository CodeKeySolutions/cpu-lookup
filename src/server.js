import http from "node:http";
import { pathToFileURL } from "node:url";
import { AmdCpuCollector, AmdSourceError } from "./amdCpuCollector.js";
import { AmdCpuDataset } from "./amdCpuDataset.js";
import { IntelArkCollector, IntelSourceError } from "./intelArkCollector.js";
import { IntelCpuDataset } from "./intelCpuDataset.js";
import { startIntelCpuSync } from "./intelCpuSync.js";
import { checkRapidApiRequest } from "./rapidApiAuth.js";

const intelCollector = new IntelArkCollector();
const intelDataset = new IntelCpuDataset({ collector: intelCollector });
const amdCollector = new AmdCpuCollector({
  requestIntervalMs: envNumber("AMD_REQUEST_INTERVAL_MS"),
  maxRetries: envNumber("AMD_MAX_RETRIES")
});
const amdDataset = new AmdCpuDataset({ collector: amdCollector });
const port = Number.parseInt(process.env.PORT ?? "3000", 10);
const DEVELOPMENT_MODE = process.env.NODE_ENV !== "production";
export function createServer(
  intelCpuDataset = intelDataset,
  amdCpuDataset = amdDataset
) {
  return http.createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return json(response, 200, { ok: true });
    }

    if (request.method === "GET" && url.pathname === "/api/intel/cpus") {
      const rapidApiAuth = checkRapidApiRequest(
        request.headers,
        process.env.RAPIDAPI_PROXY_SECRET,
        process.env.RAPIDAPI_HOST
      );

      if (!rapidApiAuth.ok) {
        return json(response, 401, {
          error: "rapidapi_unauthorized",
          message: rapidApiAuth.message
        });
      }

      try {
        const result = await intelCpuDataset.get({
          chipset: url.searchParams.get("chipset"),
          columns: url.searchParams.get("columns"),
          cores: url.searchParams.get("cores"),
          ecc: url.searchParams.get("ecc"),
          ram: url.searchParams.get("ram"),
          refresh: url.searchParams.get("refresh") === "true",
          limit: url.searchParams.get("limit"),
          server: url.searchParams.get("server"),
          socket: url.searchParams.get("socket"),
          speed: url.searchParams.get("speed"),
          threads: url.searchParams.get("threads")
        });

        return json(response, 200, result.products);
      } catch (error) {
        const status = error instanceof IntelSourceError ? 502 : 500;

        return json(response, status, {
          error: status === 502 ? "intel_source_unavailable" : "internal_error",
          message: error.message
        });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/amd/cpus") {
      const rapidApiAuth = checkRapidApiRequest(
        request.headers,
        process.env.RAPIDAPI_PROXY_SECRET,
        process.env.RAPIDAPI_HOST
      );

      if (!rapidApiAuth.ok) {
        return json(response, 401, {
          error: "rapidapi_unauthorized",
          message: rapidApiAuth.message
        });
      }

      try {
        const result = await amdCpuDataset.get({
          chipset: url.searchParams.get("chipset"),
          columns: url.searchParams.get("columns"),
          cores: url.searchParams.get("cores"),
          ecc: url.searchParams.get("ecc"),
          ram: url.searchParams.get("ram"),
          refresh: url.searchParams.get("refresh") === "true",
          limit: url.searchParams.get("limit"),
          server: url.searchParams.get("server"),
          socket: url.searchParams.get("socket"),
          speed: url.searchParams.get("speed"),
          threads: url.searchParams.get("threads")
        });

        return json(response, 200, result.products);
      } catch (error) {
        const status = error instanceof AmdSourceError ? 502 : 500;

        return json(response, status, {
          error: status === 502 ? "amd_source_unavailable" : "internal_error",
          message: error.message
        });
      }
    }

    return json(response, 404, {
      error: "not_found",
      message: "Use GET /api/intel/cpus or GET /api/amd/cpus for CPU specs."
    });
  });
}

function json(response, statusCode, body) {
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  response.end(JSON.stringify(body));
}

function envNumber(name) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value >= 0 ? value : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  createServer().listen(port, () => {
    console.log(`CPU specs API listening on http://localhost:${port}`);
  });
  startIntelCpuSync(intelDataset, {
    intervalMs: envNumber("INTEL_SYNC_INTERVAL_MS") ?? 5 * 60 * 1_000,
    limit: envNumber("INTEL_SYNC_LIMIT") ?? 4
  });
}
