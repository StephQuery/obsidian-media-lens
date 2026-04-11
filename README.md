# Media Lens

Inspect and compare metadata for images, video, audio, and subtitle files directly in Obsidian.

> **Status:** Active development. Metadata inspection, comparison, and save-to-note are functional.

## Features

- **Sidebar panel** with two drop zones — inspect a single file or compare two files side by side
- **Broad format support** — MP4, MOV, MKV, AVI, WebM, JPEG, PNG, GIF, WebP, TIFF, BMP, SVG, MP3, FLAC, WAV, AAC, OGG, SRT, VTT, ASS, and more
- **Multiple input methods** — drag-and-drop from vault or OS, or browse with native file picker
- **Engineering-focused** — codec, codec profile, bitrate, bitrate mode, resolution, frame rate, sample rate, channel layout, HDR format, color space, and more
- **Comparison diff** — drop two files of the same type to see a side-by-side table with differences highlighted
- **Privacy first** — all processing is local via WASM, no data leaves your device

## What Works Today

- Sidebar panel with film strip icon in the right sidebar
- Two drop zones (primary + compare) with drag-and-drop and native file picker
- Compare zone locked to same media category as primary file
- **Metadata parsing** via mediainfo.js — drop a file and see collapsible sections with full track details (General, Video, Audio, Text, Image)
- **Media previews** — images render inline, videos and audio get playback controls, subtitles show a text preview
- **Comparison view** — drop a second file to see three-column side-by-side metadata with differences highlighted
- **Save to note** — persist single or comparison inspections as markdown notes with embedded media and metadata tables
- Plugin settings for save directory paths

## Planned

- Additional settings (date format, expanded sections, file size units)

## Installation

### Manual

1. Download `main.js`, `styles.css`, `manifest.json`, and `MediaInfoModule.wasm` from the latest release
2. Create a folder `your-vault/.obsidian/plugins/media-lens/`
3. Copy the downloaded files into that folder
4. Enable the plugin in **Settings → Community Plugins**

## Usage

1. Click the film strip icon in the left ribbon (or run the "Show panel" command)
2. Drag a media file into the **Primary File** drop zone, or click **Browse files**
3. Metadata appears in collapsible sections below (General, Video, Audio, etc.)
4. Once a primary file is loaded, the compare zone activates — drop a second file of the same type to see a side-by-side diff
5. Click **Save to note** to persist the inspection as a markdown note with embedded media and metadata table

## Development

```bash
npm install
npm run dev        # watch mode
npm run build      # production build
npm run lint       # eslint
npm test           # vitest (46 tests)
npm run test:watch # vitest watch mode
```

## License

[0-BSD](LICENSE)

---

Uses [mediainfo.js](https://github.com/buzz/mediainfo.js) for media file parsing.
