import type { Metadata } from 'next'
import { COMPANY, LegalPage, LegalSection } from '@/components/web/legal-page'

export const metadata: Metadata = {
  title: 'About',
  description:
    'Naija Parts Hub connects buyers with verified Nigerian automotive-parts dealers. Operated by Lytod Motors Ltd (RC 1207675).',
  alternates: { canonical: '/about' },
}

export default function AboutPage() {
  return (
    <LegalPage
      title="About Naija Parts Hub"
      intro="A marketplace connecting buyers with verified automotive-parts dealers across Nigeria."
    >
      <LegalSection heading="What we do">
        <p>
          {COMPANY.product} lists parts for cars, motorcycles, trucks and trailers, tractors and
          agricultural machinery, and heavy equipment. Every dealer is reviewed and verified before
          their store becomes publicly visible.
        </p>
      </LegalSection>

      <LegalSection heading="How buying works">
        <p>
          Browse listings, then contact the dealer directly by phone or WhatsApp. Price,
          negotiation, warranty, payment and delivery are agreed between you and the dealer.{' '}
          <strong className="text-foreground">
            {COMPANY.product} does not process payments and is not a party to any sale.
          </strong>
        </p>
      </LegalSection>

      <LegalSection heading="Operator">
        <p>
          {COMPANY.product} is operated by {COMPANY.operator} ({COMPANY.rc}), {COMPANY.address}.
          Telephone{' '}
          <a className="text-primary hover:underline" href={COMPANY.phoneHref}>
            {COMPANY.phone}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  )
}
