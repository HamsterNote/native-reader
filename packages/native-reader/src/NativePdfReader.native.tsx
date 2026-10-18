import { useEffect, useMemo } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import type { NativeReaderProps, ReaderLoadState } from './types';
import { getAndroidPdfHost } from './pdf/androidHost';

/** No WebView fallback: each PDF platform must supply its own proven host. */
export function NativePdfReader(props: NativeReaderProps) {
  const renderer = useMemo(() => {
    const host = Platform.OS === 'android' ? getAndroidPdfHost() : null;
    if (!host) return null;
    try {
      // Keep Expo and renderer code behind the selected native capability.
      const { PdfReaderAndroid } =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('./pdf/PdfReader.android') as typeof import('./pdf/PdfReader.android');
      return { host, Component: PdfReaderAndroid };
    } catch {
      return null;
    }
  }, []);
  if (renderer && props.source) {
    const { Component, host } = renderer;
    return <Component key={props.source.uri} {...props} host={host} />;
  }
  return <UnsupportedPdf {...props} />;
}

function UnsupportedPdf(props: NativeReaderProps) {
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
