# Repository engineering guidance

## Architecture

- Place browser/application infrastructure in `src/core/`, user-facing
  capabilities in `src/features/<feature>/`, map rendering concerns in
  `src/map/`, and reusable interface controllers in `src/ui/`.
- Keep modules compact and focused on one responsibility.
- Apply separation of concerns: UI wiring, data access, map rendering,
  lifecycle management, persistence, and domain logic should live in
  dedicated modules rather than accumulating in `src/main.ts`.
- Treat `src/main.ts` as a composition root. It may connect modules and own
  top-level application state, but reusable logic and self-contained
  subsystems belong in separate files.
- When adding a feature, prefer extracting a small typed module over growing
  an already broad file. Avoid unrelated refactors, but leave touched code
  no less maintainable than before.
- Define narrow typed interfaces between modules. Pass callbacks or state
  accessors when that avoids hidden coupling and circular imports.

## Maintainability

- Use kebab-case for file and directory names.
- Favor clear names, short functions, early returns, and explicit cleanup for
  event listeners, observers, timers, and other long-lived resources.
- Keep constants close to the subsystem that owns them.
- Avoid duplicated state transitions; centralize start/stop, pause/resume,
  persistence, and visibility behavior.
- Add comments for design constraints and non-obvious browser or upstream
  behavior, not for code that is already self-explanatory.
- Validate changes with the production build and focused tests or checks
  appropriate to the modified subsystem.
