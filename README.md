# Media Lens

Inspect and compare metadata for images, video, audio, and subtitle files directly in Obsidian. Powered by [mediainfo.js](https://github.com/buzz/mediainfo.js) (WebAssembly port of MediaInfoLib).

## Features

- **Sidebar panel** with two drop zones — inspect a single file or compare two files side by side
- **Broad format support** — JPEG, PNG, GIF, WebP, TIFF, BMP, SVG, MP4, MOV, MKV, AVI, WebM, MP3, FLAC, WAV, AAC, OGG, SRT, VTT, ASS, and more
- **Multiple input methods** — drag-and-drop from vault or OS, file picker, or load the active file
- **Engineering-focused** — codec, bitrate, resolution, sample rate, file size, duration
- **Save to note** — persist inspections as markdown notes with embedded media and metadata tables
- **Comparison diff** — differences between two files highlighted in a side-by-side table
- **Privacy first** — all processing is local, no data leaves your device

## Installation

### From Community Plugins (coming soon)

1. Open **Settings → Community Plugins → Browse**
2. Search for "Media Lens"
3. Click **Install**, then **Enable**

### Manual

1. Download `main.js`, `styles.css`, and `manifest.json` from the latest release
2. Create a folder `your-vault/.obsidian/plugins/media-lens/`
3. Copy the downloaded files into that folder
4. Enable the plugin in **Settings → Community Plugins**

## Usage

1. Click the camera icon in the left ribbon (or run the "Show Media Lens panel" command)
2. Drag a media file into the **Primary File** drop zone
3. Optionally drag a second file into the **Compare File** drop zone to see differences
4. Click any value to copy it to your clipboard

## Development

```bash
npm install
npm run dev    # watch mode
npm run build  # production build
npm run lint   # eslint
```

## License

[0-BSD](LICENSE)
