# Why this folder is empty

Everything actually needed for development — `apps/` (backend + all 4 frontends), `packages/shared`, `db/`
(migrations + RLS tests), `infra/` (DB roles), `data/` (seed content), `scripts/`, `docker-compose.yml`, and the
root config files (`package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.env*`, `.gitignore`) — **stays at
the project root**, exactly where it is today.

Physically moving those into this folder was the other option and was decided against: pnpm's workspace
resolution, Docker's volume mounts, `.github/workflows/ci.yml`, and a good number of source files (the seed
script, `apps/web`'s content loader, the embeddings cache path) all resolve paths relative to the project root.
Relocating the codebase would mean rewriting all of that plumbing and re-verifying the whole app (typecheck, the
full test suite, `docker compose up`, CI) before trusting it works again — a large, risky refactor for a project
that's currently working end to end, for no functional benefit.

So: **the project root itself *is* the development folder.** See [`../docs/PROJECT_MAP.md`](../docs/PROJECT_MAP.md)
for the full map of what's there and how it fits together.

What actually moved out is in [`../not-needed-for-development/`](../not-needed-for-development/) — the design
reference PDFs and the regenerable embeddings cache, neither of which the app needs to run, build, or test.
