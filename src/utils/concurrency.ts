// Simple concurrency helpers for controlled parallelism

export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  iterator: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  if (limit <= 0) throw new Error("Concurrency limit must be >= 1");
  if (items.length === 0) return [];

  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  let resolved = 0;

  return new Promise<R[]>((resolve, reject) => {
    const launchNext = () => {
      while (nextIndex < items.length && activeCount < limit) {
        const current = nextIndex++;
        activeCount++;
        Promise.resolve(iterator(items[current], current))
          .then((res) => {
            results[current] = res;
            activeCount--;
            resolved++;
            if (resolved === items.length) {
              resolve(results);
              return;
            }
            launchNext();
          })
          .catch((err) => reject(err));
      }
    };

    let activeCount = 0;
    launchNext();
  });
}

export function chunkArray<T>(arr: T[], size: number): T[][] {
  if (size <= 0) throw new Error("Chunk size must be >= 1");
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
