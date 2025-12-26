import { init } from "@instantdb/admin";
import schema from "./instant.schema";

export { id } from "@instantdb/admin";

/**
 * Server-side InstantDB admin client.
 * Use this in tRPC routes, API routes, or any server-side code.
 * Unlike the React clients, this uses direct .query() and .transact() methods.
 */
const createAdminDb = () => {
  const appId = process.env.NEXT_PUBLIC_INSTANT_APP_ID!;
  const adminToken = process.env.INSTANT_APP_ADMIN_TOKEN!;

  const db = init({
    appId,
    schema,
    adminToken,
    useDateObjects: true,
  });

  /**
   * Get user by email address.
   */
  const getUserByEmail = async (email: string) => {
    const result = await db.query({
      $users: {
        $: {
          where: {
            email,
          },
        },
      },
    });

    return result.$users?.[0];
  };

  return {
    db,
    getUserByEmail,
  };
};

export const adminDb = createAdminDb();
