// Import md handlers from sibling .md.ts files - co-located with pages
import { md as home } from "@/app/(authed)/page.md";
import type { MdRoutes } from "./md-router";

export const mdRoutes: MdRoutes = {
  "/": home,
};
