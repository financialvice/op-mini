# packages/db - InstantDB Layer

## Overview

The `@repo/db` package is the centralized database layer for the entire application. It provides:
- **InstantDB integration** (a real-time, end-to-end encrypted database)
- **Platform-specific exports** (web via React, mobile via React Native)
- **Server-side admin client** for tRPC routes and webhooks
- **Unified schema** across all platforms
- **Type-safe database operations** with full TypeScript support

## Architecture

### Platform-Specific Exports

This package uses **conditional exports** in `package.json` to serve different implementations:

```json
{
  "exports": {
    ".": {
      "react-native": "./src/index.native.ts",  // Expo/React Native
      "default": "./src/index.ts"               // Web (Next.js)
    },
    "./admin": "./src/admin.ts"                 // Server-side
  }
}
```

When consumers import `@repo/db`:
- **Web apps** resolve to `index.ts` (uses `@instantdb/react`)
- **Mobile apps** resolve to `index.native.ts` (uses `@instantdb/react-native`)
- **Server code** imports from `@repo/db/admin` explicitly

### Facade Pattern

All platforms use a **shared facade** created by `createDb()`:
- `index.ts` and `index.native.ts` initialize their respective SDK and call `createDb()`
- This returns a unified `db` object with consistent hooks and methods
- The facade is thin and handles only common operations

## Key Files

- **`instant.schema.ts`** - Complete InstantDB schema definition with entities, relationships, and attributes
- **`index.ts`** - Web entry point; initializes InstantDB React client
- **`index.native.ts`** - React Native entry point; initializes InstantDB React Native client
- **`create-db.tsx`** - Facade factory that creates the shared `db` object
- **`admin.ts`** - Server-side admin client with helper functions for notifications, purchases, and user queries
- **`instant.perms.ts`** - Permission rules (currently empty; see InstantDB docs)
- **`tsconfig.json`** - TypeScript configuration

## Database Schema

The schema in `instant.schema.ts` defines:

### Core Entities
- **`$users`** - System entity (managed by InstantDB auth)
- **`userProfiles`** - User metadata (firstName, lastName)
- **`$files`** - File storage with unique paths
- **`notifications`** - User notifications with read/dismiss tracking
- **`notificationTokens`** - Push notification device tokens
- **`notificationDeliveries`** - Delivery attempt records
- **`products`** - Sellable products (web/mobile/both)
- **`purchases`** - Purchase transactions (Stripe/RevenueCat)

### Key Relationships
- Each user has exactly one profile
- Each user can have many notification tokens (multiple devices)
- Each user can have many notifications
- Each notification can have many delivery records
- Each user can have many purchases
- Purchases optionally link to products

**Important schema notes:**
- `$users` cannot have custom attributes; use `userProfiles` instead
- Links cannot carry attributes; relationships are one-directional
- `.indexed()` is required for queries with operators (`$gt`, `$lt`, comparison, ordering)
- `.unique()` enables lookups by value instead of ID

## Usage Patterns

### Client-Side (Web/Mobile)

```tsx
import { db } from "@repo/db";

// Query hooks
const { notifications, unreadCount } = db.useNotificationsFeed();
const { userProfile, updateUserProfile } = db.useUserProfile();
const { tokens } = db.useNotificationTokens();

// Auth
const { isSignedIn, userId } = db.useAuth();
const { user } = db.useUser();

// Auth guards
<db.SignedIn>Protected content</db.SignedIn>
<db.SignedOut>Public content</db.SignedOut>

// Transactional operations
await db.registerNotificationToken(token, deviceId, userId);
await db.markNotificationAsRead(notificationId);
await db.dismissNotification(notificationId);
```

### Server-Side (tRPC / Webhooks)

```typescript
import { adminDb } from "@repo/db/admin";

const { db, createNotification, getUserTokens, createPurchase } = adminDb;

// Query
const tokens = await getUserTokens(userId);
const user = await getUserByEmail(email);

// Transactional operations
const notificationId = await createNotification(userId, {
  type: "payment_received",
  title: "Payment Confirmed",
  body: "Your payment was successful",
  data: { orderId: "123" },
});

const purchaseId = await createPurchase(userId, {
  productType: "fixed",
  amount: 2999,
  currency: "usd",
  platform: "web",
  provider: "stripe",
  status: "completed",
  productId: "prod-123",
});
```

## Admin Client API

The `admin.ts` export provides high-level helpers:

- **`getUserTokens(userId)`** - Get all notification tokens for a user
- **`createNotification(userId, notification)`** - Create and link a notification
- **`createNotificationDelivery(notificationId, delivery)`** - Record a delivery attempt
- **`getUnreadNotificationCount(userId)`** - Count unread notifications
- **`getUserByEmail(email)`** - Lookup user by email
- **`createPurchase(userId, purchase)`** - Create a purchase record
- **`updatePurchaseStatus(purchaseId, status)`** - Update purchase status
- **`getUserPurchases(userId)`** - Get user's purchase history
- **`getOrCreateStripeCustomerId(userId, email, stripe)`** - Manage Stripe customer IDs

## Consuming This Package

### From Web App
```typescript
// apps/web/src/app/layout.tsx or similar
import { db } from "@repo/db";

export default function Layout({ children }) {
  return <db.SignedIn>{children}</db.SignedIn>;
}
```

### From Mobile App
```typescript
// apps/mobile/app/_layout.tsx
import { db } from "@repo/db"; // resolves to index.native.ts

export default function Layout() {
  const { isLoading } = db.useUser();
  return <>{/* ... */}</>;
}
```

### From tRPC Router
```typescript
// packages/trpc/src/routers/notifications.ts
import { adminDb } from "@repo/db/admin";

export const notificationRouter = router({
  getList: protectedProcedure.query(async ({ ctx }) => {
    const { db } = adminDb;
    return db.query({
      notifications: { $: { where: { "$user.id": ctx.userId } } },
    });
  }),
});
```

## Environment Variables

The db package requires different env vars per platform:

- **Web**: `NEXT_PUBLIC_INSTANT_APP_ID` (client-side)
- **Mobile**: `EXPO_PUBLIC_INSTANT_APP_ID` (client-side)
- **Server**: `INSTANT_APP_ID` and `INSTANT_APP_ADMIN_TOKEN` (server-side)

## Important Patterns

1. **No builds needed** - The package exports TypeScript directly; consumers compile it themselves
2. **Date objects enabled** - All clients initialize with `useDateObjects: true`
3. **Type safety** - Full TypeScript generics via `AppSchema` type
4. **Async transactions** - Use `client.transact([...])` or `db.transact([...])`
5. **Real-time subscriptions** - Hooks automatically subscribe and unsubscribe
6. **Optimistic updates** - InstantDB handles optimistic UI updates by default

## Extending the Database

To add new features:
1. Update `instant.schema.ts` with new entities/relationships
2. Add helper functions to `create-db.tsx` (for client) or `admin.ts` (for server)
3. Update `instant.perms.ts` if permission rules are needed
4. Both web and mobile will automatically see the changes
