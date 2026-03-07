# Contributing to TranscoRder

Thanks for considering contributing! This guide will get you up and running quickly.

## Development Setup

### Prerequisites

- **Node.js** v20+ (v24+ recommended)
- **npm** v9+
- **FFmpeg** v5+ with NVENC support
- **NVIDIA GPU** with up-to-date drivers (RTX 2060+)

### Getting Started

```sh
git clone <repo-url>
cd transcorder
npm install
cd web && npm install && cd ..
```

### Build

```sh
# Build everything (CLI + Web UI)
npm run build

# Build CLI only
npm run build:cli

# Build Web UI only
npm run build:web
```

### Running in Development

```sh
# Interactive menu
npm start

# Daemon mode (watches folders, transcodes automatically)
npm run daemon

# Daemon with debug output
npm run daemon:verbose

# Scan & process (one-shot)
npm run scan
```

For web UI development with hot-reload:

```sh
# Terminal 1: Start daemon with webui enabled in profiles.json
npm run daemon

# Terminal 2: Start Vite dev server (hot-reload on port 5173)
cd web && npx vite
```

The Vite dev server proxies API requests to `http://localhost:9800`.

### Running Tests

```sh
# Unit tests (excludes integration tests)
npm run test:run

# All tests including integration
npm run test:all

# Watch mode
npm test

# With coverage
npm run test:coverage
```

Integration tests (`aspect-ratio.integration.test.ts`) require FFmpeg and are excluded from the default test run.

## Project Structure

```
transcorder/
├── src/                    # Backend CLI source (TypeScript)
│   ├── cli.ts              # Entry point, argument parsing
│   ├── commands/           # CLI commands (daemon, scan, audit, etc.)
│   ├── lib/                # Core libraries
│   │   ├── cache.ts        # Cache folder management
│   │   ├── check.ts        # Video analysis & transcode decisions
│   │   ├── dashboard.ts    # Terminal dashboard rendering
│   │   ├── db.ts           # SQLite job database
│   │   ├── display.ts      # Terminal output formatting
│   │   ├── ffmpeg.ts       # FFmpeg/ffprobe wrappers
│   │   ├── logger.ts       # Logging (console + file)
│   │   ├── menu.ts         # Interactive CLI menus
│   │   ├── profiles.ts     # Profile loading & validation
│   │   ├── queue.ts        # Job queue & worker pool
│   │   ├── transcode.ts    # FFmpeg transcode execution
│   │   ├── utils.ts        # Filename/path helpers
│   │   ├── watcher.ts      # Filesystem watcher (chokidar)
│   │   └── webui.ts        # Express API + static frontend server
│   └── types/              # TypeScript interfaces
├── web/                    # Frontend (React + Vite + MUI)
│   └── src/
│       ├── App.tsx          # Root component with auth routing
│       ├── api.ts           # API client functions
│       ├── theme.ts         # MUI theme & design tokens
│       └── components/
│           ├── Dashboard.tsx    # Stats cards, pause/resume
│           ├── JobsTable.tsx    # Job list with accordion sections
│           ├── Layout.tsx       # App shell, navigation
│           ├── Login.tsx        # Auth form
│           └── ProfilesView.tsx # Profile card grid
├── config/                 # Configuration files
│   ├── profiles.json       # Your active config (gitignored)
│   └── profiles.example.json  # Example configuration
├── tests/                  # Test suite (Vitest)
├── data/                   # SQLite database (gitignored)
├── cache/                  # Transcode temp files (gitignored)
├── logs/                   # Log files (gitignored)
└── dist/                   # Compiled CLI output (gitignored)
```

## Architecture

### Queue System

The daemon uses a worker pool (`NUM_WORKERS = 2` by default) with priority-based scheduling. Each worker:

1. Picks the highest-priority pending job
2. Analyzes the source file (resolution, HDR, codec)
3. Transcodes to a cache file using FFmpeg/NVENC
4. Compares file sizes (enforces `minSizeReduction`)
5. Replaces or skips based on results

Active transcodes can be killed when pausing (`SIGKILL` to ffmpeg process).

### Database

SQLite with WAL mode via `better-sqlite3`. Tables:
- `jobs` — Job tracking (status, source/output paths, timestamps, errors)
- `source_metadata` — Original file metadata (resolution, codec, HDR, etc.)
- `output_metadata` — Transcoded file metadata

### Web UI

Express 5 serves a REST API on the configured port (default `9800`). The React frontend is built with Vite and served as static files from `web/dist/`. Authentication uses express-session with optional localhost bypass (`localAllow`).

## Code Style

- TypeScript strict mode
- ESM modules (`"type": "module"`)
- No semicolons optional — the codebase uses semicolons
- Imports use `.js` extensions for ESM compatibility

## Pull Request Guidelines

1. Run the test suite: `npm run test:run`
2. Run `npm run build` to verify both CLI and web compile
3. Test changes with the daemon running against real media files when possible
4. Keep PRs focused — one feature or fix per PR
