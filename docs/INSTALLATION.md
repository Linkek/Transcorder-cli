# Installation

## Prerequisites

| Requirement | Version | Notes |
|---|---|---|
| Node.js | v20+ (v24+ recommended) | |
| npm | v9+ | |
| FFmpeg | v5+ | Must include NVENC support |
| NVIDIA GPU | RTX 2060+ | For hardware-accelerated encoding |
| NVIDIA Drivers | Latest stable | CUDA toolkit not strictly required |
| Linux | Any modern distro | Tested on Ubuntu/Debian; macOS/WSL may work |

### Verify FFmpeg NVENC Support

```sh
ffmpeg -encoders 2>/dev/null | grep nvenc
```

You should see `hevc_nvenc` and `h264_nvenc` in the output.

## Install

```sh
git clone <repo-url>
cd transcorder
npm install
```

### Build the Web UI (optional)

If you want the web dashboard:

```sh
cd web && npm install && cd ..
npm run build
```

Or build everything at once:

```sh
npm run build    # Compiles CLI (tsc) + Web UI (vite build)
```

## Configuration

Copy the example configuration and customize it:

```sh
cp config/profiles.example.json config/profiles.json
```

Edit `config/profiles.json` with your settings. See [CONFIGURATION.md](CONFIGURATION.md) for all options.

## Quick Start

```sh
# Start the daemon (watches folders, transcodes automatically)
npm run daemon

# Or use the interactive menu
npm start
```

## Updating

```sh
git pull
npm install
npm run build
```

If the web UI dependencies changed:

```sh
cd web && npm install && cd ..
npm run build
```
