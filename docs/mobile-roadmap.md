# Mobile Roadmap (iOS + Android)

## Recommended stack
- Expo + React Native app in `apps/mobile`
- Reuse backend REST + Socket.IO from `apps/api`
- Reuse shared contracts from `packages/shared`

## Phases

1. Scaffold Expo app
- Create `apps/mobile` with Expo TypeScript template.
- Add API service layer and Socket.IO client.

2. Reuse contracts
- Import enums/types from `@culbcric/shared`.
- Keep request/response validation aligned with backend.

3. Build live scoring screens
- Match list screen
- Match detail + live score screen
- Ball event entry screen
- Team and player stats screen

4. Authentication and roles (next step)
- Add scorer/admin auth to backend.
- Restrict scoring endpoints to authenticated scorers.

5. Production readiness
- API rate limiting and logging
- Background jobs for analytics
- Push notifications on wicket/innings/match events

## Why this works
Keeping scoring and stats logic in `apps/api` makes both web and mobile thin clients. This reduces duplication and keeps data consistent across platforms.
