import { probeWebPdfSource } from './webSource';

beforeEach(() => {
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { origin: 'https://reader.test' },
  });
});
afterEach(() => jest.restoreAllMocks());
const source = {
  kind: 'uri' as const,
  uri: 'blob:https://reader.test/id',
  name: 'renamed.epub',
};
const probe = () => probeWebPdfSource(source, new AbortController().signal);
test('remote/cross-origin input causes zero requests', async () => {
  const fetch = jest.spyOn(globalThis, 'fetch');
  for (const uri of [
    'https://remote.test/book.pdf',
    'blob:https://other.test/id',
    'file:///book.pdf',
  ])
    await expect(
      probeWebPdfSource({ ...source, uri }, new AbortController().signal),
    ).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
});
test('requires the exact bounded range and reads five bytes only', async () => {
  const bytes = new TextEncoder().encode('%PDF-');
  const arrayBuffer = jest.fn(async () => bytes.buffer);
  const fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue({
    status: 206,
    headers: new Headers({
      'Content-Range': 'bytes 0-4/500',
      'Content-Length': '5',
    }),
    arrayBuffer,
  } as unknown as Response);
  await expect(probe()).resolves.toEqual({ pdf: true, size: 500 });
  expect(fetch).toHaveBeenCalledWith(
    source.uri,
    expect.objectContaining({
      headers: { Range: 'bytes=0-4' },
      redirect: 'error',
    }),
  );
  expect([...bytes]).toEqual([0, 0, 0, 0, 0]);
});
test.each([
  [200, 'bytes 0-4/500', '5'],
  [206, 'bytes 0-5/500', '6'],
  [206, 'bytes 0-4/134217729', '5'],
  [206, 'bytes 0-4/*', '5'],
  [206, 'bytes 0-4/500', '500'],
])(
  'fails closed without consuming the body for status %s range %s length %s',
  async (status, range, length) => {
    const arrayBuffer = jest.fn();
    const cancel = jest.fn();
    jest.spyOn(globalThis, 'fetch').mockResolvedValue({
      status,
      headers: new Headers({
        'Content-Range': range,
        'Content-Length': length,
      }),
      arrayBuffer,
      body: { cancel },
    } as unknown as Response);
    await expect(probe()).rejects.toThrow();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);
