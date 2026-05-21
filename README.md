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

Then call:

```text
GET http://localhost:3000/api/intel/cpus
GET http://localhost:3000/api/amd/cpus
```

The Intel response includes discovered SKUs and grouped Intel ARK spec sections.
The AMD response maps the official AMD processor specification table columns
into spec rows for desktop, laptop, workstation, server, and embedded CPU
tables. Once a full dataset has been collected, normal requests read the saved
snapshots instead of fetching upstream pages again:

```text
data/cpus/intel.json
data/cpus/amd.json
```

For a smaller development request, cap the number of products returned. If the
saved dataset exists, the limited response comes from that snapshot. If it does
not exist yet, a successful limited request writes a partial snapshot. Full
requests still refresh partial snapshots so a small cached response is not
treated as the complete dataset:

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
```

`server` and `ecc` accept `true` or `false`. Socket and chipset filters match
specification field names containing `socket` or `chipset`. The RAM filter
matches memory type/system memory fields such as `DDR4` or `DDR5`. Core and
thread filters exact-match numeric spec values. `speed` exact-matches CPU
frequency/clock fields in GHz; both `speed=2.8` and `speed=2.8GHz` work.
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
