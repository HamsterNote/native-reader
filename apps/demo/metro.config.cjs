const path = require('node:path');

const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

config.watchFolders = [workspaceRoot];
config.resolver.resolveRequest = (context, moduleName, platform) => {
  // Resolve the public source entry by platform in this workspace. A directory
  // alias lets the package's browser/main fields select index.web on native
  // when lib has not been built yet. Installed consumers use package exports.
  const entry =
    moduleName === '@hamster-note/native-reader'
      ? path.join(workspaceRoot, 'packages/native-reader/src/index')
      : moduleName;
  return context.resolveRequest(context, entry, platform);
};

module.exports = config;
