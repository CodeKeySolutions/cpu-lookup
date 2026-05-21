export function createR2JsonStore(bucket) {
  if (!bucket) {
    throw new Error("An R2 bucket binding is required.");
  }

  return {
    async readJson(key) {
      const object = await bucket.get(key);

      if (!object) {
        throw missingObjectError(key);
      }

      return object.json();
    },

    async writeJson(key, value) {
      await bucket.put(key, `${JSON.stringify(value, null, 2)}\n`, {
        httpMetadata: {
          contentType: "application/json"
        }
      });
    }
  };
}

function missingObjectError(key) {
  return Object.assign(new Error(`R2 object ${key} does not exist.`), {
    code: "ENOENT"
  });
}
