import assert from "node:assert/strict";
import { test } from "node:test";
import { selectCpuDataset } from "../src/cpuDatasetFilters.js";

test("CPU dataset filtering matches socket values across vendor field names", () => {
  const selected = selectCpuDataset(dataset(), {
    socket: "am5"
  });

  assert.equal(selected.count, 1);
  assert.deepEqual(selected.products.map((product) => product.id), ["amd-am5"]);
});

test("CPU dataset filtering applies chipset before limit", () => {
  const selected = selectCpuDataset(dataset(), {
    chipset: "gen 3",
    limit: 1
  });

  assert.equal(selected.count, 1);
  assert.deepEqual(selected.products.map((product) => product.id), ["intel-bga"]);
});

test("CPU dataset filtering combines socket and chipset filters", () => {
  const selected = selectCpuDataset(dataset(), {
    chipset: "gen 5",
    socket: "am5"
  });

  assert.equal(selected.count, 1);
  assert.deepEqual(selected.products.map((product) => product.id), ["amd-am5"]);
});

test("CPU dataset filtering matches server CPUs from segments and families", () => {
  const selected = selectCpuDataset(dataset(), {
    server: "true"
  });

  assert.equal(selected.count, 2);
  assert.deepEqual(
    selected.products.map((product) => product.id),
    ["intel-bga", "amd-server"]
  );
});

test("CPU dataset filtering matches ECC support booleans", () => {
  const selected = selectCpuDataset(dataset(), {
    ecc: "false"
  });

  assert.equal(selected.count, 1);
  assert.deepEqual(selected.products.map((product) => product.id), ["amd-am4"]);
});

test("CPU dataset filtering matches supported RAM fields", () => {
  const selected = selectCpuDataset(dataset(), {
    ram: "DDR5"
  });

  assert.equal(selected.count, 2);
  assert.deepEqual(
    selected.products.map((product) => product.id),
    ["amd-am5", "amd-server"]
  );
});

test("CPU dataset filtering matches total cores and threads", () => {
  const selected = selectCpuDataset(dataset(), {
    cores: "16",
    threads: "32"
  });

  assert.equal(selected.count, 1);
  assert.deepEqual(selected.products.map((product) => product.id), ["amd-am5"]);
});

test("CPU dataset filtering matches processor speed fields", () => {
  const selected = selectCpuDataset(dataset(), {
    speed: "2.8 GHz"
  });

  assert.equal(selected.count, 1);
  assert.deepEqual(selected.products.map((product) => product.id), ["intel-bga"]);
});

test("CPU dataset selection projects comma-separated product columns after filtering", () => {
  const selected = selectCpuDataset(dataset(), {
    columns: "id, name, specs",
    socket: "AM5"
  });

  assert.deepEqual(selected.products, [
    {
      id: "amd-am5",
      name: "AMD AM5 CPU",
      specs: {
        Specifications: {
          "CPU Socket": "AM5",
          "Chipset Support": "Gen 5",
          "Memory Types": "DDR5",
          "ECC Supported": "Yes",
          "# of CPU Cores": "16",
          "# of Threads": "32",
          "Max. Boost Clock": "Up to 5.7 GHz"
        }
      }
    }
  ]);
});

function dataset() {
  return {
    count: 4,
    products: [
      {
        id: "intel-bga",
        specs: {
          Essentials: {
            "Vertical Segment": "Server"
          },
          "Memory Specifications": {
            "Memory Types": "DDR4",
            "ECC Memory Supported": "Yes"
          },
          "CPU Specifications": {
            "Total Cores": "8",
            "# of Efficient-cores": "4",
            "Total Threads": "8",
            "Processor Base Frequency": "2.80 GHz"
          },
          "Package Specifications": {
            "Sockets Supported": "FCBGA2106"
          },
          "Expansion Options": {
            "Chipset / PCH PCIe Revision": "Gen 3"
          }
        }
      },
      {
        id: "amd-am4",
        specs: {
          Specifications: {
            "CPU Socket": "AM4",
            "Chipset Support": "Gen 4",
            "Memory Types": "DDR4",
            "ECC Supported": "No",
            "# of CPU Cores": "6",
            "# of Threads": "12",
            "Max. Boost Clock": "Up to 5.4 GHz"
          }
        }
      },
      {
        id: "amd-am5",
        name: "AMD AM5 CPU",
        url: "https://amd.example/am5",
        specs: {
          Specifications: {
            "CPU Socket": "AM5",
            "Chipset Support": "Gen 5",
            "Memory Types": "DDR5",
            "ECC Supported": "Yes",
            "# of CPU Cores": "16",
            "# of Threads": "32",
            "Max. Boost Clock": "Up to 5.7 GHz"
          }
        }
      },
      {
        id: "amd-server",
        family: "AMD Server Processors",
        specs: {
          Specifications: {
            "CPU Socket": "SP5",
            "System Memory Type": "DDR5",
            "ECC Supported": "Yes",
            "# of CPU Cores": "24",
            "# of Threads": "48",
            "Base Clock": "3.8 GHz"
          }
        }
      }
    ]
  };
}
