import { ShieldAlert } from 'lucide-react'
import { Logo } from '@/components/brand/logo'
import { SignOutButton } from './sign-out-button'

/**
 * Shown to a verified user who lacks the super_admin claim.
 *
 * Distinct from the sign-in redirect on purpose: this person IS signed in, so
 * sending them back to sign in would loop. They need to know the account is
 * wrong, not the password.
 */
export function AdminForbidden({ email }: { email: string | null }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-dark px-4 py-10">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center">
          <Logo variant="dark" size={48} />
        </div>

        <div className="mt-8 rounded-2xl border border-white/10 bg-soft-black p-8">
          <ShieldAlert className="mx-auto size-10 text-orange" />
          <h1 className="mt-4 font-heading text-xl font-bold text-white">Not authorized</h1>
          <p className="mt-3 text-sm leading-relaxed text-white/60">
            {email ? (
              <>
                <span className="text-white/80">{email}</span> is signed in, but this account does
                not have administrator access.
              </>
            ) : (
              <>This account does not have administrator access.</>
            )}
          </p>
          <p className="mt-3 text-xs text-white/40">
            Administrator access is granted by Lytod Motors HQ and cannot be requested from here.
          </p>

          <div className="mt-6">
            <SignOutButton label="Sign in with a different account" />
          </div>
        </div>
      </div>
    </main>
  )
}
