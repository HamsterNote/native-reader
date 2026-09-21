export async function continueAfterBestEffortCleanup(
  previousTransition: Promise<void>,
  previousCleanup: () => Promise<void>,
  prepare: () => Promise<void>,
): Promise<void> {
  // A stale source owns a separate session directory. Deactivate/clean it in
  // the background so a hung write cannot prevent the replacement from opening.
  void previousTransition.catch(() => undefined);
  void previousCleanup().catch(() => undefined);
  await prepare();
}
