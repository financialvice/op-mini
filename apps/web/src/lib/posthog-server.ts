import { PostHog } from "posthog-node";

/**
 * PostHog server-side client factory
 * Use this to capture events and evaluate feature flags on the server
 *
 * @example
 * ```ts
 * const posthog = PostHogClient()
 * const flags = await posthog.getAllFlags('user_distinct_id')
 * await posthog.shutdown() // Always call shutdown after use
 * ```
 */
export default function PostHogClient() {
  const posthogClient = new PostHog(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
    host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    flushAt: 1,
    flushInterval: 0,
  });
  return posthogClient;
}
