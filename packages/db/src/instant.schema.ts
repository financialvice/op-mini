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
    // Teams for grouping users and resources
    teams: i.entity({
      name: i.string(),
      createdAt: i.date().indexed(),
    }),
    // Join entity for team membership (since links can't carry attributes)
    teamMemberships: i.entity({
      role: i.string<"owner" | "member">(), // "owner" | "member"
      createdAt: i.date().indexed(),
    }),
    // External InstantDB org owned by a team
    instantDbOrgs: i.entity({
      externalOrgId: i.string().unique().indexed(),
      name: i.string(),
      createdAt: i.date().indexed(),
    }),
    // External InstantDB app owned by a team
    instantDbApps: i.entity({
      externalAppId: i.string().unique().indexed(),
      adminToken: i.string(),
      name: i.string(),
      description: i.string().optional(),
      createdAt: i.date().indexed(),
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
    // Team membership links
    membershipUser: {
      forward: {
        on: "teamMemberships",
        has: "one",
        label: "user",
      },
      reverse: {
        on: "$users",
        has: "many",
        label: "teamMemberships",
      },
    },
    membershipTeam: {
      forward: {
        on: "teamMemberships",
        has: "one",
        label: "team",
      },
      reverse: {
        on: "teams",
        has: "many",
        label: "memberships",
      },
    },
    // Team owns exactly one InstantDB org (1:1)
    teamInstantDbOrg: {
      forward: {
        on: "instantDbOrgs",
        has: "one",
        label: "team",
      },
      reverse: {
        on: "teams",
        has: "one",
        label: "instantDbOrg",
      },
    },
    // Team owns InstantDB apps
    teamInstantDbApps: {
      forward: {
        on: "instantDbApps",
        has: "one",
        label: "team",
      },
      reverse: {
        on: "teams",
        has: "many",
        label: "instantDbApps",
      },
    },
    // App belongs to an org
    appOrg: {
      forward: {
        on: "instantDbApps",
        has: "one",
        label: "org",
      },
      reverse: {
        on: "instantDbOrgs",
        has: "many",
        label: "apps",
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
