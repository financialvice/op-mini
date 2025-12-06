// This file configures the initialization of Sentry for edge features (middleware, edge routes, and so on).
// The config you add here will be used whenever one of the edge features is loaded.
// Note that this config is unrelated to the Vercel Edge Runtime and is also required when running locally.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://276093b255d66d970a4c0187da66655e@o4509629094494208.ingest.us.sentry.io/4510333361586176",
  tracesSampleRate: 1,
  enableLogs: true,
  sendDefaultPii: true,
});
