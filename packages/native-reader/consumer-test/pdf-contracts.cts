import {
  isPdfPageNumber,
  type PdfSessionIdentity,
} from '@hamster-note/native-reader/pdf-contracts';
const identity: PdfSessionIdentity = {
  sessionId: 'require-consumer',
  generation: 1,
};
export const valid = identity.generation === 1 && isPdfPageNumber(1, 2);
