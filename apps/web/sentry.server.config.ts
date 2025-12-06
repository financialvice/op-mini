// This file configures the initialization of Sentry on the server.
// The config you add here will be used whenever the server handles a request.
// https://docs.sentry.io/platforms/javascript/guides/nextjs/

import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: "https://276093b255d66d970a4c0187da66655e@o4509629094494208.ingest.us.sentry.io/4510333361586176",
  tracesSampleRate: 1,
  enableLogs: true,
  sendDefaultPii: true,
});
