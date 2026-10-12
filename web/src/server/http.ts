import "server-only";
import { headers as nextHeaders } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getAuth } from "./auth";
import { env } from "./env";
import { AppError, badRequest, forbidden, unauthorized } from "./errors";
import { logger } from "./logger";

export type Ctx = {
  userId: string;
  user: { id: string; name: string; email: string };
  sessionId: string;
  ip: string | null;
};

type RouteContext<P> = { params: Promise<P> };
type Handler<P> = (req: NextRequest, ctx: Ctx, params: P) => Promise<unknown>;

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Rejects cross-site state-changing requests (CSRF), in addition to SameSite=Lax cookies. */
export function assertSameOrigin(req: Request) {
  if (!MUTATING.has(req.method)) return;
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") throw forbidden("Cross-site request blocked");
  const origin = req.headers.get("origin");
  if (!origin) return;
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw forbidden("Bad origin");
  }
  const allowed = new Set([new URL(env().APP_URL).host, req.headers.get("host") ?? ""]);
  if (!allowed.has(originHost)) throw forbidden("Cross-site request blocked");
}

export function clientIp(h: Headers): string | null {
  return h.get("cf-connecting-ip") ?? h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
}

export async function getSessionCtx(h?: Headers): Promise<Ctx | null> {
  const hdrs = h ?? (await nextHeaders());
  const s = await getAuth().api.getSession({ headers: hdrs });
  if (!s) return null;
  return {
    userId: s.user.id,
    user: { id: s.user.id, name: s.user.name, email: s.user.email },
    sessionId: s.session.id,
    ip: clientIp(hdrs),
  };
}

export function errorResponse(err: unknown) {
  if (err instanceof AppError) {
    return NextResponse.json(
      { error: { code: err.code, message: err.message, details: err.details } },
      { status: err.status },
    );
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json(
      { error: { code: "bad_request", message: "Invalid input", details: err.issues } },
      { status: 400 },
    );
  }
  logger.error({ err: err instanceof Error ? { message: err.message, stack: err.stack } : String(err) }, "unhandled error");
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
}

/** Wraps an authenticated route handler: session, CSRF check, error mapping, JSON output. */
export function route<P = Record<string, string>>(handler: Handler<P>) {
  return async (req: NextRequest, context: RouteContext<P>) => {
    try {
      assertSameOrigin(req);
      const ctx = await getSessionCtx(req.headers);
      if (!ctx) throw unauthorized();
      const params = (await context?.params) ?? ({} as P);
      const result = await handler(req, ctx, params);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

/** Route handler that does not require a session (invites, health). */
export function publicRoute<P = Record<string, string>>(
  handler: (req: NextRequest, params: P) => Promise<unknown>,
) {
  return async (req: NextRequest, context: RouteContext<P>) => {
    try {
      assertSameOrigin(req);
      const params = (await context?.params) ?? ({} as P);
      const result = await handler(req, params);
      if (result instanceof Response) return result;
      return NextResponse.json(result ?? { ok: true });
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function body<T extends z.ZodType>(req: Request, schema: T): Promise<z.infer<T>> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    throw badRequest("Request body must be JSON");
  }
  return schema.parse(json);
}

export function query<T extends z.ZodType>(req: NextRequest, schema: T): z.infer<T> {
  return schema.parse(Object.fromEntries(req.nextUrl.searchParams));
}
