export async function mapConcurrent<T, R>(
  values: T[],
  concurrency: number,
  operation: (value: T, index: number) => Promise<R>
) {
  const results = new Array<R>(values.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < values.length) {
      const index = nextIndex;
      nextIndex += 1;
      // biome-ignore lint/performance/noAwaitInLoops: Each worker is sequential while the worker pool supplies bounded concurrency.
      results[index] = await operation(values[index] as T, index);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, values.length) }, () => worker())
  );
  return results;
}
