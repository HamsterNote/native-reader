module.exports = {
  dependencies: {
    // This is a bare RN fixture. Keep Expo packages available to satisfy the
    // published peer/dependency contract, but do not require Expo prebuild's
    // Gradle plugin for the HNSecureWebView Android integration build.
    expo: { platforms: { android: null } },
    'expo-file-system': { platforms: { android: null } },
    'expo-modules-core': { platforms: { android: null } },
  },
};
