import type { Route } from "next";

export type MdHandler = () => Promise<string> | string;

export type MdRoutes = Partial<Record<Route, MdHandler>>;

export async function handleMdRequest(
  routes: MdRoutes,
  pathname: string
): Promise<Response | null> {
  const handler = routes[pathname as Route];
  if (!handler) {
    return null;
  }

  const content = typeof handler === "function" ? await handler() : handler;

  return new Response(content, {
    status: 200,
    headers: { "Content-Type": "text/markdown; charset=utf-8" },
  });
}
