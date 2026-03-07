# Configuration

TranscoRder is configured via `config/profiles.json`. Copy the example to get started:

```sh
cp config/profiles.example.json config/profiles.json
```

The file has two sections: `global` and `profiles`.

## Global Configuration

```json
{
  "global": {
    "webui": false,
    "webuiPort": 9800,
    "webuiUsername": "admin",
    "webuiPassword": "transcorder",
    "localAllow": true,
    "pauseOnStartup": false
  }
}
```

| Option | Type | Default | Description |
|---|---|---|---|
| `webui` | boolean | `false` | Enable the web dashboard |
| `webuiPort` | number | `9800` | Port for the web UI server |
| `webuiUsername` | string | `"admin"` | Login username for the web UI |
| `webuiPassword` | string | `"transcorder"` | Login password for the web UI |
| `localAllow` | boolean | `true` | Skip authentication for localhost requests |
| `pauseOnStartup` | boolean | `false` | Start the queue in paused state |

## Profile Configuration

Each profile defines a set of transcoding rules for a folder of media files.

```json
{
  "profiles": [
    {
      "name": "series",
      "sourceFolders": "/mnt/nas/Media/Series/",
      "recursive": true,
      "replaceFile": true,
      "outputFormat": "mkv",
      "cacheFolder": "cache",
      "maxWidth": 1280,
      "maxHeight": 720,
      "downscaleToMax": true,
      "renameFiles": true,
      "removeHDR": true,
      "nvencPreset": "p4",
      "cqValue": 23,
      "log": false,
      "priority": 10,
      "minSizeReduction": 2
    }
  ]
}
```

### Profile Options

| Option | Type | Required | Description |
|---|---|---|---|
| `name` | string | Yes | Unique identifier for the profile |
| `sourceFolders` | string \| string[] | Yes | Path(s) to scan for video files |
| `recursive` | boolean | Yes | Scan subdirectories |
| `replaceFile` | boolean | Yes | Replace the original file with the transcoded output |
| `outputFolder` | string | No | Output directory (used when `replaceFile` is false) |
| `outputFormat` | string | Yes | Container format: `"mkv"`, `"mp4"` |
| `cacheFolder` | string | Yes | Temporary folder for active transcodes |
| `maxWidth` | number | Yes | Maximum output width in pixels |
| `maxHeight` | number | Yes | Maximum output height in pixels |
| `downscaleToMax` | boolean | Yes | Downscale videos exceeding max dimensions |
| `renameFiles` | boolean | Yes | Clean filenames (strip release tags, add resolution) |
| `removeHDR` | boolean | Yes | Tone-map HDR content to SDR |
| `nvencPreset` | string | Yes | NVENC quality preset: `"p1"` (fastest) to `"p7"` (best quality) |
| `cqValue` | number | Yes | Constant quality value (lower = better quality, larger file; 18-28 typical) |
| `log` | boolean | Yes | Write per-file logs to `logs/` |
| `priority` | number | Yes | Queue priority (higher = processed first) |
| `minSizeReduction` | number | Yes | Minimum size savings required (percentage, e.g. `2` = 2%) |

### NVENC Presets

| Preset | Speed | Quality | Use Case |
|---|---|---|---|
| `p1` | Fastest | Lowest | Quick previews, testing |
| `p2` | Very fast | Low | Bulk processing, less important content |
| `p3` | Fast | Below average | |
| `p4` | Medium | Good | **Recommended default** |
| `p5` | Slow | High | High-quality encodes |
| `p6` | Very slow | Very high | |
| `p7` | Slowest | Highest | Archival quality |

### CQ Value Guidelines

| CQ Value | Quality | File Size |
|---|---|---|
| 18-20 | Near lossless | Very large |
| 21-23 | High quality | Large |
| 24-26 | Good quality | Medium |
| 27-30 | Acceptable | Small |
| 31+ | Low quality | Very small |

## Example: Multi-Profile Setup

```json
{
  "global": {
    "webui": true,
    "webuiPort": 9800,
    "webuiUsername": "admin",
    "webuiPassword": "changeme",
    "localAllow": true,
    "pauseOnStartup": false
  },
  "profiles": [
    {
      "name": "series",
      "sourceFolders": "/mnt/nas/Media/Series/",
      "recursive": true,
      "replaceFile": true,
      "outputFormat": "mkv",
      "cacheFolder": "cache",
      "maxWidth": 1280,
      "maxHeight": 720,
      "downscaleToMax": true,
      "renameFiles": true,
      "removeHDR": true,
      "nvencPreset": "p4",
      "cqValue": 23,
      "log": false,
      "priority": 10,
      "minSizeReduction": 2
    },
    {
      "name": "movies",
      "sourceFolders": "/mnt/nas/Media/Movies/",
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

In this setup, `series` files are processed before `movies` (priority 10 > 5), and series are downscaled to 720p while movies keep 1080p.
