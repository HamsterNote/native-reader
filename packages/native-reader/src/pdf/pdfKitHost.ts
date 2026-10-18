import type { ComponentType, Ref } from 'react';
import type { ViewProps } from 'react-native';

export type PdfKitHandle = {
  command(value: Record<string, unknown>): Promise<unknown>;
};
export type PdfKitViewProps = ViewProps & {
  ref?: Ref<PdfKitHandle>;
  onPdfEvent(event: { nativeEvent: unknown }): void;
};

/** Native registration is the boundary; no static import of an optional package. */
export function getPdfKitHost(): ComponentType<PdfKitViewProps> | null {
  try {
    // Resolve Expo only after selecting iOS, keeping missing-host tests inert.
    const { requireOptionalNativeModule, requireNativeView } =
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('expo') as typeof import('expo');
    const module = requireOptionalNativeModule<{
      capability?: {
        protocol?: unknown;
        version?: unknown;
        maxBytes?: unknown;
        readyAfterDraw?: unknown;
      };
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
