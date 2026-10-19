jest.mock('expo', () => ({ registerRootComponent: jest.fn() }));
jest.mock('./src/DemoApp', () => ({ DemoApp: jest.fn() }));
jest.mock('./src/DiagnosticsConsumer', () => ({
  DiagnosticsConsumer: jest.fn(),
}));

const originalLocation = Object.getOwnPropertyDescriptor(
  globalThis,
  'location',
);

afterEach(() => {
  if (originalLocation)
    Object.defineProperty(globalThis, 'location', originalLocation);
  else Reflect.deleteProperty(globalThis, 'location');
});

test.each([
  ['native without location', undefined, './src/DemoApp', 'DemoApp'],
  ['Web root', '/', './src/DemoApp', 'DemoApp'],
  [
    'Web diagnostic page',
    '/diagnostics-consumer.html',
    './src/DiagnosticsConsumer',
    'DiagnosticsConsumer',
  ],
  ['other Web path', '/books', './src/DemoApp', 'DemoApp'],
])(
  'registers the %s root before entry module execution returns',
  (_label, pathname, moduleName, componentName) => {
    if (pathname === undefined) Reflect.deleteProperty(globalThis, 'location');
    else
      Object.defineProperty(globalThis, 'location', {
        configurable: true,
        value: { pathname },
      });

    jest.isolateModules(() => {
      const { registerRootComponent } = jest.requireMock('expo');
      const expectedComponent = jest.requireMock(moduleName!)[componentName!];

      jest.requireActual('./index');

      // No promise flush or timer: native runApplication can follow immediately.
      expect(registerRootComponent).toHaveBeenCalledTimes(1);
      expect(registerRootComponent).toHaveBeenCalledWith(expectedComponent);
    });
  },
);
