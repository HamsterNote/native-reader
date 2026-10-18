import { useEffect, useState, type ComponentType } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import {
  readNativeCapability,
  type NativeCapabilityFailureReason,
} from './nativeCapability';
import type { NativeReaderProps, ReaderLoadState } from './types';

type GateFailureReason =
  NativeCapabilityFailureReason | 'implementation-load-failed';

type GateState =
  | {
      ok: true;
      Implementation: ComponentType<NativeReaderProps>;
    }
  | {
      ok: false;
      reason: GateFailureReason;
    };

function loadImplementation(): GateState {
  const capability = readNativeCapability(Platform.OS);
  if (!capability.ok) return capability;

  try {
    // The renderer and its WebView dependencies must only enter the graph after
    // the native security ABI has been validated for this mounted reader.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const implementation = require('./NativeReaderImplementation.native') as {
      NativeReaderImplementation?: ComponentType<NativeReaderProps>;
    };
    if (typeof implementation.NativeReaderImplementation !== 'function') {
      return { ok: false, reason: 'implementation-load-failed' };
    }
    return {
      ok: true,
      Implementation: implementation.NativeReaderImplementation,
    };
  } catch {
    return { ok: false, reason: 'implementation-load-failed' };
  }
}

function CapabilityError({
  props,
  reason,
}: {
  props: NativeReaderProps;
  reason: GateFailureReason;
}) {
  const message = `The native reader security capability is unavailable (${reason}).`;

  useEffect(() => {
    const state: ReaderLoadState = {
      status: 'error',
      error: {
        category: 'unsupported',
        code: 'NATIVE_CAPABILITY_UNAVAILABLE',
        message,
      },
    };
    props.onStateChange?.(state);
  }, [message, props.onStateChange]);

  return (
    <View style={[styles.root, props.style]} testID={props.testID}>
      <View accessibilityRole="alert">
        <Text>{message}</Text>
        <Text>NATIVE_CAPABILITY_UNAVAILABLE</Text>
      </View>
    </View>
  );
}

export function NativeReader(props: NativeReaderProps) {
  // A lazy component state initializer avoids native lookup during module
  // evaluation and keeps the result stable across re-renders of this mount.
  const [gate] = useState<GateState>(loadImplementation);
  if (!gate.ok) return <CapabilityError props={props} reason={gate.reason} />;

  const { Implementation } = gate;
  return <Implementation {...props} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, minHeight: 320 },
});
