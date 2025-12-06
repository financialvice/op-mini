import { id as newId } from "@instantdb/core";
import type {
  InstantConfig,
  InstantReactAbstractDatabase,
  UpdateParams,
} from "@instantdb/react";
import { useEffect } from "react";
import type { AppSchema } from "./instant.schema";

/**
 * Binds the Instant client to a tiny facade we can share between platforms.
 * While the name mentions "db", the returned object exposes hooks, auth
 * helpers, and rendering guards that power the Expo protected routes flow.
 */
type InstantClient = InstantReactAbstractDatabase<
  AppSchema,
  InstantConfig<AppSchema, true>
>;

/**
 * Builds the platform-aware `db` facade by wiring shared hook factories to a
 * concrete InstantDB client. Each entry point (`index.ts` for web,
 * `index.native.ts` for React Native) calls this with its respective
 * initializer.
 */
export const createDb = <Client extends InstantClient>(client: Client) => {
  /**
   * Subscribes to the entire `$users` collection.
   *
   * @example
   * ```tsx
   * import { db } from "@repo/db";
   *
   * function UsersList() {
   *   const data = db.useUsers();
   *   return data?.$users?.map((user) => <div key={user.id}>{user.email}</div>);
   * }
   * ```
   */
  const useUsers = () => {
    const { data } = client.useQuery({
      $users: {},
    });

    return data;
  };

  /*
   * useNotificationTokens
   */
  const useNotificationTokens = () => {
    const { id } = client.useUser();
    const { data, isLoading, error } = client.useQuery({
      notificationTokens: {
        $: { where: { "$user.id": id } },
      },
    });

    return {
      tokens: data?.notificationTokens || [],
      isLoading,
      error,
    };
  };

  const registerNotificationToken = async (
    token: string,
    deviceId?: string,
    userId?: string | null
  ) => {
    if (!userId) {
      return;
    }

    await client.transact([
      client.tx.notificationTokens[newId()]!.create({
        token,
        deviceId: deviceId || undefined,
        createdAt: new Date(),
      }).link({
        $user: userId,
      }),
    ]);
  };

  const removeNotificationToken = (tokenId: string) => {
    client.transact([client.tx.notificationTokens[tokenId]!.delete()]);
  };

  const markNotificationAsRead = async (notificationId: string) => {
    if (!notificationId) {
      return;
    }

    await client.transact([
      client.tx.notifications[notificationId]!.update({
        readAt: new Date(),
      }),
    ]);
  };

  const markNotificationsAsRead = async (notificationIds: string[]) => {
    if (!notificationIds.length) {
      return;
    }

    await client.transact(
      notificationIds.map((notificationId) =>
        client.tx.notifications[notificationId]!.update({
          readAt: new Date(),
        })
      )
    );
  };

  const dismissNotification = async (notificationId: string) => {
    if (!notificationId) {
      return;
    }

    const now = new Date();
    await client.transact([
      client.tx.notifications[notificationId]!.update({
        readAt: now,
        dismissedAt: now,
      }),
    ]);
  };

  const dismissNotifications = async (notificationIds: string[]) => {
    if (!notificationIds.length) {
      return;
    }

    const now = new Date();

    await client.transact(
      notificationIds.map((notificationId) =>
        client.tx.notifications[notificationId]!.update({
          readAt: now,
          dismissedAt: now,
        })
      )
    );
  };

  /*
   * useNotificationsFeed
   */
  const useNotificationsFeed = () => {
    const { id } = client.useUser();
    const { data, isLoading, error } = client.useQuery({
      notifications: {
        $: {
          where: {
            "$user.id": id,
            dismissedAt: { $isNull: true },
          },
          order: { createdAt: "desc" as const },
          limit: 50,
        },
      },
    });

    const notifications = data?.notifications || [];
    const unreadCount = notifications.reduce((count, notification) => {
      if (notification.readAt) {
        return count;
      }

      return count + 1;
    }, 0);

    return {
      notifications,
      isLoading,
      error,
      unreadCount,
    };
  };

  /*
   * usePurchaseHistory
   */
  const usePurchaseHistory = () => {
    const { id } = client.useUser();
    const { data, isLoading, error } = client.useQuery({
      purchases: {
        $: {
          where: { "$user.id": id },
          order: { createdAt: "desc" as const },
        },
        product: {},
      },
    });

    return {
      purchases: data?.purchases || [],
      isLoading,
      error,
    };
  };

  const recordMobilePurchase = async (
    userId: string,
    purchase: {
      productId: string;
      transactionId: string;
      amount: number;
      currency: string;
      platform: "ios" | "android";
    }
  ) => {
    if (!userId) {
      return;
    }

    const purchaseId = newId();
    await client.transact([
      client.tx.purchases[purchaseId]!.create({
        productType: "fixed",
        amount: purchase.amount,
        currency: purchase.currency,
        platform: purchase.platform,
        provider: "revenuecat",
        status: "completed",
        providerTransactionId: purchase.transactionId,
        metadata: {
          productId: purchase.productId,
        },
        createdAt: new Date(),
        completedAt: new Date(),
      }).link({
        $user: userId,
      }),
    ]);

    return purchaseId;
  };

  /*
   * useUserProfile
   */
  const useUserProfile = () => {
    const { id } = client.useUser();
    const { data, isLoading, error } = client.useQuery({
      userProfiles: {
        $: { where: { "$user.id": id } },
        $user: {
          profile: {
            avatar$file: {},
          },
        },
      },
    });

    /*
     * we should NOT typically use `useEffect` like this
     * this is generally a poor pattern and we should find a better pattern
     */
    useEffect(() => {
      if (id && !isLoading && !error && !data?.userProfiles?.[0]) {
        client.transact([
          client.tx.userProfiles[newId()]!.create({
            firstName: "",
            lastName: "",
          }).link({
            $user: id,
          }),
        ]);
      }
    }, [
      data,
      isLoading,
      error,
      id,
      client.transact,
      client.tx.userProfiles[newId()]?.create,
    ]);

    const userProfile = data?.userProfiles?.[0];

    const updateUserProfile = ({
      firstName,
      lastName,
    }: UpdateParams<AppSchema, "userProfiles">) => {
      if (!userProfile?.id) {
        return;
      }

      client.transact([
        client.tx.userProfiles[userProfile.id]!.update({
          firstName: firstName || undefined,
          lastName: lastName || undefined,
        }),
      ]);
    };

    return {
      userProfile,
      isLoading,
      error,
      updateUserProfile,
      signOut: () => client.auth.signOut(),
    };
  };

  function SignedIn({ children }: { children: React.ReactNode }) {
    return <client.SignedIn>{children}</client.SignedIn>;
  }

  function SignedOut({ children }: { children: React.ReactNode }) {
    return <client.SignedOut>{children}</client.SignedOut>;
  }

  function Redirect({ onRedirect }: { onRedirect: () => void }) {
    useEffect(() => {
      onRedirect();
    }, [onRedirect]);

    return null;
  }

  function RedirectSignedOut({ onRedirect }: { onRedirect: () => void }) {
    return (
      <SignedOut>
        <Redirect onRedirect={onRedirect} />
      </SignedOut>
    );
  }

  function RedirectSignedIn({ onRedirect }: { onRedirect: () => void }) {
    return (
      <SignedIn>
        <Redirect onRedirect={onRedirect} />
      </SignedIn>
    );
  }

  return {
    useUsers,
    useAuth: () => client.useAuth(),
    useUser: () => client.useUser(),
    useUserProfile,
    useNotificationTokens,
    registerNotificationToken,
    removeNotificationToken,
    markNotificationAsRead,
    markNotificationsAsRead,
    dismissNotification,
    dismissNotifications,
    useNotificationsFeed,
    usePurchaseHistory,
    recordMobilePurchase,
    auth: client.auth,
    SignedIn: client.SignedIn,
    SignedOut: client.SignedOut,
    RedirectSignedOut,
    RedirectSignedIn,
    Redirect,
    getAuth: () => client.getAuth(),
    // Expose the raw client for devtools
    _client: client,
  };
};

export type Db = ReturnType<typeof createDb<InstantClient>>;
