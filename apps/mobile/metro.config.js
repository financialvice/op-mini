const { withUniwindConfig } = require("uniwind/metro");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const {
  withStorybook,
} = require("@storybook/react-native/metro/withStorybook");

const config = getSentryExpoConfig(__dirname);

module.exports = withUniwindConfig(withStorybook(config), {
  cssEntryFile: "./src/globals.css",
  dtsFile: "./src/uniwind-types.d.ts",
});
