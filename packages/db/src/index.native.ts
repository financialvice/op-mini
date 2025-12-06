import { init } from "@instantdb/react-native";
import { createDb } from "./create-db";
import schema from "./instant.schema";

export { id } from "@instantdb/react-native";

/**
 * React Native entry point that binds the shared Instant client facade to
 * Instant's native SDK. Metro resolves this file thanks to the `react-native`
 * export condition.
 */
const createNativeDb = () => {
  const appId = process.env.EXPO_PUBLIC_INSTANT_APP_ID!;
  const client = init({
    appId,
    schema,
    useDateObjects: true,
  });

  return createDb(client);
};

export const db = createNativeDb();
export type NativeDb = typeof db;
