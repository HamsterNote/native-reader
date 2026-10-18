import { useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import type { NativeReaderProps, ReaderLoadState } from './types';

/** No WebView fallback: each PDF platform must supply its own proven host. */
export function NativePdfReader(props: NativeReaderProps) {
  useEffect(() => {
    const state: ReaderLoadState = {
      status: 'error',
      error: {
        category: 'unsupported',
        code: 'PDF_CAPABILITY_UNAVAILABLE',
        message: 'The native PDF renderer is unavailable in this build.',
      },
    };
    props.onStateChange?.(state);
  }, [props.onStateChange]);
  return (
    <View style={[styles.root, props.style]} testID={props.testID}>
      <Text accessibilityRole="alert">PDF_CAPABILITY_UNAVAILABLE</Text>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1, minHeight: 320 } });
