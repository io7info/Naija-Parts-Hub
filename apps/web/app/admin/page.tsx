import { redirect } from 'next/navigation'

/**
 * /admin is the console entry point, so it sends visitors to sign-in.
 *
 * The prototype served the login form here and made its button a plain link to
 * /admin/overview. Redirecting instead keeps the URL working while ensuring
 * there is exactly one sign-in page, at /admin/login, for Stage 10 to protect.
 */
export default function AdminIndexPage() {
  redirect('/admin/login')
}
