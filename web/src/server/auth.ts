import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";
import { db } from "./db";
import { account, session, user, verification } from "./db/schema";
import { env } from "./env";
import { sendMail } from "./mail";

// When an admin generates a reset link for someone (because email is not configured),
// the link is captured here instead of being emailed.
export const resetLinkCapture = new AsyncLocalStorage<{ url?: string }>();

function createAuth() {
  const e = env();
  return betterAuth({
    appName: "Team Workspace",
    baseURL: e.APP_URL,
    secret: e.BETTER_AUTH_SECRET,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      // Accounts are only created through admin invitations.
      disableSignUp: true,
      minPasswordLength: 10,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user: u, url }) => {
        const capture = resetLinkCapture.getStore();
        if (capture) {
          capture.url = url;
          return;
        }
        await sendMail(
          u.email,
          "Reset your Team Workspace password",
          `Someone asked to reset the password for ${u.email}.\n\nOpen this link within one hour to choose a new password:\n${url}\n\nIf this wasn't you, ignore this email.`,
        );
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
    },
    rateLimit: {
      enabled: e.NODE_ENV === "production" || process.env.AUTH_RATE_LIMIT === "1",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/request-password-reset": { window: 300, max: 3 },
        "/reset-password": { window: 300, max: 5 },
        "/change-password": { window: 300, max: 5 },
      },
    },
    advanced: {
      cookiePrefix: "tw",
      database: { generateId: "uuid" },
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip", "x-real-ip", "x-forwarded-for"] },
    },
    databaseHooks: {
      session: {
        create: {
          // Removed users cannot start new sessions.
          before: async (s) => {
            const [u] = await db
              .select({ disabledAt: user.disabledAt })
              .from(user)
              .where(eq(user.id, s.userId as string));
            if (!u || u.disabledAt) return false;
          },
        },
      },
    },
    telemetry: { enabled: false },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;
const globalForAuth = globalThis as unknown as { auth?: Auth };

export function getAuth(): Auth {
  if (!globalForAuth.auth) globalForAuth.auth = createAuth();
  return globalForAuth.auth;
}
