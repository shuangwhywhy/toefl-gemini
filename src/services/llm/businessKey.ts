const hashString = (input: string) => {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
};

const normalizeForBusinessKey = (value: unknown): unknown => {
  if (value === null || value === undefined) {
    return value;
  }

  if (typeof value === 'string') {
    if (value.length > 256) {
      return {
        __type: 'long-string',
        length: value.length,
        hash: hashString(value)
      };
    }
    return value;
  }

  if (
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return value;
  }

  if (typeof value === 'function') {
    const source = String(value).replace(/\s+/g, ' ').trim();
    return {
      __type: 'function',
      signature:
        source.length > 512
          ? `${source.slice(0, 256)}:${hashString(source)}`
          : source
    };
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeForBusinessKey(item));
  }

  if (value instanceof Uint8Array) {
    return {
      __type: 'uint8array',
      length: value.length,
      hash: hashString(String.fromCharCode(...value.slice(0, 2048)))
    };
  }

  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    return {
      __type: 'blob',
      size: value.size,
      mimeType: value.type
    };
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, normalizeForBusinessKey(entryValue)]);

    return Object.fromEntries(entries);
  }

  return String(value);
};

export const createBusinessKey = (namespace: string, value: unknown) => {
  const normalized = normalizeForBusinessKey(value);
  return `${namespace}:${hashString(JSON.stringify(normalized))}`;
};

export const hashBlobForBusinessKey = async (blob: Blob) => {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let hash = 2166136261;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 16777619);
  }
  return `${blob.type || 'application/octet-stream'}:${blob.size}:${(hash >>> 0).toString(36)}`;
};
