import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AmdCpuCollector,
  parseAmdSpecificationPage
} from "../src/amdCpuCollector.js";

const clientPage = {
  family: "AMD Desktop, Laptop, and Workstation Processors",
  url: "https://www.amd.com/en/products/specifications/processors.html"
};
const serverPage = {
  family: "AMD Server Processors",
  url: "https://www.amd.com/en/products/specifications/server-processor.html"
};

test("AMD specification parser maps model rows into product specs", () => {
  const products = parseAmdSpecificationPage(specificationTable(), clientPage);

  assert.equal(products.length, 2);
  assert.deepEqual(products[0], {
    id: "amd-ryzen-9-9950x",
    name: "AMD Ryzen 9 9950X",
    family: clientPage.family,
    url: "https://www.amd.com/en/products/processors/desktops/ryzen/amd-ryzen-9-9950x.html",
    specs: {
      Specifications: {
        "# of CPU Cores": "16",
        "Max. Boost Clock": "Up to 5.7 GHz"
      }
    }
  });
});

test("AMD specification parser maps current embedded product rows into product specs", () => {
  const products = parseAmdSpecificationPage(specificationData(), clientPage);

  assert.deepEqual(products, [
    {
      id: "amd-ryzen-9-9950x",
      name: "AMD Ryzen 9 9950X",
      family: clientPage.family,
      url: "https://www.amd.com/en/products/processors/desktops/ryzen/amd-ryzen-9-9950x.html",
      specs: {
        Specifications: {
          "CPU Socket": "AM5",
          "# of CPU Cores": "16",
          "System Memory Type": "DDR5",
          "Max. Boost Clock": "Up to 5.7 GHz"
        }
      }
    }
  ]);
});

test("AMD collector spaces page requests and retries rate limits", async () => {
  let now = 0;
  const sleeps = [];
  const responses = [
    new Response("busy", { status: 429, headers: { "retry-after": "2" } }),
    new Response(specificationTable("AMD Ryzen 7 9800X3D"), { status: 200 }),
    new Response(specificationTable("AMD EPYC 4344P"), { status: 200 })
  ];
  const collector = new AmdCpuCollector({
    sourcePages: [clientPage, serverPage],
    fetchImpl: async () => responses.shift(),
    requestIntervalMs: 250,
    maxRetries: 1,
    now: () => now,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      now += delayMs;
    }
  });

  const result = await collector.collect();

  assert.equal(result.count, 3);
  assert.deepEqual(sleeps, [2_000, 250]);
});

function specificationTable(firstModel = "AMD Ryzen 9 9950X") {
  return `
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th># of CPU Cores</th>
          <th>Max. Boost Clock</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td>
            <a href="/en/products/processors/desktops/ryzen/amd-ryzen-9-9950x.html">
              ${firstModel}
            </a>
          </td>
          <td>16</td>
          <td>Up to 5.7 GHz</td>
        </tr>
        <tr>
          <td>AMD Ryzen 5 9600X</td>
          <td>6</td>
          <td>Up to 5.4 GHz</td>
        </tr>
      </tbody>
    </table>
  `;
}

function specificationData() {
  return `
    <div data-json='{
      "items": [
        {
          "productPages": {
            "en": "https://www.amd.com/en/products/processors/desktops/ryzen/amd-ryzen-9-9950x.html"
          },
          "elements": {
            "name": {
              "title": "Name",
              "formatValue": "AMD Ryzen 9 9950X"
            },
            "cpuSocket": {
              "title": "CPU Socket",
              "formatValue": ["AM5"]
            },
            "numOfCpuCores": {
              "title": "# of CPU Cores",
              "formatValue": "16"
            },
            "systemMemoryType": {
              "title": "System Memory Type",
              "formatValue": ["DDR5"]
            },
            "maxBoostClock": {
              "title": "Max. Boost Clock",
              "formatValue": "Up to 5.7 GHz"
            }
          }
        }
      ]
    }'></div>
  `;
}
