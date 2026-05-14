# Repository Guidelines

## Project Structure & Module Organization

This is a Next.js 15 TypeScript app for administering hosted Nightscout instances. App routes live in `src/app`, shared UI in `src/lib/components`, services in `src/lib/services`, validations in `src/lib/validations`, and test utilities in `src/lib/test-utils.ts`. Jest tests are colocated in `__tests__` folders or under `src/__tests__`. Prisma schema and migrations live in `prisma/`; generated Prisma code is under `src/generated`. Translations are in `messages/`; email templates are in `emails/`; static assets are in `public/`; VPS automation is in `hosting/`.

## Build, Test, and Development Commands

- `pnpm install`: install dependencies from `pnpm-lock.yaml`.
- `cp .env.example .env`: create local configuration before development.
- `pnpm prisma generate`: regenerate the Prisma client after schema changes.
- `pnpm run dev`: start the local Next.js server at `http://localhost:3000`.
- `pnpm run test`: run Jest tests in jsdom.
- `pnpm run build`: create a production build with the current git commit hash.
- `pnpm run storybook`: run Storybook at `http://localhost:6006`.
- `pnpm run pretty`: format supported JS, TS, TSX, and JSON files with Prettier.

## Coding Style & Naming Conventions

Follow the existing TypeScript/React style: strict TypeScript, functional components, and path aliases such as `@/lib/...`. Prettier uses 4-space indentation, semicolons, single quotes, ES5 trailing commas, and a 120-character print width. Use PascalCase for React components, camelCase for functions and variables, and route folder names that match Next.js App Router conventions.

## Testing Guidelines

The project uses Jest, `next/jest`, jsdom, and Testing Library. Name tests `*.test.ts` or `*.test.tsx`; keep component tests near the component in `__tests__` when practical. Update i18n tests when changing visible text or translation keys. Run `pnpm run test` before submitting, and use `pnpm run clear_jest` if cached transforms cause confusing results.

## Commit & Pull Request Guidelines

Recent history uses concise subjects, often Conventional Commit style for dependency work, for example `chore(deps): bump next-intl from 4.5.3 to 4.6.1`. Prefer short, imperative summaries and scopes when useful. Pull requests should describe the change, note tests run, link issues, and include screenshots or Storybook notes for UI changes. Call out generated Prisma updates, translation changes, and hosting script edits.

## Security & Configuration Tips

Do not commit secrets from `.env`, `.env.local`, `.env.production`, or `.private/`. Use `.env.example` for documented configuration only. Treat `hosting/scripts` as production-impacting automation; review hostnames, credentials, firewall changes, and DNS behavior before editing them.
