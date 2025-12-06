import { init } from "@instantdb/admin";
import { id as newId } from "@instantdb/react";
import type Stripe from "stripe";
import schema from "./instant.schema";

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
   * Get all notification tokens for a specific user.
   */
  const getUserTokens = async (userId: string) => {
    const result = await db.query({
      notificationTokens: {
        $: { where: { "$user.id": userId } },
      },
    });

    return result.notificationTokens || [];
  };

  /**
   * Create a notification for a user.
   */
  const createNotification = async (
    userId: string,
    notification: {
      type: string;
      title: string;
      body: string;
      data?: Record<string, unknown>;
      readAt?: Date;
      dismissedAt?: Date;
      createdAt?: Date;
    }
  ) => {
    const notificationId = newId();
    await db.transact([
      db.tx.notifications[notificationId]!.create({
        type: notification.type,
        title: notification.title,
        body: notification.body,
        data: notification.data || undefined,
        createdAt: notification.createdAt ?? new Date(),
        readAt: notification.readAt ?? undefined,
        dismissedAt: notification.dismissedAt ?? undefined,
      }).link({
        $user: userId,
      }),
    ]);

    return notificationId;
  };

  /**
   * Record a delivery attempt for a notification.
   */
  const createNotificationDelivery = async (
    notificationId: string,
    delivery: {
      channel: string;
      status: string;
      target?: string;
      providerMessageId?: string;
      providerError?: string;
      deliveredAt?: Date;
      createdAt?: Date;
    }
  ) => {
    await db.transact([
      db.tx.notificationDeliveries[newId()]!.create({
        channel: delivery.channel,
        status: delivery.status,
        target: delivery.target || undefined,
        providerMessageId: delivery.providerMessageId || undefined,
        providerError: delivery.providerError || undefined,
        deliveredAt: delivery.deliveredAt ?? undefined,
        createdAt: delivery.createdAt ?? new Date(),
      }).link({
        notification: notificationId,
      }),
    ]);
  };

  /**
   * Count unread notifications for a user.
   */
  const getUnreadNotificationCount = async (userId: string) => {
    const result = await db.query({
      notifications: {
        $: {
          where: {
            "$user.id": userId,
            readAt: { $isNull: true },
            dismissedAt: { $isNull: true },
          },
        },
      },
    });

    return result.notifications?.length ?? 0;
  };

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

  /**
   * Create a purchase record for a user.
   */
  const createPurchase = async (
    userId: string,
    purchase: {
      productType: "fixed" | "custom";
      amount: number;
      currency: string;
      platform: "web" | "ios" | "android";
      provider: "stripe" | "revenuecat";
      status: "pending" | "completed" | "failed";
      providerTransactionId?: string;
      metadata?: Record<string, unknown>;
      productId?: string;
      createdAt?: Date;
      completedAt?: Date;
    }
  ) => {
    const purchaseId = newId();
    const txs = [
      db.tx.purchases[purchaseId]!.create({
        productType: purchase.productType,
        amount: purchase.amount,
        currency: purchase.currency,
        platform: purchase.platform,
        provider: purchase.provider,
        status: purchase.status,
        providerTransactionId: purchase.providerTransactionId || undefined,
        metadata: purchase.metadata || undefined,
        createdAt: purchase.createdAt ?? new Date(),
        completedAt:
          purchase.completedAt ??
          (purchase.status === "completed" ? new Date() : undefined),
      }).link({
        $user: userId,
      }),
    ];

    // Link to product if provided
    if (purchase.productId) {
      txs.push(
        db.tx.purchases[purchaseId]!.link({
          product: purchase.productId,
        })
      );
    }

    await db.transact(txs);

    return purchaseId;
  };

  /**
   * Update purchase status (e.g., from pending to completed).
   */
  const updatePurchaseStatus = async (
    purchaseId: string,
    status: "pending" | "completed" | "failed",
    providerTransactionId?: string
  ) => {
    await db.transact([
      db.tx.purchases[purchaseId]!.update({
        status,
        providerTransactionId: providerTransactionId || undefined,
        completedAt: status === "completed" ? new Date() : undefined,
      }),
    ]);
  };

  /**
   * Get all purchases for a user.
   */
  const getUserPurchases = async (userId: string) => {
    const result = await db.query({
      purchases: {
        $: {
          where: { "$user.id": userId },
          order: { createdAt: "desc" },
        },
        product: {},
      },
    });

    return result.purchases || [];
  };

  /**
   * Get or create a Stripe customer ID for a user.
   * Stores it in the purchase metadata for future reference.
   */
  const getOrCreateStripeCustomerId = async (
    userId: string,
    email: string,
    stripe: Stripe
  ): Promise<string> => {
    // Try to find existing customer ID from previous purchases
    const result = await db.query({
      purchases: {
        $: {
          where: {
            "$user.id": userId,
            provider: "stripe",
          },
          limit: 1,
        },
      },
    });

    const existingPurchase = result.purchases?.[0];
    const existingCustomerId = existingPurchase?.metadata?.stripeCustomerId as
      | string
      | undefined;

    if (existingCustomerId) {
      return existingCustomerId;
    }

    // Create new customer
    const customer = await stripe.customers.create({
      email,
      metadata: {
        instantUserId: userId,
      },
    });

    return customer.id;
  };

  return {
    db,
    getUserTokens,
    createNotification,
    createNotificationDelivery,
    getUnreadNotificationCount,
    getUserByEmail,
    createPurchase,
    updatePurchaseStatus,
    getUserPurchases,
    getOrCreateStripeCustomerId,
  };
};

export const adminDb = createAdminDb();
