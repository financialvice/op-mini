import path from "node:path";
import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * we have enabled the following experimental features to improve type safety and logging visibility.
   */
  experimental: {
    /**
     * enable debug information to be forwarded from browser to dev server stdout/stderr
     */
    browserDebugInfoInTerminal: true,
    /**
     * enable type-checking and autocompletion for environment variables.
     */
    typedEnv: true,
  },
  /**
   * generate Route types and enable type checking for Link and Router.push, etc.
   * @see https://nextjs.org/docs/app/api-reference/next-config-js/typedRoutes
   */
  typedRoutes: true,
  /**
   * this is required to isolate lockfile resolution to the context of the monorepo
   * without this, we receive the message:
   * ```
   * Warning: Found multiple lockfiles. Selecting /[EXTERNAL_PATH]/bun.lock
   * Consider removing the lockfiles at:
   * \* /[MONOREPO_ROOT]/bun.lock
   * ```
   * we prefer to use our monorepo's lockfile over the external one
   */
  outputFileTracingRoot: path.resolve(__dirname, "../.."),
};

export default withSentryConfig(nextConfig, {
  // For all available options, see:
  // https://www.npmjs.com/package/@sentry/webpack-plugin#options

  org: "cam-glynn",

  project: "camono",

  // Only print logs for uploading source maps in CI
  silent: !process.env.CI,

  // For all available options, see:
  // https://docs.sentry.io/platforms/javascript/guides/nextjs/manual-setup/

  // Upload a larger set of source maps for prettier stack traces (increases build time)
  widenClientFileUpload: true,

  // Route browser requests to Sentry through a Next.js rewrite to circumvent ad-blockers.
  // This can increase your server load as well as your hosting bill.
  // Note: Check that the configured route will not match with your Next.js middleware, otherwise reporting of client-
  // side errors will fail.
  tunnelRoute: "/monitoring",

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableLogger: true,

  // Enables automatic instrumentation of Vercel Cron Monitors. (Does not yet work with App Router route handlers.)
  // See the following for more information:
  // https://docs.sentry.io/product/crons/
  // https://vercel.com/docs/cron-jobs
  automaticVercelMonitors: true,
});
