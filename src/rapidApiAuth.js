export function checkRapidApiRequest(headers, proxySecret, expectedHost) {
  if (process.env.NODE_ENV === "development") {
    return { ok: true };
  }
  if (!proxySecret) {
    return { ok: true };
  }

  const requestHost = headerValue(headers, "x-rapidapi-host");

  if (expectedHost && (!requestHost || !sameValue(requestHost, expectedHost))) {
    return {
      ok: false,
      message: "Request used an unexpected RapidAPI host."
    };
  }
  const requestSecret = headerValue(headers, "x-rapidapi-proxy-secret");

  if (!requestSecret || !sameValue(requestSecret, proxySecret)) {
    return {
      ok: false,
      message: "Request was not verified as RapidAPI proxy traffic."
    };
  }

  

  return { ok: true };
}

function headerValue(headers, name) {
  if (typeof headers?.get === "function") {
    return headers.get(name);
  }

  return headers?.[name] ?? headers?.[name.toLowerCase()];
}

function sameValue(value, expected) {
  if (value.length !== expected.length) {
    return false;
  }

  let difference = 0;

  for (let index = 0; index < value.length; index += 1) {
    difference |= value.charCodeAt(index) ^ expected.charCodeAt(index);
  }

  return difference === 0;
}
