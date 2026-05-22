# RapidAPI Documentation

Use this copy when publishing the CPU Specs API on RapidAPI. The importable
OpenAPI definition is in `docs/rapidapi.openapi.yaml`.

## Overview

CPU Specs API returns Intel and AMD CPU products from cached specification
datasets collected from vendor specification pages. Each CPU result keeps the vendor's grouped
specification fields so clients can inspect sockets, memory support, ECC
support, core counts, clocks, and other exposed details.

Normal requests read the saved dataset first. Returned rows depend on the data
currently present in the dataset and on which fields the vendor exposes for a
CPU model.

## Authentication

RapidAPI consumers call the RapidAPI endpoint with the RapidAPI key header:

```text
X-RapidAPI-Key: <consumer-key>
```

The provider deployment can set `RAPIDAPI_PROXY_SECRET` to allow CPU endpoint
requests only when RapidAPI forwards the matching `X-RapidAPI-Proxy-Secret`
header. With `RAPIDAPI_HOST=cpu-lookup.p.rapidapi.com`, the provider also
checks the forwarded `X-RapidAPI-Host` header. The provider secret must not be
documented or sent by consumers.

## Public Endpoints

### Get Intel CPUs

```text
GET /api/intel/cpus
```

Returns Intel CPU models and grouped Intel specification sections.

### Get AMD CPUs

```text
GET /api/amd/cpus
```

Returns AMD CPU models and grouped AMD specification fields.

## Query Parameters

Both CPU endpoints accept the same public query parameters.

| Name | Type | Description | Example |
| --- | --- | --- | --- |
| `limit` | integer | Return the first positive number of matching products. | `10` |
| `socket` | string | Match socket-related specification fields. | `AM5` |
| `chipset` | string | Match chipset-related specification fields. | `X870` |
| `server` | boolean | Filter server CPUs with `true` or non-server CPUs with `false`. | `true` |
| `ecc` | boolean | Filter by ECC support with `true` or `false`. | `true` |
| `ram` | string | Match memory type or RAM support fields. | `DDR5` |
| `cores` | number | Exact-match exposed CPU core count fields. | `16` |
| `threads` | number | Exact-match exposed thread count fields. | `32` |
| `speed` | string | Exact-match exposed processor frequency or clock fields. | `5.7` |
| `columns` | string | Return only comma-separated product fields or vendor spec fields. | `name,CPU Socket,Memory Types` |

`speed` treats plain numeric values as GHz. Values such as `5.7GHz` and
`5700MHz` are also accepted by the filter logic.

The service also has a `refresh=true` operational query option. Do not list it
as a public RapidAPI parameter unless consumers should be able to trigger
upstream vendor pulls.

## Examples

Get ten Intel CPU rows:

```text
GET /api/intel/cpus?limit=10
```

Get AMD AM5 CPUs with DDR5 support:

```text
GET /api/amd/cpus?socket=AM5&ram=DDR5
```

Get compact AMD rows with only selected product and spec fields:

```text
GET /api/amd/cpus?columns=name,CPU%20Socket,Memory%20Types&socket=AM5
```

Get Intel server CPUs with ECC support:

```text
GET /api/intel/cpus?server=true&ecc=true
```

Get AMD CPUs by core count, thread count, and speed:

```text
GET /api/amd/cpus?cores=16&threads=32&speed=5.7
```

## Success Response

```json
[
  {
    "id": "246037",
    "name": "Intel Atom Processor P6922-3",
    "family": "Intel Atom Processor P Series",
    "url": "https://www.intel.com/content/www/us/en/products/sku/246037/specifications.html",
    "specs": {
      "CPU Specifications": {
        "Total Cores": "8",
        "Total Threads": "8",
        "Processor Base Frequency": "2.2 GHz"
      },
      "Memory Specifications": {
        "Memory Types": "DDR5",
        "ECC Memory Supported": "Yes"
      }
    }
  }
]
```

The `specs` object uses vendor-defined section names and field names, so fields
can vary between Intel, AMD, and CPU families.

## Error Responses

Unauthorized RapidAPI verification:

```json
{
  "error": "rapidapi_unauthorized",
  "message": "Request was not verified as RapidAPI proxy traffic."
}
```

Vendor source unavailable during an upstream refresh:

```json
{
  "error": "intel_source_unavailable",
  "message": "Intel source error message."
}
```

AMD refresh failures use `amd_source_unavailable`. Unexpected server failures
use `internal_error`.
