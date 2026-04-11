# Media Lens

Inspect and compare metadata for images, video, audio, and subtitle files directly in Obsidian.

> **Status:** Early development. Drop zone UI is functional. Metadata parsing and save-to-note coming soon.

## Planned Features

- **Sidebar panel** with two drop zones — inspect a single file or compare two files side by side
- **Broad format support** — JPEG, PNG, GIF, WebP, TIFF, BMP, SVG, MP4, MOV, MKV, AVI, WebM, MP3, FLAC, WAV, AAC, OGG, SRT, VTT, ASS, and more
- **Multiple input methods** — drag-and-drop from vault or OS, or browse with native file picker
- **Engineering-focused** — codec, bitrate, resolution, sample rate, file size, duration
- **Save to note** — persist inspections as markdown notes with embedded media and metadata tables
- **Comparison diff** — differences between two files highlighted in a side-by-side table
- **Privacy first** — all processing is local, no data leaves your device

## What Works Today

- Sidebar panel with film strip icon in the right sidebar
- Two drop zones (primary + compare) with drag-and-drop and native file picker
- Compare zone locked to same media category as primary file
- File type validation with supported format filtering
- Plugin settings for save directory paths

## Installation

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the latest release
2. Create a folder `your-vault/.obsidian/plugins/media-lens/`
3. Copy the downloaded files into that folder
4. Enable the plugin in **Settings → Community Plugins**

## Usage

1. Click the film strip icon in the left ribbon (or run the "Show panel" command)
2. Drag a media file into the **Primary File** drop zone, or click **Browse files**
3. Once a primary file is loaded, the compare zone activates for a second file of the same type

## Development

```bash
npm install
npm run dev        # watch mode
npm run build      # production build
npm run lint       # eslint
npm test           # vitest
npm run test:watch # vitest watch mode
```

## License

[0-BSD](LICENSE)
