const operations = new Map<string, Promise<unknown>>();

export async function runErrandOperation<T>(id: string, run: () => Promise<T>, rejectIfBusy = false): Promise<T> {
  if (rejectIfBusy && operations.has(id)) {
    throw new Error('This errand is busy. Please try again after the current operation finishes.');
  }
  const previous = operations.get(id) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(run);
  operations.set(id, operation);
  try {
    return await operation;
  } finally {
    if (operations.get(id) === operation) operations.delete(id);
  }
}
