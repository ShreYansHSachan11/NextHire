import NextAuth from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { prisma } from '@/lib/prisma';
import * as jwt from 'jsonwebtoken';

const handler = NextAuth({
  providers: [
    GoogleProvider({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === 'google') {
        try {
          // Upsert user in DB
          await prisma.user.upsert({
            where: { email: user.email! },
            update: { name: user.name ?? '' },
            create: {
              email: user.email!,
              name: user.name ?? '',
              password: '', // no password for OAuth users
              role: 'SEEKER',
            },
          });
          return true;
        } catch {
          return false;
        }
      }
      return true;
    },

    async jwt({ token, account, profile }) {
      // On first sign-in, enrich token with DB user data
      if (account?.provider === 'google') {
        const dbUser = await prisma.user.findUnique({
          where: { email: token.email! },
          include: { company: true },
        });
        if (dbUser) {
          token.id = dbUser.id;
          token.role = dbUser.role;
          token.companyId = dbUser.companyId;
          token.companyName = dbUser.company?.name ?? null;
          // Issue your own JWT so the rest of the app works as-is
          token.appToken = jwt.sign(
            {
              id: dbUser.id,
              email: dbUser.email,
              role: dbUser.role,
              companyId: dbUser.companyId,
              name: dbUser.name,
              companyName: dbUser.company?.name ?? null,
            },
            process.env.JWT_SECRET!,
            { expiresIn: '7d' }
          );
        }
      }
      return token;
    },

    async session({ session, token }) {
      session.user = {
        ...session.user,
        id: token.id as string,
        role: token.role as string,
        companyId: token.companyId as string | null,
        companyName: token.companyName as string | null,
        appToken: token.appToken as string,
      };
      return session;
    },

    async redirect({ url, baseUrl }) {
      return `${baseUrl}/api/auth/google-callback`;
    },
  },
  secret: process.env.NEXTAUTH_SECRET,
});

export { handler as GET, handler as POST };
