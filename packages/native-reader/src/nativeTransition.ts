export async function continueAfterBestEffortCleanup(
  previousTransition: Promise<void>,
  previousCleanup: () => Promise<void>,
  prepare: () => Promise<void>,
): Promise<void> {
  await previousTransition.catch(() => undefined);
  await previousCleanup().catch(() => undefined);
  await prepare();
}
