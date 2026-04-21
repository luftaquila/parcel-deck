# Session handling design

Shopping mall cookie sessions expire frequently. ParcelDeck treats
that as the normal state and is designed around it.

## State machine

```
 ┌─────────┐   probe ok   ┌───────────────┐
 │ unknown │─────────────▶│ authenticated │
 └────┬────┘              └───────┬───────┘
      │                           │  cookies.onChanged(removed)
      │ probe fail                │  / probe fail
      ▼                           ▼
 ┌─────────┐  login page    ┌──────────┐
 │ expired │◀──────────────▶│refreshing│
 └────┬────┘                └────┬─────┘
      │                          │ cookies.onChanged(set) → probe
      │ N consecutive failures   ▼
      │                     authenticated
      ▼
 ┌─────────────┐
 │ unsupported │  (2FA / captcha / persistent failure)
 └─────────────┘
```

## Detection events

| Event | Location | Effect |
|-------|----------|--------|
| Auth cookie removed | `session-monitor.installCookieListener` | transition to `expired` |
| Auth cookie set | same | probe one second later → `authenticated` on success |
| Login page navigation | `installNavigationListener` | transition to `refreshing` |
| Mall page navigation | same | stale probe |
| 401 or login HTML mid-collection | each `collectors/*.ts` | throw `UnauthenticatedError` → `expired` |
| Captcha or 2FA during collection | same | throw `UnsupportedError` → `unsupported` |

## Backoff and retries

- **probe**: fails silently and keeps the current state (absorbs
  temporary network blips).
- **collection failures**: exponential backoff at 1s, 2s, 4s — up to
  three attempts.
- **5 consecutive `expired` transitions**: promote to `unsupported` and
  stop automatic collection.
- **keep-alive**: failures are harmless (the session monitor detects
  them independently).

## Keep-alive

- Per-mall `keepAliveIntervalMin` (Coupang 45 minutes, Naver and
  AliExpress 60 minutes each).
- Too-aggressive keep-alive triggers abuse detection, so the rate is
  capped at one to two hits per hour.
- Runs only in the `authenticated` state.

## User experience

- The action badge shows the number of malls that need re-login.
- `notifications.create` fires a toast on the first transition.
- In the popup, clicking a mall chip opens that mall's order page in
  a new tab.
- After the user logs back in, `cookies.onChanged` triggers an
  automatic probe and runs any queued collection.
