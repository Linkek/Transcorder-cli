# Web UI

Transcorder includes an optional web dashboard for monitoring and controlling the daemon remotely.

## Enabling the Web UI

Set `webui: true` in the `global` section of `config/profiles.json`:

```json
{
  "global": {
    "webui": true,
    "webuiPort": 9800,
    "webuiUsername": "admin",
    "webuiPassword": "changeme",
    "localAllow": true
  }
}
```

Then start the daemon:

```sh
npm run daemon
```

The dashboard will be available at `http://localhost:9800`.

## Authentication

- **Session-based**: Login with the configured username/password
- **Local bypass**: When `localAllow` is `true`, requests from `localhost` skip authentication
- **24-hour sessions**: Sessions expire after 24 hours

## Dashboard Features

### Stats Overview
- Total completed, failed, skipped jobs
- Total disk space saved
- Queue status (active workers, pending jobs)

### Job Management
- View all jobs grouped by status (Completed, Pending/Active, Failed, Skipped)
- Delete individual jobs
- Retry failed jobs
- Clear jobs by status

### Queue Control
- Pause/resume the processing queue
- View active worker status

### Profile Viewer
- View all configured profiles and their settings

## API Endpoints

All API routes are under `/api/` and require authentication (unless `localAllow` applies).

### Auth

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/auth/login` | Login with `{ username, password }` |
| `POST` | `/api/auth/logout` | End session |
| `GET` | `/api/auth/status` | Check auth state |

### Stats & Jobs

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/stats` | Get combined stats and queue status |
| `GET` | `/api/jobs` | Get all jobs (optional `?limit=N`) |
| `DELETE` | `/api/jobs/:id` | Delete a job |
| `POST` | `/api/jobs/:id/retry` | Retry a failed job |
| `POST` | `/api/jobs/clear` | Clear jobs (optional `{ status }` in body) |

### Queue

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/queue/status` | Get queue status (active, pending, paused) |
| `POST` | `/api/queue/pause` | Pause the queue |
| `POST` | `/api/queue/resume` | Resume the queue |

### Profiles

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/profiles` | Get all configured profiles |

## Development

For frontend development with hot-reload:

```sh
# Terminal 1: Start daemon
npm run daemon

# Terminal 2: Start Vite dev server
cd web && npx vite
```

The Vite dev server runs on port `5173` and proxies `/api` requests to the daemon on port `9800`.

### Tech Stack

- **React 19** — UI framework
- **Vite 6** — Build tool
- **MUI v6** — Component library (Material Design)
- **TanStack React Query** — Data fetching & caching
- **material-react-table v3** — Advanced table component

### Building

```sh
# Build web UI only
cd web && npx vite build

# Build everything (CLI + Web UI)
npm run build
```

The built frontend is served by Express from `web/dist/` via `express.static`.
