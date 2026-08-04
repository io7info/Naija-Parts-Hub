import type { Metadata } from 'next'
import { COMPANY, LegalPage, LegalSection } from '@/components/web/legal-page'

export const metadata: Metadata = {
  title: 'Contact',
  description: 'Contact Naija Parts Hub, operated by Lytod Motors Ltd.',
  alternates: { canonical: '/contact' },
}

export default function ContactPage() {
  return (
    <LegalPage
      title="Contact us"
      intro="Questions about the platform, a dealer account, or a listing."
    >
      <LegalSection heading="Head office">
        <p>
          {COMPANY.operator} ({COMPANY.rc})
          <br />
          {COMPANY.address}
        </p>
      </LegalSection>

      <LegalSection heading="Telephone">
        <p>
          <a className="text-primary hover:underline" href={COMPANY.phoneHref}>
            {COMPANY.phone}
          </a>
        </p>
      </LegalSection>

      <LegalSection heading="Buying a part">
        <p>
          For questions about a specific part — price, condition, compatibility or delivery —
          contact the dealer directly using the phone or WhatsApp button on the listing. They hold
          the stock and handle the sale.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
