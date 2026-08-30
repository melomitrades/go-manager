import type { Metadata } from 'next'
import { Nunito, Nunito_Sans, Playfair_Display } from 'next/font/google'
import { ThemeProvider } from '@/components/shared/ThemeProvider'
import { SessionProvider } from '@/components/shared/SessionProvider'
import './globals.css'

const nunito = Nunito({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
  weight: ['300', '400', '500', '600', '700'],
})

const nunitoSans = Nunito_Sans({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
  weight: ['300', '400', '500', '600'],
})

// Self-hosted via next/font instead of the old <link>/@import pair in the <head> below and in
// globals.css — those pulled the exact same Playfair Display family from fonts.googleapis.com a
// second time as a render-blocking cross-origin request. next/font already inlines this font at
// build time, so the manual tags were pure duplicate network cost on every page load.
const playfair = Playfair_Display({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['400', '500', '600', '700'],
  style: ['normal', 'italic'],
})

export const metadata: Metadata = {
  title: 'GO Manager — Giantz',
  description: 'K-pop Group Order Management',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${nunito.variable} ${nunitoSans.variable} ${playfair.variable} font-sans antialiased`}>
        <SessionProvider>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
            {children}
          </ThemeProvider>
        </SessionProvider>
      </body>
    </html>
  )
}
