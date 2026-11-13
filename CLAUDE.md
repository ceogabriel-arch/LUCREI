# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

Monorepo, three independent projects (no shared package manager workspace — each has its own `node_modules`/lockfile):

- `lucrei-backend/` — Fastify + Prisma API (TypeScript, Node). Also serves the compiled web build of the mobile app as static files, so it's both the API and the web host for `app.lucreiapp.com`.
- `lucrei-mobile/` — Expo/React Native app (iOS, Android, and Web via `react-native-web`), file-based routing via `expo-router`. This is the single source of truth for UI — the "web app" is this same codebase exported as static HTML/JS.
- `lucrei-desktop/` — Thin Electron wrapper (`lucrei-desktop/src/main.js`) that just loads `https://app.lucreiapp.com/` in a window. No real app logic lives here; only touch it for window chrome/icon/offline-page changes.

## Commands

### Backend (`lucrei-backend/`)
- `npm run dev` — run API locally with hot reload (`tsx watch src/index.ts`)
- `npm run build` — type-check + compile to `dist/`
- `npm test` — run all tests (Vitest). Single file: `npx vitest run src/modules/plans/serialize-user.test.ts`. Single test name: `npx vitest run -t "nome do teste"`
- `npm run prisma:generate` — regenerate Prisma client after editing `prisma/schema.prisma`
- `npm run prisma:migrate` — create + apply a dev migration
- `npm run compress:public` — regenerate `.br`/`.gz` sidecar files for the web build in `public/` (see Web export below)

### Mobile (`lucrei-mobile/`)
- `npx expo start` — dev server (`npm start`); `npm run web` for the web target specifically
- `npm run lint` — `expo lint`
- `npm run android:local:apk` / `android:local:aab` — local Android build via `scripts/build-android-local.sh` (reapplies `scripts/patch-android-build.js` after `expo prebuild`)
- EAS build/submit on this machine needs a workaround for a Windows+monorepo path bug in the EAS CLI — always run with:
  ```
  EAS_NO_VCS=1 EAS_PROJECT_ROOT="/z/Lucrei/lucrei-mobile" npx eas-cli build --platform ios --profile production --non-interactive
  EAS_NO_VCS=1 EAS_PROJECT_ROOT="/z/Lucrei/lucrei-mobile" npx eas-cli submit --platform ios --profile production --non-interactive
  ```

## Architecture

### Backend: modules + lib
Routes live one folder per domain under `src/modules/<name>/routes.ts` (auth, orders, products, plans, billing, apple-iap, mercadolivre, shops, sync, labels, rewards, admin, announcements, legal, ...), registered in `src/index.ts`. Shared business logic, background jobs, and payment-provider glue live in `src/lib/` (not in modules) — e.g. `subscription-access.ts`, `coupons.ts`, `plan-upgrade.ts`, `pix-billing.ts`, `*-webhook.ts`, `*-watchdog.ts`. External marketplace/payment SDKs each get their own top-level client folder: `shopee-client/`, `mercadolivre-client/`, `mercadopago-client/`, `hypercash-client/`.

Self-healing background watchdogs are started at the end of `main()` in `src/index.ts` (sync, shop-sync, hypercash expiry, trial expiry, canceled-subscription expiry) — these exist because past incidents left stores/subscriptions stuck in a bad state with nothing else to unstick them; when adding a new "X must flip state after time Y" rule, consider whether it needs the same kind of watchdog rather than relying on the user opening the app.

Data model: single `prisma/schema.prisma`, Postgres (Neon) — pooled `DATABASE_URL` for the app, direct `DIRECT_URL` for migrations.

### Web build pipeline (mobile → backend)
`app.lucreiapp.com` is not a separate frontend — it's `lucrei-mobile` exported as static web and hosted by the backend:
1. `cd lucrei-mobile && npx expo export --platform web`
2. Copy the export output into `lucrei-backend/public/`
3. `cd lucrei-backend && npm run compress:public` (pre-generates `.br`/`.gz`; live compression of large responses is broken on this Fastify/Node combo, see comment in `src/index.ts`)
4. Push to `main` — Railway auto-deploys `lucrei-backend` from there.

`src/index.ts` also has a static route per mobile screen (`/pedidos`, `/produtos`, `/relatorios`, `/etiquetas`, `/configuracoes`, `/shopee-connected`, `/mercadolivre-connected`, `/planos`, `/admin`) that each serve the matching exported HTML file — keep this list in sync with `lucrei-mobile/src/app/*.tsx` when adding or removing a top-level screen.

### Mobile
`expo-router` file-based routes in `src/app/`. `@/*` resolves to `src/*`, `@/assets/*` to `assets/*` (see `tsconfig.json`). API calls go through `src/lib/api.ts` (single `request<T>` helper, typed `ApiError` that distinguishes "no HTTP response at all" from a real 4xx/5xx — `auth.tsx` relies on that distinction to avoid logging the user out on a transient network failure). Platform-specific behavior (notably anything Apple-IAP/payment-related, which must never unlock paid features via a non-Apple path on iOS per App Store Guideline 3.1.1) is gated with `Platform.OS === 'ios'` checks rather than separate files.

Read `lucrei-mobile/AGENTS.md` before touching anything under `android/` or running `expo prebuild --clean` — it documents the upload keystore location and why regenerating/losing it is a multi-day incident, not a quick fix.
