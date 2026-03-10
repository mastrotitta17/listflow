import type { Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { cookies, headers } from "next/headers";
import { detectLocale } from "@/lib/i18n/detect-locale";
import { I18nProvider } from "@/lib/i18n/provider";
import MobileAppBridge from "@/components/MobileAppBridge";
import AuthSessionKeeper from "@/components/AuthSessionKeeper";
import QueryProvider from "@/components/providers/QueryProvider";
import { Toaster } from "@/components/ui/sonner";
import RuntimeErrorNoiseFilter from "@/components/RuntimeErrorNoiseFilter";
import { rootMetadata } from "@/lib/seo";
import "./globals.css";
import { SpeedInsights } from "@vercel/speed-insights/next"
import { Analytics } from '@vercel/analytics/next';

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = rootMetadata;

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0a0a0c",
  colorScheme: "dark",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = detectLocale(await cookies(), await headers());

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} overflow-x-hidden antialiased`}
      >
        <I18nProvider locale={locale}>
          <QueryProvider>
            <RuntimeErrorNoiseFilter />
            <AuthSessionKeeper />
            <MobileAppBridge />
            {children}
            <SpeedInsights />
            <Analytics />
            <Toaster richColors closeButton position="top-right" />
          </QueryProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
