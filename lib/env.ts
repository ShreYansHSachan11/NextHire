/**
 * Environment configuration.
 *
 * `validateEnv()` used to run at import time from `lib/prisma.ts`, which meant a
 * missing variable threw during `next build` — before any request had been
 * made. Validation is now explicit: call it from a route when you need a hard
 * guarantee, and read `env.*` everywhere else.
 */

const REQUIRED = [
  'DATABASE_URL',
  'JWT_SECRET',
  'CLOUDINARY_CLOUD_NAME',
  'CLOUDINARY_API_KEY',
  'CLOUDINARY_API_SECRET',
] as const;

export function validateEnv(): void {
  const missing = REQUIRED.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }
}

/** Lazy getter so referencing `env` never throws at module load. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    // Surfaced at the point of use, where the caller can turn it into a 500
    // rather than taking the whole build down.
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  get DATABASE_URL() {
    return required('DATABASE_URL');
  },
  get JWT_SECRET() {
    return required('JWT_SECRET');
  },
  CLOUDINARY: {
    get CLOUD_NAME() {
      return required('CLOUDINARY_CLOUD_NAME');
    },
    get API_KEY() {
      return required('CLOUDINARY_API_KEY');
    },
    get API_SECRET() {
      return required('CLOUDINARY_API_SECRET');
    },
  },
  get NODE_ENV() {
    return process.env.NODE_ENV || 'development';
  },
  get NEXT_PUBLIC_APP_URL() {
    return process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  },
  get SOCKET_SERVER_PORT() {
    return process.env.SOCKET_SERVER_PORT || '3002';
  },
};
