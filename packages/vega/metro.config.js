const path = require('path');
const {getDefaultConfig, mergeConfig} = require('@react-native/metro-config');

const sharedRoot = path.resolve(__dirname, '../shared');
const escapeForRegExp = (p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Metro configuration
 * https://facebook.github.io/metro/docs/configuration
 *
 * @type {import('metro-config').MetroConfig}
 */
const config = {
  watchFolders: [sharedRoot],
  resolver: {
    // The shared package has its own devDependencies (react, for its tests and
    // typechecking). Block them so a second copy of React is never bundled.
    blockList: [new RegExp(`${escapeForRegExp(path.join(sharedRoot, 'node_modules'))}/.*`)],
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    extraNodeModules: {
      '@command-center/shared': path.join(sharedRoot, 'src'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
