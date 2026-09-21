const mockRegistryGet = jest.fn();
let mockReactNativeLoads = 0;

jest.mock('react-native', () => {
  mockReactNativeLoads += 1;
  return { TurboModuleRegistry: { get: mockRegistryGet } };
});

import {
  ANDROID_REQUIRED_NATIVE_CAPABILITIES,
  IOS_REQUIRED_NATIVE_CAPABILITIES,
  NATIVE_CAPABILITY_FAILURE_REASON,
  NATIVE_CAPABILITY_IMPLEMENTATION_ID,
  NATIVE_CAPABILITY_IMPLEMENTATION_VERSION,
  NATIVE_CAPABILITY_MODULE_NAME,
  NATIVE_CAPABILITY_PROTOCOL_MAJOR,
  type NativeCapabilityConstants,
  readNativeCapability,
  validateNativeCapabilityConstants,
} from './nativeCapability';

function validConstants(
  platform: 'android' | 'ios',
): NativeCapabilityConstants {
  return {
    implementationId: NATIVE_CAPABILITY_IMPLEMENTATION_ID,
    protocolMajor: NATIVE_CAPABILITY_PROTOCOL_MAJOR,
    implementationVersion: NATIVE_CAPABILITY_IMPLEMENTATION_VERSION,
    platform,
    capabilities: [
      ...(platform === 'android'
        ? ANDROID_REQUIRED_NATIVE_CAPABILITIES
        : IOS_REQUIRED_NATIVE_CAPABILITIES),
    ],
  };
}

function registryWith(constants: unknown) {
  return {
    get: jest.fn(() => ({ getConstants: jest.fn(() => constants) })),
  };
}

beforeEach(() => mockRegistryGet.mockReset());

test.each(['android', 'ios'] as const)(
  'validates the exact %s native capability ABI',
  (platform) => {
    const constants = validConstants(platform);

    expect(validateNativeCapabilityConstants(constants, platform)).toEqual({
      ok: true,
      constants,
    });
    expect(readNativeCapability(platform, registryWith(constants))).toEqual({
      ok: true,
      constants,
    });
  },
);

test('allows unique additional native capabilities', () => {
  const constants = validConstants('android');
  constants.capabilities.push('future-security-contract-v2');

  expect(validateNativeCapabilityConstants(constants, 'android')).toEqual({
    ok: true,
    constants,
  });
});

test('uses the lazily read non-enforcing TurboModuleRegistry.get by default', () => {
  const constants = validConstants('ios');
  mockRegistryGet.mockReturnValue({ getConstants: () => constants });

  expect(mockReactNativeLoads).toBe(0);
  expect(mockRegistryGet).not.toHaveBeenCalled();
  expect(readNativeCapability('ios')).toEqual({ ok: true, constants });
  expect(mockReactNativeLoads).toBe(1);
  expect(mockRegistryGet).toHaveBeenCalledWith(NATIVE_CAPABILITY_MODULE_NAME);
});

test('returns stable failures when the module or getConstants is unavailable', () => {
  expect(readNativeCapability('android', { get: () => null })).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.MODULE_UNAVAILABLE,
  });
  expect(readNativeCapability('android', { get: () => ({}) })).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.GET_CONSTANTS_UNAVAILABLE,
  });
  expect(
    readNativeCapability('android', {
      get: () => ({ getConstants: 'not-a-function' }),
    }),
  ).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.GET_CONSTANTS_UNAVAILABLE,
  });
});

test('returns validator failures from native constants without throwing', () => {
  const constants: Record<string, unknown> = validConstants('android');
  constants.protocolMajor = 2;

  expect(() =>
    readNativeCapability('android', registryWith(constants)),
  ).not.toThrow();
  expect(readNativeCapability('android', registryWith(constants))).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_PROTOCOL_MAJOR,
  });
});

test('contains exceptions from registry lookup and getConstants', () => {
  const throwingRegistry = {
    get(): unknown {
      throw new Error('lookup failed');
    },
  };
  const throwingConstants = {
    get: () => ({
      getConstants(): unknown {
        throw new Error('constants failed');
      },
    }),
  };

  expect(() => readNativeCapability('android', throwingRegistry)).not.toThrow();
  expect(readNativeCapability('android', throwingRegistry)).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.REGISTRY_LOOKUP_FAILED,
  });
  expect(() =>
    readNativeCapability('android', throwingConstants),
  ).not.toThrow();
  expect(readNativeCapability('android', throwingConstants)).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.GET_CONSTANTS_FAILED,
  });
});

test.each([null, undefined, 1, 'constants', [], new Date(), () => ({})])(
  'rejects non-plain constants %#',
  (value) => {
    expect(validateNativeCapabilityConstants(value, 'android')).toEqual({
      ok: false,
      reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_CONSTANTS,
    });
  },
);

