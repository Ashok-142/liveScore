# Culbcric Live Scoring Platform

Monorepo starter for a cricket live-scoring platform with:
- Separate frontend (`apps/web`) and backend (`apps/api`)
- Realtime updates through Socket.IO
- PostgreSQL + Prisma for team/player/match/event stats persistence
- Shared TypeScript contract package (`packages/shared`) for future web + mobile reuse

## Architecture

- `apps/api`: Express REST API + Socket.IO realtime channel + Prisma ORM
- `apps/web`: React + Vite web client for scoring + dashboard
- `packages/shared`: Reusable types and enums for clients (web now, mobile later)

## Quick Start

### Prerequisites

- Node.js 20+
- npm 10+
- Docker (for local PostgreSQL)

### 1) Start PostgreSQL (Docker)

```bash
docker compose up -d
```

### 2) Install dependencies

```bash
npm install
```

### 3) Configure environment

```bash
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env
```

### 4) Generate Prisma client and run migrations

```bash
npm run db:generate
npm run db:migrate
```

### 5) Run API + Web

Single command:

```bash
npm run dev
```

Or in separate terminals:

```bash
npm run dev:api
```

```bash
npm run dev:web
```

- API: `http://localhost:4000`
- Web: `http://localhost:5173`

## Mobile Expansion Plan

Your backend is already mobile-ready via REST + Socket.IO.
To build iOS/Android later:
1. Create an Expo React Native app in `apps/mobile`.
2. Reuse API endpoints and Socket.IO events from `apps/api`.
3. Reuse type contracts from `packages/shared`.
4. Keep business logic in backend so web/mobile remain thin clients.

Detailed roadmap: `docs/mobile-roadmap.md`.

## Core Domain Supported

- Team creation and listing
- Player creation per team and listing
- Match creation and live status
- Ball-by-ball scoring events
- Realtime score push (`score:update`)
- Career and match stats persistence per player/team
