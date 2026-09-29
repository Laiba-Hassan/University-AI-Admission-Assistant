# What's here and why

Nothing the app needs to run, build, or test lives in here — safe to delete either folder entirely if you want
the disk space back.

- **`references/`** — the four design-reference PDFs (`Enrollium_Design_Documentation.pdf`,
  `Enrollium_User_Dashboard_Everything.pdf`, `Enrollium_Super_Admin_Dashboard.pdf`,
  `Enrollium_User_Login_Signup.pdf`) used earlier to match the dashboard/widget UI pixel-for-pixel. Reference
  material only, not read by any code.
- **`.cache/`** — the on-disk embeddings cache (`embeddings.json`) `apps/api/src/embeddings.ts` writes to, so
  `pnpm seed` and the test suite don't re-bill identical text to Gemini on every run. Already gitignored, and
  fully regenerable — deleting it just means the next `pnpm seed`/`pnpm test` run re-embeds and rebuilds it from
  scratch at the (empty, freshly recreated) `.cache/` path back at the project root, since that path is
  hardcoded relative to `embeddings.ts`'s own location, not to wherever this cache file happens to sit.
