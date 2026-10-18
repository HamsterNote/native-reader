import { createPdfDomSession } from './adapter.js';

// Static checkpoint only. Native source authorization and the private port are
// separate tasks; this top-level document must not read or synthesize a source.
export const pdfAndroidRuntime = Object.freeze({
  protocol: 'hamster-pdf',
  version: 1,
  createSession: createPdfDomSession,
});
