# CPU Specs API

This service exposes endpoints that collect Intel and AMD CPU specifications
from their official specification pages.

## Run

```powershell
npm install
npm start
```

`npm start` and `npm run dev` load `.env` when it exists. Set `PORT` there
to change the local server port.

For the Cloudflare Worker runtime, use:

```powershell
npm run dev:worker
```

Then call:

```text
GET http://localhost:3000/api/intel/cpus
GET http://localhost:3000/api/amd/cpus
```

The Intel response includes discovered SKUs and grouped Intel ARK spec sections.
The AMD response maps the official AMD processor specification table columns
into spec rows for desktop, laptop, workstation, server, and embedded CPU
tables. API responses contain only selected CPU product rows from the dataset.
Once a full dataset has been collected, normal requests read the saved snapshots
instead of fetching upstream pages again:

```text
data/cpus/intel.json
data/cpus/amd.json
```

For a smaller development request, cap the number of products returned. If the
saved dataset exists, the limited response comes from that snapshot. If it does
not exist yet, a successful limited request writes a partial snapshot. All
normal requests check the saved dataset first, including partial snapshots.
Use `refresh=true` when you explicitly want to pull upstream:

```text
GET http://localhost:3000/api/intel/cpus?limit=10
GET http://localhost:3000/api/amd/cpus?limit=10
```

Filter returned CPU rows by socket, chipset-related spec values, server/client
classification, ECC support, RAM support, cores, threads, or processor speed:

```text
GET http://localhost:3000/api/intel/cpus?socket=LGA1700
GET http://localhost:3000/api/amd/cpus?socket=AM5
GET http://localhost:3000/api/intel/cpus?chipset=Gen%203
GET http://localhost:3000/api/amd/cpus?socket=AM5&chipset=X870
GET http://localhost:3000/api/intel/cpus?server=true&ecc=true
GET http://localhost:3000/api/amd/cpus?server=false&ram=DDR5
GET http://localhost:3000/api/intel/cpus?cores=8&threads=8
GET http://localhost:3000/api/amd/cpus?cores=16&threads=32&speed=5.7
GET http://localhost:3000/api/amd/cpus?columns=id,name,family&socket=AM5
```

`server` and `ecc` accept `true` or `false`. Socket and chipset filters match
specification field names containing `socket` or `chipset`. The RAM filter
matches memory type/system memory fields such as `DDR4` or `DDR5`. Core and
thread filters exact-match numeric spec values. `speed` exact-matches CPU
frequency/clock fields in GHz; both `speed=2.8` and `speed=2.8GHz` work.
Use `columns` with comma-separated product fields such as
`id,name,family,url,specs` to trim each returned CPU row. Filtering still uses
the full saved row before column selection is applied.
Available results depend on which fields the vendor source exposes for each CPU
row.

Pass `refresh=true` to fetch upstream sources and replace the saved full
dataset:

```text
GET http://localhost:3000/api/intel/cpus?refresh=true
GET http://localhost:3000/api/amd/cpus?refresh=true
```

Intel can throttle or block automated requests. When that happens, the endpoint
returns `502 intel_source_unavailable` rather than serving a partial crawl. A
previously saved dataset remains available to normal requests.

The running server also performs an incremental Intel sync. Every five minutes
it checks Intel ARK against `data/cpus/intel.json`, skips cached SKUs, fetches
specs for up to four unseen CPU rows, and merges those rows into the snapshot.
Tune that batch job in `.env`:

```env
INTEL_SYNC_INTERVAL_MS=300000
INTEL_SYNC_LIMIT=4
```

AMD refreshes use the official specification table pages, not one detail-page
request per CPU. Requests are spaced by `AMD_REQUEST_INTERVAL_MS` and retry
rate-limit/server-busy responses up to `AMD_MAX_RETRIES` times. The AMD endpoint
returns `502 amd_source_unavailable` if the upstream refresh fails; a saved AMD
dataset remains available to normal requests.

## RapidAPI

Set `RAPIDAPI_PROXY_SECRET` to require CPU API calls to come through RapidAPI:

```env
RAPIDAPI_PROXY_SECRET=your-provider-proxy-secret
```

When it is configured, `/api/intel/cpus` and `/api/amd/cpus` require
RapidAPI's `X-RapidAPI-Proxy-Secret` header to match that configured secret.
`/health` stays public. Leave the secret unset for local direct calls.

For Cloudflare, keep the provider proxy secret out of `wrangler.jsonc`:

```powershell
npx wrangler secret put RAPIDAPI_PROXY_SECRET
```

RapidAPI publishing docs are in:

- `docs/rapidapi.openapi.yaml` for OpenAPI import
- `docs/rapidapi.md` for listing and endpoint copy

## Cloudflare

The Cloudflare deployment uses:

- `src/worker.js` for Worker `fetch` and cron `scheduled` handlers
- `wrangler.jsonc` for Wrangler config
- an R2 binding named `CPU_DATA`
- R2 objects `cpus/intel.json` and `cpus/amd.json`

The Worker cron runs every five minutes and uses `INTEL_SYNC_LIMIT=4` to merge
small Intel batches into the R2 Intel snapshot. Local Node deployment continues
to use `data/cpus/*.json`.

Create the configured R2 bucket once:

```powershell
npx wrangler r2 bucket create cpu-specs-data
```

Upload existing snapshots when you want to seed production:

```powershell
npx wrangler r2 object put cpu-specs-data/cpus/intel.json --file=data/cpus/intel.json
npx wrangler r2 object put cpu-specs-data/cpus/amd.json --file=data/cpus/amd.json
```

Then deploy:

```powershell
npm run deploy
```
