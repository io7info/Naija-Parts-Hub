import type { Metadata, Viewport } from 'next'
import localFont from 'next/font/local'
import './globals.css'

/**
 * Inter and Manrope, served from the repo rather than fetched from Google.
 *
 * `next/font/google` downloads the font at build time. That makes every build —
 * including CI and Vercel — depend on fonts.gstatic.com being reachable, and it
 * failed here with an unresolvable internal module the moment the Turbopack
 * cache was cleared, taking the whole site down with a build error.
 *
 * These are the exact files apps/mobile bundles (see assets/fonts), so the
 * dealer app and the marketplace render identical type. The upstream licences
 * ship alongside them — both are SIL Open Font License 1.1, which permits
 * redistribution.
 *
 * Variable fonts: one file covers the whole weight range, so the `weight`
 * range below is what unlocks 600/700 rather than letting the browser
 * synthesise a fake bold.
 */
const inter = localFont({
  src: './fonts/Inter.ttf',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
})

const manrope = localFont({
  src: './fonts/Manrope.ttf',
  weight: '200 800',
  variable: '--font-manrope',
  display: 'swap',
})

export const SITE_URL = 'https://naijapartshub.com'

export const metadata: Metadata = {
  // metadataBase makes every relative canonical/OG URL in child routes resolve
  // absolutely, which product and store pages depend on for share previews.
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Naija Parts Hub — Automotive Parts Marketplace',
    template: '%s · Naija Parts Hub',
  },
  description:
    'Find automotive parts from verified Nigerian dealers. Car, motorcycle, truck, ' +
    'tractor and heavy-equipment parts. Operated by Lytod Motors Ltd (RC 1207675).',
  applicationName: 'Naija Parts Hub',
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    siteName: 'Naija Parts Hub',
    locale: 'en_NG',
    url: SITE_URL,
    title: 'Naija Parts Hub — Automotive Parts Marketplace',
    description: 'Automotive parts from verified Nigerian dealers.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Naija Parts Hub — Automotive Parts Marketplace',
    description: 'Automotive parts from verified Nigerian dealers.',
  },
  icons: {
    icon: '/nph-logo-dark.jpeg',
    apple: '/nph-logo-dark.jpeg',
  },
  robots: { index: true, follow: true },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#0b0b0b',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${manrope.variable}`}>
      <body className="antialiased bg-background text-foreground">{children}</body>
    </html>
  )
}
