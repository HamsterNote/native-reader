export const NATIVE_CAPABILITY_MODULE_NAME = 'HNSecureWebViewModule';
export const NATIVE_CAPABILITY_IMPLEMENTATION_ID =
  'com.hamsternote.nativereader.securewebview';
export const NATIVE_CAPABILITY_PROTOCOL_MAJOR = 1;
export const NATIVE_CAPABILITY_IMPLEMENTATION_VERSION = '13.16.1-hamsternote.1';

export const ANDROID_REQUIRED_NATIVE_CAPABILITIES = [
  'navigation-decision-fail-closed-v1',
  'main-frame-native-gate-v1',
  'subframe-local-root-deny-v1',
  'late-callback-safe-v1',
  'native-foliate-host-v1',
] as const;

export const IOS_REQUIRED_NATIVE_CAPABILITIES = [
  'navigation-decision-fail-closed-v1',
  'main-frame-native-gate-v1',
  'subframe-local-root-deny-v1',
  'late-callback-safe-v1',
  'native-foliate-host-v1',
] as const;

export const NATIVE_CAPABILITY_FAILURE_REASON = {
  UNSUPPORTED_PLATFORM: 'unsupported-platform',
  INVALID_CONSTANTS: 'invalid-constants',
  INVALID_IMPLEMENTATION_ID: 'invalid-implementation-id',
  INVALID_PROTOCOL_MAJOR: 'invalid-protocol-major',
  INVALID_IMPLEMENTATION_VERSION: 'invalid-implementation-version',
  INVALID_PLATFORM: 'invalid-platform',
  INVALID_CAPABILITIES: 'invalid-capabilities',
  INVALID_CAPABILITY: 'invalid-capability',
  DUPLICATE_CAPABILITY: 'duplicate-capability',
  MISSING_REQUIRED_CAPABILITY: 'missing-required-capability',
  REGISTRY_UNAVAILABLE: 'registry-unavailable',
  REGISTRY_LOOKUP_FAILED: 'registry-lookup-failed',
  MODULE_UNAVAILABLE: 'module-unavailable',
  GET_CONSTANTS_UNAVAILABLE: 'get-constants-unavailable',
  GET_CONSTANTS_FAILED: 'get-constants-failed',
} as const;

export type NativeCapabilityFailureReason =
  (typeof NATIVE_CAPABILITY_FAILURE_REASON)[keyof typeof NATIVE_CAPABILITY_FAILURE_REASON];

export type NativeCapabilityPlatform = 'android' | 'ios';

export type NativeCapabilityConstants = {
  implementationId: string;
  protocolMajor: number;
  implementationVersion: string;
  platform: NativeCapabilityPlatform;
  capabilities: string[];
};

export type NativeCapabilityResult =
  | { ok: true; constants: NativeCapabilityConstants }
  | { ok: false; reason: NativeCapabilityFailureReason };

export type NativeCapabilityRegistry = {
  get(name: string): unknown;
};

type ConstantsRecord = Record<string, unknown>;

function failure(
  reason: NativeCapabilityFailureReason,
): NativeCapabilityResult {
  return { ok: false, reason };
}

function isPlainObject(value: unknown): value is ConstantsRecord {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataValue(
  value: ConstantsRecord,
  field: keyof NativeCapabilityConstants,
): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(value, field);
  return descriptor && 'value' in descriptor ? descriptor.value : undefined;
}

function requiredCapabilities(
  platform: NativeCapabilityPlatform,
): readonly string[] {
  return platform === 'android'
    ? ANDROID_REQUIRED_NATIVE_CAPABILITIES
    : IOS_REQUIRED_NATIVE_CAPABILITIES;
}

/**
 * Validates the native security ABI without mutating or trusting its input.
 * Every reflective/property operation is guarded so malformed host objects
 * produce a stable failure instead of escaping into application startup.
 */
