const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.extraNodeModules = {
  ...config.resolver.extraNodeModules,
  '@hamster-note/native-reader': path.join(
    workspaceRoot,
    'packages/native-reader',
  ),
};

module.exports = config;
