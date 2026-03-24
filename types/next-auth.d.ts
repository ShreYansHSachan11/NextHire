import NextAuth from 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
      role: string;
      companyId: string | null;
      companyName: string | null;
      appToken: string;
    };
  }

  interface JWT {
    id: string;
    role: string;
    companyId: string | null;
    companyName: string | null;
    appToken: string;
  }
}
