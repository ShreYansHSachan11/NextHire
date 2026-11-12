/**
 * Company logos, safe to import on the client.
 *
 * A logo the source gave us directly wins. Otherwise the company's website is
 * reduced to its domain and looked up on Logo.dev. With `fallback=404`, an
 * unknown domain fails to load instead of returning a generated monogram, so
 * the caller can show our own initial tile.
 */

export interface LogoSource {
  website?: string | null;
  logoUrl?: string | null;
}

/** `https://www.razorpay.com/careers` → `razorpay.com`. Null when unusable. */
export function companyDomain(website?: string | null): string | null {
  if (!website) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(website) ? website : `https://${website}`);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    return host.includes(".") ? host : null;
  } catch {
    return null;
  }
}

export function companyLogoSrc(company?: LogoSource | null, size = 96): string | null {
  if (!company) return null;
  if (company.logoUrl && /^https:\/\//i.test(company.logoUrl)) return company.logoUrl;
  const key = process.env.NEXT_PUBLIC_LOGO_DEV_KEY;
  const domain = companyDomain(company.website);
  if (!key || !domain) return null;
  const params = new URLSearchParams({ token: key, size: String(size), format: "png", retina: "true", fallback: "404" });
  return `https://img.logo.dev/${encodeURIComponent(domain)}?${params}`;
}
