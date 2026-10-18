import {
  isPdfPageNumber,
  type PdfAdapter,
  type PdfSource,
} from '@hamster-note/native-reader/pdf-contracts';

export function openPdf(adapter: PdfAdapter, source: PdfSource) {
  const session = adapter.open(
    source,
    { sessionId: 'consumer', generation: 1 },
    {
      onStateChange(state) {
        if (state.status === 'ready')
          isPdfPageNumber(state.pageNumber, state.pageCount);
      },
      onMetadata() {},
      onPageChange() {},
      onSelectionChange(identity, selection) {
        if (selection) {
          const space: 'reader' = selection.coordinateSpace;
          return { space, generation: identity.generation };
        }
        return null;
      },
    },
  );
  session.clearSelection();
  session.dispose();
  return session;
}
