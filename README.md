# Transcorder

A high-performance video transcoding daemon for bulk media processing. Built with TypeScript, Node.js, and FFmpeg (NVIDIA NVENC), it features a 2-worker job queue, real-time terminal dashboard, web UI, and flexible profile-based configuration — a modern, self-hosted alternative to Tdarr.

## Features

- **GPU-accelerated transcoding** — NVIDIA NVENC with configurable presets (p1–p7) and constant quality
- **Daemon mode** — continuous file watcher with a 2-worker parallel queue
- **Web UI dashboard** — React 19 + MUI v6 SPA for monitoring jobs, stats, and profiles remotely
- **Profile system** — separate configs per content type (movies, series, anime, etc.)
- **Job tracking** — SQLite database tracks every file through pending → completed/failed/skipped
- **Smart skipping** — minimum size reduction enforcement, duplicate detection, resolution-aware
- **HDR → SDR tone mapping** — automatic removal when configured
- **Pause / resume** — press `p` in the terminal or use the web UI; active transcodes are killed and re-queued
- **Pause on startup** — optionally start the daemon paused for manual review
- **Interactive CLI** — menus for scanning, auditing, status, diagnostics, and database management
- **Automatic cache cleanup** — on startup, shutdown, and after failed jobs
- **Priority queue** — higher-priority profiles are processed first
- **Filename cleanup** — strips release tags and adds resolution tags (e.g. `Title S01E01-720p.mkv`)
- **Comprehensive test suite** — Vitest 4 with unit and integration tests

## Requirements

| Dependency | Version |
|---|---|
| Node.js | v24+ |
| npm | v10+ |
| FFmpeg | v5+ with NVENC support |
| NVIDIA GPU | RTX 2060 or better |
| NVIDIA drivers | Compatible with your GPU |
| OS | Linux (tested on Ubuntu/Debian) |

Verify NVENC support: `ffmpeg -encoders 2>/dev/null | grep nvenc`

## Quick Start

```bash
# Clone and install
git clone <repo-url> && cd transcorder
npm install
cd web && npm install && cd ..

# Copy and edit configuration
cp config/profiles.example.json config/profiles.json
# Edit config/profiles.json with your source folders and settings

# Start the daemon
npm run daemon
```

See [docs/INSTALLATION.md](docs/INSTALLATION.md) for detailed setup instructions.

## Configuration

Configuration lives in `config/profiles.json` with two sections:

### Global Settings

```json
{
  "global": {
    "webui": true,
    "webuiPort": 9800,
    "webuiUsername": "admin",
    "webuiPassword": "transcorder",
    "localAllow": true,
    "pauseOnStartup": false
  }
}
```

### Profiles

Each profile defines a set of source folders and transcoding rules:

```json
{
  "profiles": [
    {
      "name": "movies",
      "sourceFolders": ["/media/movies"],
      "recursive": true,
      "replaceFile": true,
      "outputFormat": "mkv",
      "cacheFolder": "cache",
      "maxWidth": 1920,
      "maxHeight": 1080,
      "downscaleToMax": true,
      "renameFiles": true,
      "removeHDR": true,
      "nvencPreset": "p4",
      "cqValue": 23,
      "log": false,
      "priority": 5,
      "minSizeReduction": 2
    }
  ]
}
```

See [docs/CONFIGURATION.md](docs/CONFIGURATION.md) for all options, NVENC presets, and CQ tuning guidance.

## Usage

### Daemon Mode

```bash
npm run daemon              # Start watching and processing
npm run daemon -- --verbose # With verbose logging
```

**Keyboard shortcuts** during daemon mode:

| Key | Action |
|---|---|
| `p` | Pause / resume the queue |
| `q` | Quit the daemon |

The terminal dashboard shows worker status, progress bars, and queue stats in real time.

### One-Shot Commands

```bash
npm start                   # Interactive CLI menu
npm run scan                # Scan and queue files (no watching)
npm run audit               # Audit previously transcoded files
```

### Build

```bash
npm run build               # Build CLI + web UI
npm run build:cli           # TypeScript only → dist/
npm run build:web           # Vite build → web/dist/
```

### Testing

```bash
npm run test:run            # Unit tests
npm run test:integration    # Integration tests (requires ffmpeg)
npm run test:all            # All tests
```

## Web UI

Enable the web UI in your config (`"webui": true`) and access it at `http://localhost:9800`.

Features:
- Real-time queue stats and active worker display
- Job table with filtering by status (completed, failed, skipped, pending)
- Pause/resume controls
- Profile overview
- Session-based authentication (localhost can bypass login with `localAllow`)

See [docs/WEBUI.md](docs/WEBUI.md) for API reference and development workflow.

## Project Structure

```
src/                        # TypeScript backend (CLI + API)
  cli.ts                    # Entry point, command routing
  commands/                 # Command implementations (daemon, scan, audit, etc.)
  lib/                      # Core modules (queue, transcode, db, webui, etc.)
  types/                    # Shared TypeScript interfaces
web/                        # React 19 SPA (MUI v6 + Vite 6)
  src/components/           # Dashboard, JobsTable, Layout, Login, ProfilesView
config/                     # profiles.json configuration
tests/                      # Vitest unit + integration tests
```

## Best Practices

- **Back up your media** before using `replaceFile: true`
- Use a fast SSD or local disk for the `cache` folder
- Set `minSizeReduction` to avoid pointless re-encodes (2–5% is typical)
- Tune `nvencPreset` (p4 is a good balance) and `cqValue` (20–28 range) per content type
- Use separate profiles for movies, series, and anime with different quality targets
- Enable `log: true` per profile to debug transcoding issues

## Troubleshooting

| Problem | Solution |
|---|---|
| FFmpeg not found | Install FFmpeg and ensure it's in your `PATH` |
| NVENC errors | Check GPU drivers, CUDA toolkit, and FFmpeg NVENC support |
| Permission errors | Ensure read/write access to source folders, cache, and data directories |
| Database issues | Delete `data/transcorder.db` to reset job history |
| Web UI won't load | Verify `"webui": true` in config and check port 9800 isn't in use |
| Cache file errors (ENOENT) | Run `npm run daemon` — cache is auto-cleaned on startup |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture overview, and code style guidelines.

## License

[MIT](LICENSE) — Copyright 2026 Linkek
