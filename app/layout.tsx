import "./globals.css";
import type { Metadata, Viewport } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import ReduxProvider from "@/store/Provider";
import AuthRehydrator from "@/store/AuthRehydrator";
import { SocketProvider } from "@/lib/socketContext";
import SessionProviderWrapper from "@/app/components/SessionProviderWrapper";
import { ThemeProvider, themeInitScript } from "@/app/components/ThemeProvider";
import { ToastProvider } from "@/app/components/Toast";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

// Machine-generated values — match scores, model versions, counts, status codes —
// are set in mono so they read as instrument output rather than prose.
const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-mono-jb",
});

export const metadata: Metadata = {
  title: {
    default: "NextHire — Signal-driven job matching",
    template: "%s · NextHire",
  },
  description:
    "NextHire maps your experience against live roles, surfaces the strongest matches, and puts you in direct contact with the hiring team.",
  applicationName: "NextHire",
  openGraph: {
    title: "NextHire",
    description: "Signal-driven job matching. Find your next role, or your next hire.",
    siteName: "NextHire",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f8fa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b111c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint so the page never flashes
            the wrong colours on load. */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className={`${inter.variable} ${jetbrainsMono.variable} font-sans antialiased`}>
        {/*
          First thing in the tab order, ahead of the sticky header. Every page
          in the app renders exactly one `<main id="main-content">` — this
          layout deliberately renders none, so that stays true rather than
          nesting a second landmark inside the first.
        */}
        {/*
          Uses the overlay shadow token rather than `shadow-lg`, so the one thing
          that floats above the sticky header is lit like every other floating
          surface. `top-4` clears the 3px signal rail; the `scroll-padding-top` in
          globals.css handles the header for everything the link jumps *to*.
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
