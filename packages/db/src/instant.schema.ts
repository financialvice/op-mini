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
    oauthTokens: i.entity({
      provider: i.string(),
      accessToken: i.string(),
      refreshToken: i.string().optional(),
      expiresAt: i.date().optional(),
      lastRefreshedAt: i.date().optional(),
      createdAt: i.date().indexed(),
    }),
    instantDbOrgs: i.entity({
      orgId: i.string(),
    }),
    instantDbApps: i.entity({
      appId: i.string(),
      adminToken: i.string(),
    }),
    vercelTeams: i.entity({}),
    githubRepos: i.entity({
      name: i.string(),
    }),
    machines: i.entity({
      morphInstanceId: i.string().unique().indexed().optional(),
    }),
    sessions: i.entity({}),
    messsages: i.entity({}),
  },
  links: {
    userOAuthTokens: {
      forward: {
        on: "oauthTokens",
        has: "one",
        label: "user",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "oauthTokens",
      },
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
