import type { Metadata, Viewport } from "next";
import { Fraunces, JetBrains_Mono } from "next/font/google";
import "./globals.css";

/*
  Two fonts, strictly:
  • Fraunces — variable serif (opsz + SOFT + WONK axes) for display,
    body, and italic accents. One family, full dynamic range.
  • JetBrains Mono — small monospace for labels, eyebrows, data.
*/

const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  axes: ["opsz", "SOFT", "WONK"],
  display: "swap",
});

const jbMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
  display: "swap",
});

const SITE_URL = "https://www.humanovo.net";
const TITLE = "humanovo — research intelligence for scientists";
const DESCRIPTION =
  "humanovo reads every paper, dataset, and notebook so you can see what the literature missed — and pursue the hypothesis it points to.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · humanovo",
  },
  description: DESCRIPTION,
  applicationName: "humanovo",
  keywords: [
    "biomedical AI",
    "literature search",
    "hypothesis generation",
    "research assistant",
    "scientific discovery",
    "PubMed",
    "research intelligence",
    "co-investigator AI",
  ],
  authors: [{ name: "humanovo" }],
  creator: "humanovo",
  publisher: "humanovo",
  alternates: {
    canonical: SITE_URL,
  },
  // OG image is intentionally a placeholder path — replace with a
  // hand-composed 1200×630 plate (Vesalius detail + wordmark) before
  // public-launch press push. Documented in DESIGN_NOTES.md.
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: "humanovo",
    title: TITLE,
    description: DESCRIPTION,
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "humanovo — research intelligence for scientists",
      },
    ],
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: ["/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.svg", type: "image/svg+xml" },
      { url: "/favicon.ico", sizes: "any" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  category: "technology",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Theme-color matches the warm parchment background; the dark
  // variant matches the desktop app's default theme so the move
  // from landing to download is visually continuous.
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#F4ECDC" },
    { media: "(prefers-color-scheme: dark)", color: "#1A1613" },
  ],
};

const ORG_JSONLD = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "humanovo",
  url: SITE_URL,
  logo: `${SITE_URL}/favicon.svg`,
  description: DESCRIPTION,
  foundingDate: "2026",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${fraunces.variable} ${jbMono.variable}`}>
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(ORG_JSONLD) }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
