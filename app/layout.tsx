import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Poppins, JetBrains_Mono } from "next/font/google";
import ReduxProvider from "@/store/Provider";
import AuthRehydrator from "@/store/AuthRehydrator";
import { SocketProvider } from "@/lib/socketContext";
import SessionProviderWrapper from "@/app/components/SessionProviderWrapper";
import { ThemeProvider, themeInitScript } from "@/app/components/ThemeProvider";
import { ToastProvider } from "@/app/components/Toast";

// Poppins is not a variable font on Google Fonts, so the weights the app
// actually uses have to be named: 400 body, 500 labels and eyebrows, 600 the
// headings and buttons, 700 the wordmark. Nothing here uses a lighter or
// heavier cut, so there is nothing else to pay for.
const poppins = Poppins({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600", "700"],
  variable: "--font-poppins",
});

// Machine-generated values — match scores, model versions, counts, status codes —
// are set in mono so they read as instrument output rather than prose.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono-jb",
});

export const metadata: Metadata = {
  title: {
    default: "NextHire — Find jobs that fit your experience",
    template: "%s · NextHire",
  },
  description:
    "Search open jobs, see how well each one fits your profile, and talk directly to hiring teams.",
  applicationName: "NextHire",
  openGraph: {
    title: "NextHire",
    description: "Find your next job, or your next hire.",
    siteName: "NextHire",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#05070a",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint so the page never flashes
            the wrong colours on load. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${poppins.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        {/*
          First thing in the tab order, ahead of the sticky header. Every page
          in the app renders exactly one `<main id="main-content">` — this
          layout deliberately renders none, so that stays true rather than
          nesting a second landmark inside the first.
        */}
        {/*
          Uses the overlay shadow token rather than `shadow-lg`, so the one thing
          that floats above the sticky header is lit like every other floating
          surface. The `scroll-padding-top` in globals.css handles the header for
          everything the link jumps *to*.
        */}
        <a
          href="#main-content"
          className="sr-only rounded-lg bg-blue-700 px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-overlay)] focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[100] dark:bg-blue-400 dark:text-gray-900"
        >
          Skip to main content
        </a>
        <SessionProviderWrapper>
          <ReduxProvider>
            <AuthRehydrator />
            <ThemeProvider>
              <ToastProvider>
                <SocketProvider>{children}</SocketProvider>
              </ToastProvider>
            </ThemeProvider>
          </ReduxProvider>
        </SessionProviderWrapper>
      </body>
    </html>
  );
}
