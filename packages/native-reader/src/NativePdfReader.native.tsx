import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';

import type { NativeReaderProps, ReaderLoadState } from './types';
import { getPdfKitHost } from './pdf/pdfKitHost';
import { PdfReaderIOS } from './pdf/PdfReader.ios';

/** No WebView fallback: each PDF platform must supply its own proven host. */
export function NativePdfReader(props: NativeReaderProps) {
  const [Host] = useState(() =>
    Platform.OS === 'ios' ? getPdfKitHost() : null,
  );
  if (Host && props.source)
    return (
      <PdfReaderIOS
        key={`${props.source.uri}:${props.loadInactivityTimeoutMs ?? 15000}`}
        {...props}
        host={Host}
      />
    );
  return <UnsupportedPdfReader {...props} />;
}

function UnsupportedPdfReader(props: NativeReaderProps) {
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
