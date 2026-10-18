import type { ComponentType, RefAttributes } from 'react';
import {
  requireNativeComponent,
  UIManager,
  type NativeSyntheticEvent,
  type ViewProps,
} from 'react-native';

export type AndroidPdfHandle = {
  setNativeProps(value: { command: string }): void;
};
export type AndroidPdfHostProps = ViewProps & {
  configuration: string;
  onPdfMessage(event: NativeSyntheticEvent<{ data: string }>): void;
};
export type AndroidPdfHost = ComponentType<
  AndroidPdfHostProps & RefAttributes<AndroidPdfHandle>
>;

/** Legacy view interoperability remains optional; missing native builds fail before full I/O. */
export function getAndroidPdfHost(): AndroidPdfHost | null {
  try {
    const manager = UIManager.getViewManagerConfig('HNPdfView') as
      | (Record<string, unknown> & { Constants?: Record<string, unknown> })
      | null;
    const constants = manager?.Constants ?? manager;
    if (
      constants?.pdfProtocolVersion !== 1 ||
      constants?.maxPdfBytes !== 32 * 1024 * 1024 ||
      constants?.privatePdfPort !== true ||
      constants?.readyAfterDraw !== true
    )
      return null;
    return requireNativeComponent<AndroidPdfHostProps>(
      'HNPdfView',
    ) as unknown as AndroidPdfHost;
  } catch {
    return null;
  }
}
