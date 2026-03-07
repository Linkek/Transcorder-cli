# Transcorder — AI Coding Instructions

## Project Overview

Transcorder is a **TypeScript CLI video transcoding daemon** (v1.2.1) that batch-converts video files using NVIDIA NVENC GPU encoding. It has two main surfaces:

1. **CLI / Daemon** — Node.js backend (`src/`) written in TypeScript, runs via `tsx`
2. **Web UI** — React 19 SPA (`web/`) using MUI v6, served by the backend Express 5 server

---

## Tech Stack

### Backend (CLI + API)

| Layer | Technology |
|---|---|
| Runtime | Node.js v24+, ESM (`"type": "module"`) |
| Language | TypeScript 5.7+ (strict mode) |
| Build | `tsc` → `dist/` |
| Dev runner | `tsx` (no build step needed for dev) |
| Database | better-sqlite3 (WAL mode) |
| Transcoding | fluent-ffmpeg + NVENC hardware encoding |
| File watching | chokidar v4 |
| HTTP server | Express 5.2 (only when `webui: true` in config) |
| Auth | express-session, session-based login |
| Testing | vitest 4 |

### Frontend (Web UI)

| Layer | Technology |
|---|---|
| Framework | React 19.1 |
| Build | Vite 6 |
| UI library | MUI v6 (Material UI) — `@mui/material` 6.4.8 |
| Data table | material-react-table v3 |
| Data fetching | TanStack React Query v5 |
| Styling | MUI's `sx` prop + centralized theme tokens |

---

## Project Structure

```
src/
  cli.ts                  # CLI entry point, command routing, interactive menu
  commands/               # Top-level command implementations
    daemon.ts             # Daemon mode: watcher, keyboard handler, web UI boot
    scan.ts               # One-shot directory scan
    audit.ts              # Audit existing transcoded files
    config.ts             # Show/edit configuration
    status.ts             # Show queue/job status
    analyze.ts            # Analyze single file
    diagnostics.ts        # System diagnostics (ffmpeg, GPU)
    shared.ts             # Shared command helpers
    index.ts              # Re-exports
    database.ts           # Database management commands
  lib/                    # Core library modules
    queue.ts              # Worker pool (2 slots), priority queue, pause/resume
    transcode.ts          # ffmpeg transcoding logic, TranscodeHandle for kill
    ffmpeg.ts             # ffprobe/ffmpeg wrappers, resolution helpers
    db.ts                 # SQLite schema, CRUD for jobs/metadata
    webui.ts              # Express app: REST API endpoints, static file serving
    watcher.ts            # chokidar filesystem watcher
    profiles.ts           # Profile loading/validation from JSON config
    cache.ts              # Cache folder management
    check.ts              # Pre-transcode analysis (should file be transcoded?)
    dashboard.ts          # Terminal dashboard (worker display, progress bars)
    display.ts            # CLI display helpers (status lines, tables)
    logger.ts             # File logger
    menu.ts               # Interactive CLI menu (inquirer-style)
    utils.ts              # Utility functions (file size, duration, filename)
  types/
    index.ts              # All TypeScript interfaces (GlobalConfig, Profile, Job, etc.)

web/
  src/
    main.tsx              # React entry point
    App.tsx               # Auth routing, React Query provider
    theme.ts              # MUI theme + centralized design tokens
    api.ts                # Typed API client (fetch wrappers for all endpoints)
    components/
      Layout.tsx          # App shell, sidebar, top bar
      Dashboard.tsx       # Stats cards, active worker display
      JobsTable.tsx       # material-react-table with accordion sections
      ProfilesView.tsx    # Profile cards display
      Login.tsx           # Login form

config/
  profiles.json           # User's transcoding configuration (git-ignored)
  profiles.example.json   # Example configuration template

tests/                    # vitest unit + integration tests
data/                     # SQLite database (git-ignored)
logs/                     # Transcode log files (git-ignored)
cache/                    # Temporary transcode output (git-ignored)
```

---

## Critical Conventions

### TypeScript / Backend

- **ESM only** — all imports use `.js` extensions (`import { foo } from './bar.js'`), even for `.ts` files. This is required by Node.js ESM resolution.
- **Strict mode** — `tsconfig.json` has `"strict": true`. No `any` types without justification.
- **No classes** — the codebase uses **functions and module-level state**, not OOP classes.
- **Interfaces in `src/types/index.ts`** — all shared types go here. Import from `'../types/index.js'`.
- **Database** — better-sqlite3 with WAL mode. Schema lives in `src/lib/db.ts`. Tables: `jobs`, `source_metadata`, `output_metadata`.
- **Worker pool** — `src/lib/queue.ts` manages a 2-worker pool (`NUM_WORKERS`). Each worker has a slot tracked in `workerSlots[]` and active transcodes in `activeTranscodes` Map for pause-with-kill.
- **Config** — `config/profiles.json` has `global` + `profiles` sections. Loaded by `src/lib/profiles.ts`. Types in `GlobalConfig` and `Profile` interfaces.

### React / Frontend