test.each([
  {
    field: 'implementationId',
    value: undefined,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_IMPLEMENTATION_ID,
  },
  {
    field: 'implementationId',
    value: 1,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_IMPLEMENTATION_ID,
  },
  {
    field: 'protocolMajor',
    value: undefined,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_PROTOCOL_MAJOR,
  },
  {
    field: 'protocolMajor',
    value: '1',
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_PROTOCOL_MAJOR,
  },
  {
    field: 'implementationVersion',
    value: undefined,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_IMPLEMENTATION_VERSION,
  },
  {
    field: 'implementationVersion',
    value: 13,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_IMPLEMENTATION_VERSION,
  },
  {
    field: 'platform',
    value: undefined,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_PLATFORM,
  },
  {
    field: 'platform',
    value: 1,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_PLATFORM,
  },
  {
    field: 'capabilities',
    value: undefined,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_CAPABILITIES,
  },
  {
    field: 'capabilities',
    value: 'navigation-decision-fail-closed-v1',
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_CAPABILITIES,
  },
] as const)(
  'rejects missing or wrongly typed $field',
  ({ field, value, reason }) => {
    const constants: Record<string, unknown> = validConstants('android');
    if (value === undefined) delete constants[field];
    else constants[field] = value;

    expect(validateNativeCapabilityConstants(constants, 'android')).toEqual({
      ok: false,
      reason,
    });
  },
);

test.each([
  {
    field: 'implementationId',
    value: 'com.example.untrusted',
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_IMPLEMENTATION_ID,
  },
  {
    field: 'protocolMajor',
    value: 2,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_PROTOCOL_MAJOR,
  },
  {
    field: 'implementationVersion',
    value: '13.16.1',
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_IMPLEMENTATION_VERSION,
  },
  {
    field: 'platform',
    value: 'ios',
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_PLATFORM,
  },
] as const)('rejects mismatched $field', ({ field, value, reason }) => {
  const constants: Record<string, unknown> = validConstants('android');
  constants[field] = value;

  expect(validateNativeCapabilityConstants(constants, 'android')).toEqual({
    ok: false,
    reason,
  });
});

test('rejects duplicate, empty, and non-string capabilities', () => {
  const duplicate = validConstants('android');
  duplicate.capabilities.push(duplicate.capabilities[0] as string);
  expect(validateNativeCapabilityConstants(duplicate, 'android')).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.DUPLICATE_CAPABILITY,
  });

  for (const capability of ['', 1, null]) {
    const constants: Record<string, unknown> = validConstants('android');
    constants.capabilities = [
      ...ANDROID_REQUIRED_NATIVE_CAPABILITIES,
      capability,
    ];
    expect(validateNativeCapabilityConstants(constants, 'android')).toEqual({
      ok: false,
      reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_CAPABILITY,
    });
  }
});

test.each(['android', 'ios'] as const)(
  'rejects a missing required %s capability',
  (platform) => {
    const constants = validConstants(platform);
    constants.capabilities.pop();

    expect(validateNativeCapabilityConstants(constants, platform)).toEqual({
      ok: false,
      reason: NATIVE_CAPABILITY_FAILURE_REASON.MISSING_REQUIRED_CAPABILITY,
    });
  },
);

test('rejects unknown requested platforms before reading native state', () => {
  const registry = registryWith(validConstants('android'));

  expect(validateNativeCapabilityConstants({}, 'windows')).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.UNSUPPORTED_PLATFORM,
  });
  expect(readNativeCapability('windows', registry)).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.UNSUPPORTED_PLATFORM,
  });
  expect(registry.get).not.toHaveBeenCalled();
});

test('validation and reading remain non-throwing for hostile values', () => {
  const throwingValue = new Proxy(
    {},
    {
      getPrototypeOf() {
        throw new Error('hostile constants');
      },
    },
  );
  const throwingModule = new Proxy(
    {},
    {
      get() {
        throw new Error('hostile module');
      },
    },
  );
  const throwingRegistry = Object.create(null) as {
    get(name: string): unknown;
  };
  Object.defineProperty(throwingRegistry, 'get', {
    get() {
      throw new Error('hostile registry');
    },
  });

  expect(() =>
    validateNativeCapabilityConstants(throwingValue, 'android'),
  ).not.toThrow();
  expect(validateNativeCapabilityConstants(throwingValue, 'android')).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.INVALID_CONSTANTS,
  });
  expect(() => readNativeCapability('android', throwingRegistry)).not.toThrow();
  expect(readNativeCapability('android', throwingRegistry)).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.REGISTRY_LOOKUP_FAILED,
  });
  expect(() =>
    readNativeCapability('android', { get: () => throwingModule }),
  ).not.toThrow();
  expect(
    readNativeCapability('android', { get: () => throwingModule }),
  ).toEqual({
    ok: false,
    reason: NATIVE_CAPABILITY_FAILURE_REASON.GET_CONSTANTS_UNAVAILABLE,
  });
});
