// FR-AUTH-001 — Auth.js v5 configuration.
// Pinned to next-auth@5.0.0-beta.25; do NOT bump without a new FR.
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { z } from "zod";
import { handleGoogleSignIn, safeAuthRedirect } from "@/server/auth/google-sign-in";

const envSchema = z.object({
  GOOGLE_CLIENT_ID: z.string().min(1, "GOOGLE_CLIENT_ID is required"),
  GOOGLE_CLIENT_SECRET: z.string().min(1, "GOOGLE_CLIENT_SECRET is required"),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 chars"),
});

const parsedEnv = envSchema.safeParse(process.env);
const env = parsedEnv.success
  ? parsedEnv.data
  : {
      GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID ?? "__missing_google_client_id__",
      GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET ?? "__missing_google_client_secret__",
      AUTH_SECRET: process.env.AUTH_SECRET ?? "__missing_auth_secret_for_build_only__",
    };

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      authorization: { params: { scope: "openid email profile" } },
    }),
  ],
  session: { strategy: "jwt", maxAge: 60 * 15 /* 15 min — refresh handled in FR-AUTH-003 */ },
  secret: env.AUTH_SECRET,
  trustHost: true,
  callbacks: {
    async signIn({ account, profile }) {
      if (!parsedEnv.success) return false;
      return handleGoogleSignIn({
        account,
        profile,
        googleClientId: env.GOOGLE_CLIENT_ID,
      });
    },
    async redirect({ url, baseUrl }) {
      return safeAuthRedirect({ url, baseUrl });
    },
  },
  pages: { signIn: "/auth/sign-in", error: "/auth/error" },
});