- **MUI v6** — use `@mui/material` v6 APIs. Grid component is Grid2 (imported as `Grid` from `@mui/material/Grid`). **Do NOT use deprecated Grid v1.**
- **MUI v6 Grid spacing** — always pass `spacing={tokens.gridSpacing}` explicitly on Grid containers. MUI v6 Grid2 `defaultProps` do not work for `spacing`; it must be set inline on each container.
- **Theme tokens** — all design values (colors, radii, spacing) are centralized in `web/src/theme.ts` under the `tokens` object. Import `{ tokens }` and use throughout components. Never hardcode colors or spacing.
- **`sx` prop** — use MUI's `sx` prop for styling. No CSS files, no styled-components, no inline `style={}`.
- **TanStack React Query** — all API data fetching uses `useQuery`/`useMutation`. The query client is set up in `App.tsx`.
- **API client** — `web/src/api.ts` provides typed functions for every endpoint. All fetch calls go through the `request<T>()` helper which handles credentials, JSON parsing, and errors.
- **No `useEffect` for data fetching** — use React Query hooks instead.
- **Component structure** — each component is a single `.tsx` file in `web/src/components/`. No barrel files in components.

### General Rules

- **No semicolons policy** — the codebase does NOT consistently use semicolons. Follow whatever the surrounding code does in the file you're editing.
- **Single quotes** for strings.
- **2-space indentation** in TypeScript/TSX. Same for JSON.
- **Functional style** — prefer `const` + arrow functions. Use `Array.map/filter/reduce` over `for` loops where readable.
- **Error handling** — always handle errors gracefully. The daemon must never crash; log and continue.
- **Console output** — CLI uses `chalk` for colors, `figures` for icons, `cli-progress` for progress bars, `boxen` for boxes. The dashboard module (`src/lib/dashboard.ts`) manages terminal output during daemon mode.

---

## API Endpoints (Express backend)

The web UI API is served at `/api` when `global.webui` is `true`:

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/auth/status` | Auth check |
| POST | `/api/auth/login` | Session login |
| POST | `/api/auth/logout` | Session logout |
| GET | `/api/stats` | Queue stats (counts, saved bytes, paused state) |
| GET | `/api/jobs` | All jobs with metadata |
| GET | `/api/jobs/:id` | Single job detail |
| DELETE | `/api/jobs/:id` | Delete a job |
| POST | `/api/jobs/clear` | Clear jobs by status |
| POST | `/api/queue/pause` | Pause queue (kills active transcodes) |
| POST | `/api/queue/resume` | Resume queue |
| GET | `/api/profiles` | List loaded profiles |

---

## Build & Run

```bash
# Install
npm install && cd web && npm install && cd ..

# Dev (no build needed)
npm run daemon              # Start daemon mode
npm run daemon -- --verbose # Verbose logging

# Build everything (CLI + web UI)
npm run build

# Build separately
npm run build:cli           # TypeScript only → dist/
npm run build:web           # Vite build → web/dist/

# Test
npm run test:run            # Unit tests
npm run test:integration    # Integration tests (needs ffmpeg)
npm run test:all            # All tests
```

---

## Common Pitfalls

1. **MUI Grid spacing** — Grid v6 ignores `defaultProps` for spacing. Always pass `spacing={tokens.gridSpacing}` on the container.
2. **ESM imports** — every relative import needs the `.js` extension: `import { foo } from './bar.js'`, not `'./bar'`.
3. **Express 5** — route callbacks receive `(req, res, next)`. Error handling uses `express.ErrorRequestHandler`. Express 5 returns promises from `res.json()`.
4. **Database access** — always use the helper functions in `src/lib/db.ts`. Never open raw SQLite connections.
5. **Active transcode handles** — `queue.ts` tracks running ffmpeg processes in `activeTranscodes` Map. When pausing, these are killed. Any new transcode code must register handles here.
6. **Theme tokens** — never introduce new magic color/spacing values. Add them to `tokens` in `theme.ts` and reference from there.
7. **React Query invalidation** — after mutations, invalidate the relevant query keys so the UI updates.
8. **File paths** — the daemon works with absolute paths everywhere. Profile `sourceFolders` are absolute paths on disk.

---

## Testing

- Framework: **vitest 4**
- Tests live in `tests/` directory
- Unit tests: `check.test.ts`, `ffmpeg.test.ts`, `profiles.test.ts`, `utils.test.ts`, `size-reduction.test.ts`, `hdr-removal.test.ts`
- Integration tests: `aspect-ratio.integration.test.ts` (requires ffmpeg binary)
- Run with `npm run test:run` (excludes integration) or `npm run test:all`
- When adding new logic, add corresponding tests

---

## When Modifying Code

- Read the surrounding file context before making changes
- Maintain existing patterns — don't introduce new libraries without good reason
- Keep the daemon resilient — it runs 24/7, never let it crash from a single file error
- The terminal dashboard redraws frequently — any stdout/stderr during daemon mode should go through `dashLog()`, not `console.log()`
- Web UI components should stay responsive and work on both desktop and mobile viewports
