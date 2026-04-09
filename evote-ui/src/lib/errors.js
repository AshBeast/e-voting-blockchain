function pushText(values, value) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (trimmed) values.push(trimmed);
}

function collectErrorText(error, values = [], seen = new Set()) {
  if (error == null) return values;
  if (typeof error === "string") {
    pushText(values, error);
    return values;
  }
  if (typeof error !== "object") {
    pushText(values, String(error));
    return values;
  }
  if (seen.has(error)) return values;
  seen.add(error);

  pushText(values, error.reason);
  pushText(values, error.shortMessage);
  pushText(values, error.message);
  pushText(values, error.error);
  pushText(values, error.body);

  if (Array.isArray(error.errors)) {
    for (const nested of error.errors) collectErrorText(nested, values, seen);
  }
  if (Array.isArray(error.value)) {
    for (const nested of error.value) collectErrorText(nested, values, seen);
  }
  if (error.info) collectErrorText(error.info, values, seen);
  if (error.data) collectErrorText(error.data, values, seen);
  if (error.payload) collectErrorText(error.payload, values, seen);

  return values;
}

function looksLikeRateLimit(error) {
  const haystack = collectErrorText(error)
    .join(" | ")
    .toLowerCase();

  if (!haystack) return false;

  return (
    haystack.includes("too many requests") ||
    haystack.includes("rate limit") ||
    haystack.includes("rate-limit") ||
    haystack.includes("request limit") ||
    haystack.includes("exceeded throughput") ||
    haystack.includes("429") ||
    haystack.includes("-32005")
  );
}

export function friendlyUiError(error) {
  if (looksLikeRateLimit(error)) {
    return (
      "RPC provider rate limit reached. Please wait a moment and try again. " +
      "If it keeps happening, switch RPC provider or reduce refresh frequency."
    );
  }

  const [first] = collectErrorText(error);
  return first || "Something went wrong. Please try again.";
}
