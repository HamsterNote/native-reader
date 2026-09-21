import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';
import { Double, Int32 } from 'react-native/Libraries/Types/CodegenTypes';

export type NativeCapabilityConstants = Readonly<{
  implementationId: string;
  protocolMajor: Int32;
  implementationVersion: string;
  platform: string;
  capabilities: ReadonlyArray<string>;
}>;

export interface Spec extends TurboModule {
  getConstants(): NativeCapabilityConstants;
  isFileUploadSupported(): Promise<boolean>;
  shouldStartLoadWithLockIdentifier(
    shouldStart: boolean,
    lockIdentifier: Double
  ): void;
}

export default TurboModuleRegistry.getEnforcing<Spec>('HNSecureWebViewModule');
