import { registerRootComponent } from 'expo';

if (
  typeof location !== 'undefined' &&
  location.pathname === '/diagnostics-consumer.html'
) {
  void import('./src/DiagnosticsConsumer').then(({ DiagnosticsConsumer }) =>
    registerRootComponent(DiagnosticsConsumer),
  );
} else {
  void import('./src/DemoApp').then(({ DemoApp }) =>
    registerRootComponent(DemoApp),
  );
}
