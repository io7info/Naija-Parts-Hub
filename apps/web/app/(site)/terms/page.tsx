import type { Metadata } from 'next'
import { COMPANY, LegalPage, LegalSection } from '@/components/web/legal-page'

export const metadata: Metadata = {
  title: 'Terms and Conditions',
  alternates: { canonical: '/terms' },
}

// PLACEHOLDER COPY — pending professional legal review.
// Deliberately isolated in this file so it can be replaced wholesale without
// touching layout, navigation or any other page.
export default function TermsPage() {
  return (
    <LegalPage
      title="Terms and Conditions"
      updated="Pending legal review"
      intro="These terms govern use of the Naija Parts Hub marketplace."
    >
      <LegalSection heading="1. The platform">
        <p>
          {COMPANY.product} is operated by {COMPANY.operator} ({COMPANY.rc}). The platform lists
          automotive parts offered by independent dealers.
        </p>
      </LegalSection>

      <LegalSection heading="2. No party to transactions">
        <p>
          {COMPANY.product} is a listing service. It does not sell parts, hold stock, process
          payments, or act as agent for any dealer. Contracts of sale are formed directly between
          buyer and dealer.
        </p>
      </LegalSection>

      <LegalSection heading="3. Dealer obligations">
        <p>
          Dealers must be registered businesses, provide accurate CAC details, and list only parts
          they hold. Listings that are inaccurate, misleading or prohibited may be removed and the
          account suspended.
        </p>
      </LegalSection>

      <LegalSection heading="4. Subscriptions">
        <p>
          Free accounts may keep up to 10 active listings. Paid plans raise this limit for the paid
          period. Subscription fees are for platform access only and are not connected to any sale.
        </p>
      </LegalSection>

      <LegalSection heading="5. Liability">
        <p>
          To the extent permitted by Nigerian law, {COMPANY.operator} is not liable for the quality,
          fitness, legality or delivery of parts sold through the platform.
        </p>
      </LegalSection>
    </LegalPage>
  )
}
