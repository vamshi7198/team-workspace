import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, errorResponse, getSessionCtx, type Ctx } from "../http";
import { notFound, unauthorized } from "../errors";

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export type Params = Record<string, string>;
export type Handler = (req: NextRequest, ctx: Ctx, params: Params) => Promise<unknown>;
export type PublicHandler = (req: NextRequest, ctx: Ctx | null, params: Params) => Promise<unknown>;

type RouteDef = { method: Method; parts: string[]; handler: Handler | PublicHandler; public: boolean };

export class Router {
  private routes: RouteDef[] = [];

  private add(method: Method, pattern: string, handler: Handler | PublicHandler, isPublic = false) {
    this.routes.push({ method, parts: pattern.split("/").filter(Boolean), handler, public: isPublic });
    return this;
  }
  get(p: string, h: Handler) { return this.add("GET", p, h); }
  post(p: string, h: Handler) { return this.add("POST", p, h); }
  put(p: string, h: Handler) { return this.add("PUT", p, h); }
  patch(p: string, h: Handler) { return this.add("PATCH", p, h); }
  delete(p: string, h: Handler) { return this.add("DELETE", p, h); }
  /** No session required. The handler receives the session if there is one. */
  public(method: Method, p: string, h: PublicHandler) { return this.add(method, p, h, true); }

  private match(method: string, segments: string[]) {
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== segments.length) continue;
      const params: Params = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const part = r.parts[i];
        if (part.startsWith(":")) params[part.slice(1)] = decodeURIComponent(segments[i]);
        else if (part !== segments[i]) { ok = false; break; }
      }
      if (ok) return { route: r, params };
    }
    return null;
  }

  handle = async (req: NextRequest, context: { params: Promise<{ path: string[] }> }) => {
    try {
      assertSameOrigin(req);
      const { path } = await context.params;
      const found = this.match(req.method, path);
      if (!found) throw notFound("No such endpoint");
      const ctx = await getSessionCtx(req.headers);
      if (!found.route.public && !ctx) throw unauthorized();
      const result = await (found.route.handler as PublicHandler)(req, ctx, found.params);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      return errorResponse(err);
    }
  };
}
