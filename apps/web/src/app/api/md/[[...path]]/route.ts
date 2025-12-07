import type { Route } from "next";
import type { NextRequest } from "next/server";

import { handleMdRequest } from "@/lib/md-router";
import { mdRoutes } from "@/lib/md-routes";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> }
) {
  const { path } = await params;
  const routePath = path ? `/${path.join("/")}` : "/";

  const response = await handleMdRequest(mdRoutes, routePath as Route);

  if (response) {
    return response;
  }

  return new Response("Not found", { status: 404 });
}
