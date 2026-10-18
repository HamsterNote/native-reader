import { requireNativeView, requireOptionalNativeModule } from 'expo';
import type { ComponentType, Ref } from 'react';
import type { ViewProps } from 'react-native';

export type PdfKitViewRef = {
  command(value: Record<string, unknown>): Promise<unknown>;
};
export type PdfKitViewProps = ViewProps & {
  ref?: Ref<PdfKitViewRef>;
  onPdfEvent(event: { nativeEvent: unknown }): void;
};
export type PdfKitCapability = {
  protocol: 'hamster-pdf';
  version: 1;
  maxBytes: number;
  readyAfterDraw: true;
};

/** Absence is supported (including Expo Go). Never import a WebView fallback. */
export function getPdfKitView(): ComponentType<PdfKitViewProps> | null {
  try {
    const module = requireOptionalNativeModule<{
      capability: PdfKitCapability;
    }>('HamsterPdfKit');
    const value = module?.capability;
    return value?.protocol === 'hamster-pdf' &&
      value.version === 1 &&
      value.maxBytes === 32 * 1024 * 1024 &&
      value.readyAfterDraw === true
      ? requireNativeView<PdfKitViewProps>('HamsterPdfKit')
      : null;
  } catch {
    return null;
  }
}
