import { type NextRequest, NextResponse } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Rewrite .md requests to the md API handler
  if (pathname.endsWith(".md")) {
    const routePath = pathname.slice(0, -3) || "/";
    const url = req.nextUrl.clone();
    url.pathname = `/api/md${routePath}`;
    return NextResponse.rewrite(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|monitoring).*)"],
};
