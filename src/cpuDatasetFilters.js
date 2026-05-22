export function selectCpuDataset(
  dataset,
  {
    chipset,
    columns,
    cores,
    ecc,
    limit,
    ram,
    server,
    socket,
    speed,
    threads
  } = {}
) {
  const products = filterProducts(dataset.products ?? [], {
    chipset,
    cores,
    ecc,
    ram,
    server,
    socket,
    speed,
    threads
  });
  const cappedLimit = normalizeLimit(limit);
  const selectedProducts = cappedLimit ? products.slice(0, cappedLimit) : products;

  return {
    ...dataset,
    count: selectedProducts.length,
    products: projectProductColumns(selectedProducts, columns)
  };
}

function filterProducts(products, filters) {
  return products.filter((product) => {
    return (
      matchesSpecFilter(product, "socket", filters.socket) &&
      matchesSpecFilter(product, "chipset", filters.chipset) &&
      matchesRamFilter(product, filters.ram) &&
      matchesEccFilter(product, filters.ecc) &&
      matchesServerFilter(product, filters.server) &&
      matchesNumericSpecFilter(product, isCoreLabel, filters.cores) &&
      matchesNumericSpecFilter(product, isThreadLabel, filters.threads) &&
      matchesSpeedFilter(product, filters.speed)
    );
  });
}

function matchesSpecFilter(product, fieldName, query) {
  if (!query) {
    return true;
  }

  const normalizedQuery = normalize(query);

  return specEntries(product.specs).some(([label, value]) => {
    return normalize(label).includes(fieldName) && normalize(value).includes(normalizedQuery);
  });
}

function matchesRamFilter(product, query) {
  if (!query) {
    return true;
  }

  const normalizedQuery = normalize(query);

  return specEntries(product.specs).some(([label, value]) => {
    return isRamLabel(label) && normalize(value).includes(normalizedQuery);
  });
}

function matchesEccFilter(product, query) {
  const expected = booleanQuery(query);

  if (expected === undefined) {
    return true;
  }

  return specEntries(product.specs).some(([label, value]) => {
    return isEccLabel(label) && booleanValue(value) === expected;
  });
}

function matchesServerFilter(product, query) {
  const expected = booleanQuery(query);

  if (expected === undefined) {
    return true;
  }

  const isServer =
    normalize(product.family).includes("server") ||
    specEntries(product.specs).some(([label, value]) => {
      return isSegmentLabel(label) && normalize(value).includes("server");
    });

  return isServer === expected;
}

function matchesNumericSpecFilter(product, isLabel, query) {
  const expected = numberQuery(query);

  if (expected === undefined) {
    return true;
  }

  return specEntries(product.specs).some(([label, value]) => {
    return isLabel(label) && firstNumber(value) === expected;
  });
}

function matchesSpeedFilter(product, query) {
  const expectedGHz = speedQueryGHz(query);

  if (expectedGHz === undefined) {
    return true;
  }

  return specEntries(product.specs).some(([label, value]) => {
    return isProcessorSpeedLabel(label) && speedValueGHz(value) === expectedGHz;
  });
}

function specEntries(specs = {}) {
  return Object.values(specs).flatMap((section) =>
    Object.entries(section ?? {}).filter(([, value]) => typeof value === "string")
  );
}

function isRamLabel(label) {
  const normalizedLabel = normalize(label);
  return (
    normalizedLabel.includes("memory type") ||
    normalizedLabel.includes("memory types") ||
    normalizedLabel.includes("system memory") ||
    normalizedLabel.includes("ram")
  );
}

function isEccLabel(label) {
  return normalize(label).includes("ecc");
}

function isSegmentLabel(label) {
  const normalizedLabel = normalize(label);
  return normalizedLabel.includes("segment") || normalizedLabel.includes("processor type");
}

function isCoreLabel(label) {
  const normalizedLabel = normalize(label);
  return (
    normalizedLabel.includes("total cores") ||
    normalizedLabel.includes("cpu cores") ||
    normalizedLabel === "cores"
  );
}

function isThreadLabel(label) {
  return normalize(label).includes("thread");
}

function isProcessorSpeedLabel(label) {
  const normalizedLabel = normalize(label);

  if (
    normalizedLabel.includes("memory") ||
    normalizedLabel.includes("graphics") ||
    normalizedLabel.includes("bus")
  ) {
    return false;
  }

  return (
    (normalizedLabel.includes("processor") &&
      normalizedLabel.includes("frequency")) ||
    normalizedLabel.includes("turbo frequency") ||
    normalizedLabel.includes("boost clock") ||
    normalizedLabel.includes("base clock")
  );
}

function booleanQuery(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return booleanValue(value);
}

function booleanValue(value) {
  const normalizedValue = normalize(value);

  if (["1", "true", "yes", "y", "supported"].includes(normalizedValue)) {
    return true;
  }

  if (["0", "false", "no", "n", "unsupported"].includes(normalizedValue)) {
    return false;
  }

  return undefined;
}

function numberQuery(value) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }

  return firstNumber(value);
}

function firstNumber(value) {
  const number = Number.parseFloat(String(value).match(/\d+(?:\.\d+)?/)?.[0]);
  return Number.isFinite(number) ? number : undefined;
}

function speedQueryGHz(value) {
  const number = firstNumber(value);

  if (number === undefined) {
    return undefined;
  }

  return normalize(value).includes("mhz") ? number / 1_000 : number;
}

function speedValueGHz(value) {
  const number = firstNumber(value);

  if (number === undefined) {
    return undefined;
  }

  return normalize(value).includes("mhz") ? number / 1_000 : number;
}

function normalize(value) {
  return String(value).toLowerCase().replace(/\s+/g, " ").trim();
}

function normalizeLimit(limit) {
  if (limit === undefined || limit === null || limit === "") {
    return undefined;
  }

  const number = Number.parseInt(limit, 10);
  return Number.isInteger(number) && number > 0 ? number : undefined;
}

function projectProductColumns(products, columns) {
  const selectedColumns = normalizeColumns(columns);

  if (!selectedColumns) {
    return products;
  }

  return products.map((product) => {
    const projectedProduct = Object.fromEntries(
      Object.entries(product).filter(([column]) => {
        return column !== "specs" && selectedColumns.has(normalize(column));
      })
    );

    const specs = projectSpecs(product.specs, selectedColumns);

    if (specs) {
      projectedProduct.specs = specs;
    }

    return projectedProduct;
  });
}

function projectSpecs(specs, selectedColumns) {
  if (selectedColumns.has("specs")) {
    return specs;
  }

  const projectedSpecs = Object.fromEntries(
    Object.entries(specs ?? {})
      .map(([sectionName, section]) => {
        return [
          sectionName,
          Object.fromEntries(
            Object.entries(section ?? {}).filter(([column, value]) => {
              return typeof value === "string" && selectedColumns.has(normalize(column));
            })
          )
        ];
      })
      .filter(([, section]) => Object.keys(section).length)
  );

  return Object.keys(projectedSpecs).length ? projectedSpecs : null;
}

function normalizeColumns(columns) {
  if (!columns) {
    return null;
  }

  const selectedColumns = String(columns)
    .split(",")
    .map(normalize)
    .filter(Boolean);

  return selectedColumns.length ? new Set(selectedColumns) : null;
}
