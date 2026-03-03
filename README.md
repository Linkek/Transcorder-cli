# Transcorder-cli

A high-performance, scriptable video transcoding CLI tool for bulk media processing, designed as a modern, flexible alternative to Tdarr. Built with TypeScript, Node.js, and FFmpeg (NVENC), it supports job tracking, interactive menus, and advanced automation for home media servers.

## Features

- **Fast GPU transcoding** (NVIDIA NVENC, RTX 2060+ recommended)
- **Configurable profiles** (resolution, codec, HDR removal, output format, etc.)
- **Job tracking** with SQLite (WAL mode)
- **Interactive CLI menus** for scanning, processing, and monitoring
- **Automatic cache cleanup** (startup, shutdown, and after jobs)
- **Release tag stripping** for clean output filenames
- **Priority-based job queue**
- **Minimum size reduction enforcement** (skip jobs that don't save enough space)
- **Comprehensive test suite** (Vitest)

## Requirements

- **Node.js** v20+ (recommended: v24+)
- **npm** or **pnpm**
- **FFmpeg** v5+ (with NVENC support, e.g. `ffmpeg -encoders | grep nvenc`)
- **NVIDIA GPU** (RTX 2060 or better for NVENC)
- **NVIDIA drivers** and **CUDA toolkit** installed
- **SQLite3** (for job database)
- **Linux** (tested), should work on macOS/WSL with compatible hardware

## Setup

1. **Clone the repo:**
   ```sh
   git clone <repo-url>
   cd transcorder
   ```
2. **Install dependencies:**
   ```sh
   npm install
   # or
   pnpm install
   ```
3. **Configure profiles:**
   - Edit `config/profiles.json` to define your transcoding rules.
   - Example profile:
     ```json
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
     ```
   - See comments in the file for all options.

4. **Run tests (optional, but recommended):**
   ```sh
   npm run test:run
   # or
   pnpm test
   ```

5. **Start the CLI:**
   ```sh
   npm start
   # or
   pnpm start
   ```

## Usage

- Use the interactive menu to scan, process, and monitor jobs.
- Jobs are tracked in the SQLite database; completed/skipped jobs are not re-processed unless cleared.
- Failed jobs are retried automatically on rescan.
- Cache is cleaned at startup/shutdown and after failed jobs.
- Output filenames are cleaned of release tags and formatted as `Title-S01E01-1080p.mkv`.
- If the transcoded file is not at least `minSizeReduction`% smaller, it is skipped and the original is kept.

## Best Practices

- **Back up your media** before using `replaceFile: true`.
- Use a fast SSD for the cache folder for best performance.
- Set `minSizeReduction` to avoid unnecessary re-encodes.
- Tune `nvencPreset` and `cqValue` for your quality/speed needs.
- Use separate profiles for different types of content (e.g., movies vs. TV).
- Review logs in the `logs/` folder if enabled.

## Troubleshooting

- **FFmpeg not found:** Ensure it is installed and in your PATH.
- **NVENC errors:** Check your GPU, drivers, and FFmpeg build.
- **Permission errors:** Make sure the user running transcorder has read/write access to all folders.
- **Database issues:** Delete or back up the `jobs.sqlite` file if you want to reset all job history.

## Contributing

PRs and issues are welcome! Please run the test suite before submitting changes.

## License

MIT
