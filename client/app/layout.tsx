import type { Metadata } from "next";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Exo_2, Roboto_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner"
import Providers from './providers'
import { ReactQueryDevtools } from '@tanstack/react-query-devtools'
import { TooltipProvider } from "@/components/ui/tooltip"
import Footer from "@/components/Footer"
import Nav from "@/components/Nav"
import { Analytics } from "@vercel/analytics/next"
import { SpeedInsights } from '@vercel/speed-insights/next';
import { NuqsAdapter } from 'nuqs/adapters/next/app'

  const exo2 = Exo_2({
    subsets: ['latin'],
    variable: '--font-exo2',
  });

  const robotoMono = Roboto_Mono({
    subsets: ['latin'],
    variable: '--font-roboto-mono',
  });

export const metadata: Metadata = {
  metadataBase: new URL("https://formalytx.com"),
  title: {
    default: "Formalytx — F1 Telemetry & Lap Data Explorer",
    template: "%s · Formalytx",
  },
  description:
    "Compare Formula 1 driver lap times, sector splits, and speed traces across every session. Explore qualifying results, race telemetry, and historical F1 data — powered by FastF1.",
  robots: { index: true, follow: true },
  alternates: { canonical: "https://formalytx.com" },
  openGraph: {
    type: "website",
    siteName: "Formalytx",
    title: "Formalytx — F1 Telemetry & Lap Data Explorer",
    description:
      "Compare Formula 1 driver lap times, sector splits, and speed traces across every session. Explore qualifying results, race telemetry, and historical F1 data — powered by FastF1.",
    url: "https://formalytx.com",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Formalytx — F1 Telemetry & Lap Data Explorer",
    description:
      "Compare Formula 1 driver lap times, sector splits, and speed traces across every session. Explore qualifying results, race telemetry, and historical F1 data — powered by FastF1.",
  },
};

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": "https://formalytx.com/#website",
      url: "https://formalytx.com",
      name: "Formalytx",
      description: "Explore Formula 1 session results, lap times, and car telemetry.",
      inLanguage: "en-US",
    },
    {
      "@type": "WebApplication",
      "@id": "https://formalytx.com/#app",
      name: "Formalytx",
      url: "https://formalytx.com",
      description: "Browse Formula 1 seasons, events, and sessions, then compare driver laps and inspect raw car telemetry — powered by FastF1.",
      applicationCategory: "SportsApplication",
      operatingSystem: "Any",
      browserRequirements: "Requires JavaScript. Requires HTML5.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
      },
    },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={cn("h-full", "antialiased", exo2.variable, robotoMono.variable)}
    >
      <body className="bg-background min-h-full flex flex-col">
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify(jsonLd).replace(/</g, "\\u003c"),
          }}
        />
        <Providers>
          <TooltipProvider>
            <Nav />
            <NuqsAdapter>
              {children}
            </NuqsAdapter>
          </TooltipProvider>
          <Toaster 
          position="bottom-right" 
          toastOptions={{
          classNames: {
              toast: "bg-surface-card! text-text-primary! border-accent-green-dark!",
              closeButton: "hover:bg-[var(--gray1)]! hover:border-[var(--gray4)]!"
            },
          }} 
          />
          <Footer />
          <ReactQueryDevtools />
        </Providers>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
