export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      out[index] = await fn(items[index] as T);
    }
  });
  await Promise.all(workers);
  return out;
}

export function ttlCache<T>(ttlMs: number) {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = load();
    entries.set(key, { at: Date.now(), value });
    value.catch(() => entries.delete(key));
    return value;
  };
}
