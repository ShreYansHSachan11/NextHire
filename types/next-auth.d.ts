// Module augmentation for NextAuth. The bare side-effect import is what pulls
// the original module declarations into scope; importing the default export
// just to discard it would be an unused binding.
import 'next-auth';
import 'next-auth/jwt';

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
      /** The app's own JWT, understood by every /api route. */
      appToken: string;
    };
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id?: string;
    role?: string;
    companyId?: string | null;
    companyName?: string | null;
    appToken?: string;
  }
}
