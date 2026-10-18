const mockConfig = jest.fn();
const mockRequire = jest.fn().mockReturnValue('AndroidPdfHost');
jest.mock('react-native', () => ({
  UIManager: { getViewManagerConfig: mockConfig },
  requireNativeComponent: mockRequire,
}));
import { getAndroidPdfHost } from './androidHost';
const supported = {
  pdfProtocolVersion: 1,
  maxPdfBytes: 32 * 1024 * 1024,
  privatePdfPort: true,
  readyAfterDraw: true,
};
test.each([
  null,
  {},
  { ...supported, privatePdfPort: false },
  { ...supported, pdfProtocolVersion: 2 },
  { ...supported, maxPdfBytes: 1024 },
])('missing or incompatible host stays unsupported: %p', (value) => {
  mockConfig.mockReturnValue(value);
  expect(getAndroidPdfHost()).toBeNull();
  expect(mockRequire).not.toHaveBeenCalled();
});
test('compatible native registry resolves only the separate PDF component', () => {
  mockConfig.mockReturnValue({ Constants: supported });
  expect(getAndroidPdfHost()).toBe('AndroidPdfHost');
  expect(mockRequire).toHaveBeenLastCalledWith('HNPdfView');
});
