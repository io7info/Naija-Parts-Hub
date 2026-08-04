import type { Metadata } from 'next'
import { COMPANY, LegalPage, LegalSection } from '@/components/web/legal-page'

export const metadata: Metadata = {
  title: 'Privacy Policy',
  alternates: { canonical: '/privacy' },
}

// PLACEHOLDER COPY — pending professional legal review.
// A hosted privacy-policy URL is mandatory for both App Store and Play Store
// submission, so this page must exist and stay reachable.
export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy Policy"
      updated="Pending legal review"
      intro={`How ${COMPANY.product} handles personal information.`}
    >
      <LegalSection heading="Who we are">
        <p>
          {COMPANY.product} is operated by {COMPANY.operator} ({COMPANY.rc}), {COMPANY.address}.
        </p>
      </LegalSection>

      <LegalSection heading="What we collect">
        <p>
          <strong className="text-foreground">Buyers:</strong> browsing the marketplace requires no
          account. We collect no personal information from buyers beyond standard server logs.
        </p>
        <p>
          <strong className="text-foreground">Dealers:</strong> business name, owner name, phone
          number, CAC registration number, business address and listing content — all supplied
          during registration and required to verify the business.
        </p>
      </LegalSection>

      <LegalSection heading="How we use it">
        <p>
          Dealer details are used to verify businesses and to display public store information.
          Phone and WhatsApp numbers are shown publicly on listings so buyers can make contact —
          that is the core purpose of the platform.
        </p>
      </LegalSection>

      <LegalSection heading="Payments">
        <p>
          Subscription payments are processed by Paystack. Card details are entered on Paystack&apos;s
          own systems and are never received or stored by {COMPANY.product}.
        </p>
      </LegalSection>

      <LegalSection heading="Deleting your account">
        <p>
          Dealers can delete their account and all associated listings from within the mobile app,
          or by contacting us on{' '}
          <a className="text-primary hover:underline" href={COMPANY.phoneHref}>
            {COMPANY.phone}
          </a>
          .
        </p>
      </LegalSection>
    </LegalPage>
  )
}
