export async function bestEffortCleanup(
  cleanup: () => Promise<void>,
): Promise<void> {
  try {
    await cleanup();
  } catch {
    // A stale cache deletion must not prevent the replacement source loading.
  }
}
