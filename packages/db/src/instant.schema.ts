// Docs: https://www.instantdb.com/docs/modeling-data

/*
 * important modeling concepts:
 * - `i.json` attributes are NOT strongly typed or validated by the DB (they are basically type any)
 * - all attributes are required by default
 * - links CANNOT carry information (attributes)
 * - links are NOT ordered; we CANNOT assume that the order links are added / modified will be preserved
 * - `.indexed` is required to use `order` or comparison operators in queries (e.g. `$gt`, `$lt`, `$gte`, `$lte`, `$ne`, `$isNull`, and `$like` operators)
 * - `.unique` is required to use `lookup(attribute, value)` in place of an id
 */

import { i } from "@instantdb/core";

const _schema = i.schema({
  entities: {
    $files: i.entity({
      path: i.string().unique().indexed(),
      url: i.string(),
    }),
    $users: i.entity({
      email: i.string().unique().indexed().optional(),
    }),
    /*
     * We CANNOT add ATTRIBUTES to the '$users' entity (it is a special system-level entity)
     *
     * To add user-specific attributes (tied 1:1 with a $user), we can add attributes to our own userProfiles entity.
     *
     * We CAN add LINKS to the '$users' entity, so when linking to the concept of a 'user', we should link to '$users', NOT 'userProfiles'.
     */
    userProfiles: i.entity({
      firstName: i.string(),
      lastName: i.string(),
    }),
    notificationTokens: i.entity({
      token: i.string().unique().indexed(),
      deviceId: i.string().optional(),
      createdAt: i.date().indexed(),
    }),
    notifications: i.entity({
      type: i.string().indexed(),
      title: i.string(),
      body: i.string(),
      data: i.json().optional(),
      createdAt: i.date().indexed(),
      readAt: i.date().optional(),
      dismissedAt: i.date().optional(),
    }),
    notificationDeliveries: i.entity({
      channel: i.string().indexed(),
      status: i.string(),
      target: i.string().optional(),
      providerMessageId: i.string().optional(),
      providerError: i.string().optional(),
      createdAt: i.date().indexed(),
      deliveredAt: i.date().optional(),
    }),
    products: i.entity({
      name: i.string(),
      description: i.string(),
      price: i.number().optional(), // null for custom amount products
      currency: i.string(), // e.g. "usd"
      sku: i.string().unique().indexed(),
      platform: i.string().indexed(), // "web" | "mobile" | "both"
      active: i.boolean().indexed(),
      createdAt: i.date().indexed(),
    }),
    purchases: i.entity({
      productType: i.string().indexed(), // "fixed" | "custom"
      amount: i.number(), // amount in cents
      currency: i.string(), // e.g. "usd"
      platform: i.string().indexed(), // "web" | "ios" | "android"
      provider: i.string().indexed(), // "stripe" | "revenuecat"
      status: i.string().indexed(), // "pending" | "completed" | "failed"
      providerTransactionId: i.string().optional(),
      metadata: i.json().optional(), // additional provider-specific data
      createdAt: i.date().indexed(),
      completedAt: i.date().optional(),
    }),
  },
  links: {
    // each user has exactly one profile
    userProfile_user$: {
      forward: {
        on: "userProfiles",
        label: "$user",
        has: "one",
        required: true,
      },
      reverse: { on: "$users", label: "profile", has: "one" },
    },

    // each profile may have one avatar file
    userProfile_avatar$file: {
      forward: { on: "userProfiles", label: "avatar$file", has: "one" },
      reverse: { on: "$files", label: "avatarOfUserProfile", has: "one" },
    },

    // each user can have many notification tokens (multiple devices)
    notificationToken_user$: {
      forward: {
        on: "notificationTokens",
        label: "$user",
        has: "one",
        required: true,
      },
      reverse: { on: "$users", label: "notificationTokens", has: "many" },
    },

    // each user can have many notifications
    notification_user$: {
      forward: {
        on: "notifications",
        label: "$user",
        has: "one",
        required: true,
      },
      reverse: { on: "$users", label: "notifications", has: "many" },
    },

    // each notification can have many deliveries
    notificationDelivery_notification: {
      forward: {
        on: "notificationDeliveries",
        label: "notification",
        has: "one",
        required: true,
      },
      reverse: {
        on: "notifications",
        label: "deliveries",
        has: "many",
      },
    },

    // each purchase belongs to a user
    purchase_user$: {
      forward: {
        on: "purchases",
        label: "$user",
        has: "one",
        required: true,
      },
      reverse: { on: "$users", label: "purchases", has: "many" },
    },

    // each purchase optionally links to a product (null for custom amounts)
    purchase_product: {
      forward: {
        on: "purchases",
        label: "product",
        has: "one",
      },
      reverse: { on: "products", label: "purchases", has: "many" },
    },
  },
  rooms: {},
});

// this helps TypeScript display nicer intellisense
type _AppSchema = typeof _schema;
interface AppSchema extends _AppSchema {}
const schema: AppSchema = _schema;

export type { AppSchema };
export default schema;
