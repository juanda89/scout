import NextAuth, { type NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import PostgresAdapter from "@auth/pg-adapter";
import { pool } from "@/lib/pool";

/**
 * Acceso: Google OAuth en producción. Si no hay credenciales de Google (desarrollo), un proveedor
 * "dev" acepta cualquier correo de la lista permitida. La lista (ALLOWED_EMAILS, ALLOWED_DOMAIN)
 * limita quién entra, también con Google.
 */
const allowedEmails = (process.env.ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
const allowedDomain = (process.env.ALLOWED_DOMAIN ?? "").trim().toLowerCase();
const hasGoogle = !!process.env.GOOGLE_CLIENT_ID && !!process.env.GOOGLE_CLIENT_SECRET;
const devSecret = process.env.DEV_LOGIN_SECRET ?? "";
/** El sign-in de desarrollo solo existe sin Google o con DEV_LOGIN=1; en producción exige además DEV_LOGIN_SECRET. */
const devEnabled = (!hasGoogle || process.env.DEV_LOGIN === "1") && (process.env.NODE_ENV !== "production" || !!devSecret);

export function isAllowed(email?: string | null): boolean {
  if (!email) return false;
  const e = email.toLowerCase();
  if (!allowedEmails.length && !allowedDomain) return true;
  return allowedEmails.includes(e) || (!!allowedDomain && e.endsWith("@" + allowedDomain));
}

const providers: NextAuthConfig["providers"] = [];
if (hasGoogle) providers.push(Google({ clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET, allowDangerousEmailAccountLinking: true }));
if (devEnabled) {
  providers.push(Credentials({
    id: "dev",
    name: "Development sign-in",
    credentials: { email: { label: "Email", type: "email" }, secret: { label: "Access code", type: "password" } },
    async authorize(c) {
      const email = String(c?.email ?? "").trim().toLowerCase();
      if (!email || !isAllowed(email)) return null;
      if (devSecret && String(c?.secret ?? "") !== devSecret) return null;
      const { rows } = await pool.query(`INSERT INTO users (email, name) VALUES ($1, $2) ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email RETURNING id, email, name`, [email, email.split("@")[0]]);
      return { id: String(rows[0].id), email: rows[0].email, name: rows[0].name };
    },
  }));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool),
  session: { strategy: "jwt" },
  providers,
  pages: { signIn: "/signin" },
  callbacks: {
    signIn({ user }) { return isAllowed(user.email); },
    jwt({ token, user }) { if (user?.id) token.uid = user.id; return token; },
    session({ session, token }) { if (token.uid) session.user.id = String(token.uid); return session; },
  },
  trustHost: true,
});

export const authMode: "google" | "dev" | "none" = hasGoogle ? "google" : devEnabled ? "dev" : "none";
export const devNeedsSecret = !!devSecret;
