# Media Lens

Inspect and compare metadata for images, video, audio, and subtitle files directly in Obsidian.

## Features

- **Sidebar panel** with two drop zones — inspect a single file or compare two files side by side
- **Broad format support** — MP4, MOV, MKV, AVI, WebM, JPEG, PNG, GIF, WebP, TIFF, BMP, SVG, MP3, FLAC, WAV, AAC, OGG, SRT, VTT, ASS, and more
- **Multiple input methods** — drag-and-drop from vault or OS, or browse with native file picker
- **Engineering-focused metadata** — codec, codec profile, bitrate, bitrate mode, resolution, frame rate, sample rate, channel layout, HDR format, color space, and more
- **Media previews** — images render inline, videos and audio get playback controls, subtitles show a text preview
- **Synced A/B playback** — compare two video encodes with synchronized playback, unified scrub bar, and automatic drift correction
- **Frame-by-frame stepping** — step forward/back one frame at a time using the file's actual frame rate
- **Frame capture** — grab screenshots from video players (captures both A and B simultaneously in sync mode)
- **Comparison diff** — side-by-side metadata table with differences highlighted
- **Save as note** — persist inspections as markdown notes with embedded media, captured frames (labeled A/B), and metadata tables
- **Privacy first** — all processing is local via WASM, no data leaves your device

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
4. Load a second file of the same type into the compare zone
5. Click **Sync playback** to enable the unified transport — scrub, play/pause, and step frame-by-frame in lockstep
6. Pause and click the camera icon to capture frames from both players simultaneously
7. Click **Save as note** to create a markdown note with video embeds, captured frames, and metadata

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

---

Uses [mediainfo.js](https://github.com/buzz/mediainfo.js) for media file parsing.
