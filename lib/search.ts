export type SearchMatch =
  | { kind: "height"; value: string; href: string }
  | { kind: "hash"; value: string }
  | { kind: "address"; value: string; href: string }
  | { kind: "invalid"; value: string };

export function classifySearch(value: string): SearchMatch {
  const query = value.trim();
  if (query.length === 0 || query.length > 128) {
    return { kind: "invalid", value: query };
  }

  if (/^\d+$/.test(query)) {
    const height = Number(query);
    if (Number.isSafeInteger(height)) {
      return { kind: "height", value: query, href: `/block/${height}` };
    }
    return { kind: "invalid", value: query };
  }

  if (/^[a-fA-F0-9]{64}$/.test(query)) {
    return { kind: "hash", value: query };
  }

  if (/^[a-zA-Z0-9]{26,128}$/.test(query)) {
    return {
      kind: "address",
      value: query,
      href: `/address/${encodeURIComponent(query)}`,
    };
  }

  return { kind: "invalid", value: query };
}
