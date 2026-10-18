const mockRequireModule = jest.fn();
const mockRequireView = jest.fn();
jest.mock('expo', () => ({
  requireOptionalNativeModule: mockRequireModule,
  requireNativeView: mockRequireView,
}));
import { getPdfKitHost } from './pdfKitHost';

test.each([
  null,
  {},
  { capability: {} },
  {
    capability: {
      protocol: 'hamster-pdf',
      version: 1,
      maxBytes: 1,
      readyAfterDraw: true,
    },
  },
])(
  'missing or incompatible module does not bind a view or access a source (%p)',
  (value) => {
    mockRequireModule.mockReturnValue(value);
    expect(getPdfKitHost()).toBeNull();
    expect(mockRequireView).not.toHaveBeenCalled();
  },
);
test('a matching independent native host binds without requiring its JS package', () => {
  mockRequireModule.mockReturnValue({
    capability: {
      protocol: 'hamster-pdf',
      version: 1,
      maxBytes: 32 * 1024 * 1024,
      readyAfterDraw: true,
    },
  });
  mockRequireView.mockReturnValue('PdfKitView');
  expect(getPdfKitHost()).toBe('PdfKitView');
  expect(mockRequireView).toHaveBeenCalledWith('HamsterPdfKit');
});
test('native registry failure is a stable absent capability', () => {
  mockRequireModule.mockImplementation(() => {
    throw new Error('unavailable');
  });
  expect(getPdfKitHost()).toBeNull();
});
