# CLAUDE.md — standing rules for this project

## Language and tone
- English only throughout the codebase and all generated text.
- Client-facing text must be plain English: short sentences, everyday words, reading age around 9. Avoid legal jargon; if a legal term is unavoidable, follow it with a one-line plain-English explanation.

## Client / staff separation
- Clients and staff are completely separate. Nothing AI-related is ever visible to or reachable by clients.
- The staff portal lives at `/staff` and all staff API routes are under `/api/staff/`. Client routes are under `/api/client/`. Never mix them.

## Data access — always use visibleCases()
- Every staff data access must be scoped through `visibleCases()` (defined in `lib/documents.ts`):
  - Caseworkers see only their own clients.
  - Admins see every client in the firm.
- Never trust a `clientId` or document `id` that comes directly from the browser without first passing it through a `visibleCases()` filter. Violation is a data breach.

## Audit log and rate limits
- Every new action that touches client data must be written to the audit log via `audit()` from `lib/audit.ts`.
- Every endpoint that can be abused (auth, uploads, invites, resets) must be covered by a rate limit using `lib/ratelimit.ts`.

## Code patterns — follow existing conventions
- Storage adapters go in `lib/adapters/` and must support a `fake` mode for tests (check the existing SMS, email and storage adapters as examples).
- Throw `UserError` (from `lib/errors.ts`) for errors the user should see. Any other thrown value is an internal server error.
- API route handlers must use the `handler()` wrapper from `lib/api.ts` for consistent error handling and response shaping.

## Testing
- Every change ships with tests.
- Unit tests use **vitest** (`tests/` directory).
- User flows need **Playwright e2e** tests (`e2e/` directory), including phone-sized screens (375 px wide).
- Before marking any task done, run and pass all four checks:
  ```
  npm run typecheck
  npm run lint
  npm test
  npm run test:e2e
  ```
  Fix every failure; do not skip or suppress checks.

## Database migrations
- Prisma schema changes require a new migration file: `npx prisma migrate dev --name <short-description>`.
- Never edit an existing migration file.

## Never do these things
- Never deploy. Never run `scripts/deploy.sh` or any deploy script.
- Never send real emails. Keep `EMAIL_PROVIDER=fake` during development.
- Never commit `.env` or any file containing real credentials, tokens, or client data.
- Never delete or edit an existing migration file.
