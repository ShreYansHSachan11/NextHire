import { randomUUID } from 'crypto';
import NextAuth, { type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import * as bcrypt from 'bcryptjs';
import { prisma } from '@/lib/prisma';
import { signToken, type SessionUser } from '@/lib/auth';

const authOptions: NextAuthOptions = {
  providers: [
    GoogleProvider({
      // Next evaluates this module at build time, where the OAuth credentials
      // may be absent. Fall back to empty strings so the build succeeds and
      // NextAuth reports a configuration error at request time instead.
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
    }),
  ],

  session: { strategy: 'jwt' },

  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider !== 'google') return true;
      if (!user.email) return false;

      try {
        const existing = await prisma.user.findUnique({
          where: { email: user.email },
          select: { id: true },
        });

        if (existing) {
          await prisma.user.update({
            where: { id: existing.id },
            data: { name: user.name ?? undefined },
          });
          return true;
        }

        // OAuth accounts have no password. Storing '' meant the password login
        // path could in principle match, so store a hash of a random value that
        // nobody knows — an unusable password.
        const unusablePassword = await bcrypt.hash(randomUUID(), 12);

        await prisma.user.create({
          data: {
            email: user.email,
            name: user.name ?? user.email.split('@')[0],
            password: unusablePassword,
            role: 'SEEKER',
          },
        });
        return true;
      } catch (error) {
        console.error('NextAuth signIn failed:', error);
        return false;
      }
    },

    async jwt({ token, account }) {
      // Only on first sign-in: enrich the token from the database and mint the
      // app's own JWT, which every other API route understands.
      if (account?.provider === 'google' && token.email) {
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email },
          include: { company: { select: { id: true, name: true } } },
        });

        if (dbUser) {
          const sessionUser: SessionUser = {
            id: dbUser.id,
            email: dbUser.email,
            name: dbUser.name,
            role: dbUser.role as SessionUser['role'],
            companyId: dbUser.companyId,
            companyName: dbUser.company?.name ?? null,
          };

          token.id = sessionUser.id;
          token.role = sessionUser.role;
          token.companyId = sessionUser.companyId;
          token.companyName = sessionUser.companyName;
          token.appToken = signToken(sessionUser);
        }
      }
      return token;
    },

    async session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.id as string,
        role: token.role as string,
        companyId: (token.companyId as string | null) ?? null,
        companyName: (token.companyName as string | null) ?? null,
        appToken: token.appToken as string,
      };
      return session;
    },

    async redirect({ url, baseUrl }) {
      // This used to ignore its arguments and always return the callback route,
      // which broke sign-out and every explicit callbackUrl.
      const target = url.startsWith('/') ? `${baseUrl}${url}` : url;

      let parsed: URL;
      try {
        parsed = new URL(target);
      } catch {
        return baseUrl;
      }

      // Never hand control to another origin.
      if (parsed.origin !== new URL(baseUrl).origin) return baseUrl;

      // `signIn('google')` defaults its callbackUrl to the page that started it,
      // i.e. one of our auth pages. That is the sign-in flow, and it has to pass
      // through the callback route so the app JWT cookie gets issued.
      if (parsed.pathname.startsWith('/auth/')) {
        return `${baseUrl}/api/auth/google-callback`;
      }

      return parsed.toString();
    },
  },

  secret: process.env.NEXTAUTH_SECRET,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST };
