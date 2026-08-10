import { requireAdmin } from '@/lib/admin-session'
import { categoryUsage, listAllCategories } from '@/lib/repositories/categories'
import { CategoriesClient } from './categories-client'

// requireAdmin() runs before any JSX exists, so an unauthorised request
// produces no RSC payload to leak. The layout gate alone is not enough:
// Next renders layout and page concurrently, so a redirect from the layout
// still lets this page render into the redirect body.
export default async function CategoriesPage() {
  await requireAdmin()

  // Every category, including deactivated ones — the public reader filters on
  // `active`, and an administrator has to be able to see what they switched off
  // in order to switch it back on.
  //
  // Usage counts come with them because the page refuses to deactivate a
  // category that published listings still use, and a refusal a moment after
  // the click reads as a bug. Showing the count up front makes it a decision.
  const [categories, usage] = await Promise.all([listAllCategories(), categoryUsage()])

  return (
    <CategoriesClient
      categories={categories.map((c) => ({
        id: c.categoryId,
        name: c.name,
        order: c.order,
        active: c.active,
        total: usage[c.categoryId]?.total ?? 0,
        live: usage[c.categoryId]?.live ?? 0,
      }))}
    />
  )
}
