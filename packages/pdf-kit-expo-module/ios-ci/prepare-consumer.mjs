import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';

export function prepareConsumer({ output, source, workspace }) {
  const consumer = path.join(output, 'consumer');
  mkdirSync(consumer);
  const ios = path.join(consumer, 'ios');
  mkdirSync(ios);
  const modules = path.join(consumer, 'node_modules');
  mkdirSync(modules);
  // Links only resolve dependencies; all generated files stay in the consumer.
  for (const entry of readdirSync(path.join(workspace, 'node_modules')))
    if (entry !== '@hamster-note')
      symlinkSync(
        path.join(workspace, 'node_modules', entry),
        path.join(modules, entry),
      );
  mkdirSync(path.join(modules, '@hamster-note'));
  symlinkSync(source, path.join(modules, '@hamster-note/pdfkit'));
  const version = (name) =>
    JSON.parse(
      readFileSync(
        path.join(workspace, 'node_modules', name, 'package.json'),
        'utf8',
      ),
    ).version;
  writeFileSync(
    path.join(consumer, 'package.json'),
    JSON.stringify(
      {
        name: 'pdfkit-policy-native-consumer',
        version: '1.0.0',
        private: true,
        dependencies: {
          expo: version('expo'),
          react: version('react'),
          'react-native': version('react-native'),
          '@hamster-note/pdfkit': `file:${path.relative(consumer, source)}`,
        },
      },
      null,
      2,
    ),
  );
  for (const file of ['Podfile', 'create-project.rb', 'verify-project.rb'])
    copyFileSync(path.join(source, 'ios-ci', file), path.join(ios, file));
  writeFileSync(
    path.join(ios, 'main.m'),
    '#import <UIKit/UIKit.h>\nint main(int argc, char *argv[]) { @autoreleasepool { return UIApplicationMain(argc, argv, nil, nil); } }\n',
  );
  return { consumer, ios };
}
