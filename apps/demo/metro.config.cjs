const path = require('node:path');
const fs = require('node:fs');

const { getDefaultConfig } = require('expo/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');
const config = getDefaultConfig(projectRoot);

const tlsCert = process.env.READER_DEV_TLS_CERT;
const tlsKey = process.env.READER_DEV_TLS_KEY;
if (tlsCert || tlsKey) {
  if (!tlsCert || !tlsKey)
    throw new Error('Set both READER_DEV_TLS_CERT and READER_DEV_TLS_KEY');
  config.server.tls = {
    cert: fs.readFileSync(tlsCert),
    key: fs.readFileSync(tlsKey),
  };
}

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
