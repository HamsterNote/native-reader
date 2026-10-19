import { registerRootComponent } from 'expo';
import { DemoApp } from './src/DemoApp';
import { DiagnosticsConsumer } from './src/DiagnosticsConsumer';

registerRootComponent(
  typeof location !== 'undefined' &&
    location.pathname === '/diagnostics-consumer.html'
    ? DiagnosticsConsumer
    : DemoApp,
);