export function validateNativeCapabilityConstants(
  value: unknown,
  platform: unknown,
): NativeCapabilityResult {
  try {
    if (platform !== 'android' && platform !== 'ios') {
      return failure(NATIVE_CAPABILITY_FAILURE_REASON.UNSUPPORTED_PLATFORM);
    }
    if (!isPlainObject(value)) {
      return failure(NATIVE_CAPABILITY_FAILURE_REASON.INVALID_CONSTANTS);
    }

    const implementationId = ownDataValue(value, 'implementationId');
    if (implementationId !== NATIVE_CAPABILITY_IMPLEMENTATION_ID) {
      return failure(
        NATIVE_CAPABILITY_FAILURE_REASON.INVALID_IMPLEMENTATION_ID,
      );
    }

    const protocolMajor = ownDataValue(value, 'protocolMajor');
    if (protocolMajor !== NATIVE_CAPABILITY_PROTOCOL_MAJOR) {
      return failure(NATIVE_CAPABILITY_FAILURE_REASON.INVALID_PROTOCOL_MAJOR);
    }

    const implementationVersion = ownDataValue(value, 'implementationVersion');
    if (implementationVersion !== NATIVE_CAPABILITY_IMPLEMENTATION_VERSION) {
      return failure(
        NATIVE_CAPABILITY_FAILURE_REASON.INVALID_IMPLEMENTATION_VERSION,
      );
    }

    const nativePlatform = ownDataValue(value, 'platform');
    if (nativePlatform !== platform) {
      return failure(NATIVE_CAPABILITY_FAILURE_REASON.INVALID_PLATFORM);
    }

    const capabilities = ownDataValue(value, 'capabilities');
    if (!Array.isArray(capabilities)) {
      return failure(NATIVE_CAPABILITY_FAILURE_REASON.INVALID_CAPABILITIES);
    }

    const uniqueCapabilities = new Set<string>();
    for (const capability of capabilities) {
      if (typeof capability !== 'string' || capability.length === 0) {
        return failure(NATIVE_CAPABILITY_FAILURE_REASON.INVALID_CAPABILITY);
      }
      if (uniqueCapabilities.has(capability)) {
        return failure(NATIVE_CAPABILITY_FAILURE_REASON.DUPLICATE_CAPABILITY);
      }
      uniqueCapabilities.add(capability);
    }

    for (const capability of requiredCapabilities(platform)) {
      if (!uniqueCapabilities.has(capability)) {
        return failure(
          NATIVE_CAPABILITY_FAILURE_REASON.MISSING_REQUIRED_CAPABILITY,
        );
      }
    }

    return {
      ok: true,
      constants: {
        implementationId,
        protocolMajor,
        implementationVersion,
        platform,
        capabilities: [...capabilities],
      },
    };
  } catch {
    return failure(NATIVE_CAPABILITY_FAILURE_REASON.INVALID_CONSTANTS);
  }
}

function readDefaultRegistry(): NativeCapabilityRegistry | undefined {
  try {
    // Keep React Native and its registry lookup out of module evaluation so
    // importing shared/web code cannot probe a native runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const reactNative = require('react-native') as {
      TurboModuleRegistry?: NativeCapabilityRegistry;
    };
    return reactNative.TurboModuleRegistry;
  } catch {
    return undefined;
  }
}

/** Reads and validates the optional native module through non-enforcing get(). */
export function readNativeCapability(
  platform: unknown,
  registry?: NativeCapabilityRegistry,
): NativeCapabilityResult {
  if (platform !== 'android' && platform !== 'ios') {
    return failure(NATIVE_CAPABILITY_FAILURE_REASON.UNSUPPORTED_PLATFORM);
  }

  const activeRegistry = registry ?? readDefaultRegistry();
  if (!activeRegistry) {
    return failure(NATIVE_CAPABILITY_FAILURE_REASON.REGISTRY_UNAVAILABLE);
  }

  let registryGet: unknown;
  try {
    registryGet = activeRegistry.get;
  } catch {
    return failure(NATIVE_CAPABILITY_FAILURE_REASON.REGISTRY_LOOKUP_FAILED);
  }
  if (typeof registryGet !== 'function') {
    return failure(NATIVE_CAPABILITY_FAILURE_REASON.REGISTRY_UNAVAILABLE);
  }

  let nativeModule: unknown;
  try {
    nativeModule = registryGet.call(
      activeRegistry,
      NATIVE_CAPABILITY_MODULE_NAME,
    );
  } catch {
    return failure(NATIVE_CAPABILITY_FAILURE_REASON.REGISTRY_LOOKUP_FAILED);
  }

  if (
    nativeModule === null ||
    (typeof nativeModule !== 'object' && typeof nativeModule !== 'function')
  ) {
    return failure(NATIVE_CAPABILITY_FAILURE_REASON.MODULE_UNAVAILABLE);
  }

  let getConstants: unknown;
  try {
    getConstants = (nativeModule as { getConstants?: unknown }).getConstants;
  } catch {
    return failure(NATIVE_CAPABILITY_FAILURE_REASON.GET_CONSTANTS_UNAVAILABLE);
  }
  if (typeof getConstants !== 'function') {
    return failure(NATIVE_CAPABILITY_FAILURE_REASON.GET_CONSTANTS_UNAVAILABLE);
  }

  let constants: unknown;
  try {
    constants = getConstants.call(nativeModule);
  } catch {
    return failure(NATIVE_CAPABILITY_FAILURE_REASON.GET_CONSTANTS_FAILED);
  }
  return validateNativeCapabilityConstants(constants, platform);
}
