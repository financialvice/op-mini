import { init } from "@instantdb/react";
import { createDb } from "./create-db";
import schema from "./instant.schema";

export { id } from "@instantdb/react";

/**
 * Web entry point that wires the shared Instant client facade to the browser
 * SDK. Next.js will resolve this file by default while Expo picks up
 * `index.native.ts`.
 */
const createWebDb = () => {
  const appId =
    process.env.NEXT_PUBLIC_INSTANT_APP_ID ??
    process.env.EXPO_PUBLIC_INSTANT_APP_ID!;
  const client = init({
    appId,
    schema,
    useDateObjects: true,
    devtool: false,
  });

  return createDb(client);
};

export const db = createWebDb();
export type WebDb = typeof db;
export type { AppSchema } from "./instant.schema";
