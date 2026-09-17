# Metadata Viewer

A **100% offline, privacy-first** universal file & media metadata analyzer that runs entirely in your browser.
No uploads, no tracking, no server processing — your files never leave your computer.

Drop any file (or click to browse) and instantly inspect its embedded metadata: EXIF, GPS, XMP, IPTC, ICC, ID3, MP4/MOV, MKV/WebM, FLAC, WAV, Ogg, AVI, RAR, 7-Zip, ZIP, PDF, Office documents (DOCX/PPTX/XLSX/ODF), EPUB, ISO images, fonts, executables, and more.

## Features

- **Universal format support** — images, video, audio, documents, archives, fonts, executables, text and more.
- **Rich preview** — renders images, video, audio, PDF, fonts, cover-art thumbnails, and text files in-browser.
- **Structured metadata** — focused cards: Camera & Settings, Date & Time, GPS (with live Google Maps link), Audio, Video, Documents, Archives, Files/Text, and more.
- **Live search & filter** — search the "All Metadata" panel and filter across categories in real time.
- **Hashes** — MD5, SHA-1 and SHA-256 computed locally via the Web Crypto API.
- **Export / Copy** — export the entire metadata report as JSON or copy any field to the clipboard.
- **Remove metadata** — scrub EXIF/XMP/IPTC from images and download the cleaned file locally.
- **Download original** — download the unmodified file at any time.
- **Responsive design** — works on desktop and mobile.

## Supported formats

### Images
JPEG, PNG, GIF, WebP, BMP, TIFF, HEIC/HEIF, ICO, SVG (metadata).

### Video & audio
MP4/MOV, MKV/WebM, AVI, MP3 (ID3v1/v2 + MPEG frame), FLAC, WAV/RIFF, OGG (Vorbis/Opus/Speex/Theora), M4A/AAC.

### Documents
PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, ODT/ODS/ODP, RTF, EPUB, TXT, CSV, Markdown, JSON, XML, source code (CSS/JS/HTML/TS).

### Archives
ZIP (incl. JAR/EPUB/DOCX/XLSX), RAR, 7-Zip, GZIP, TAR, ISO9660, CPIO, RPM, CramFS, Zstd, Bzip2, XZ, LZ4.

### Fonts & executables
OpenType / TrueType / WOFF / WOFF2 fonts, PE (EXE/DLL), ELF, WebAssembly, NE (Win 16-bit), LX (OS/2), CHM.

## Run locally

The app is a single static folder. You only need a browser — and optionally a tiny static server
(some browsers disable `file://` XHR/fetch). The only external dependency is the ExifReader CDN script,
used solely for image EXIF parsing.

```bash
cd path/to/Metadata-Viewer
# any static server works; examples:
npm i -g serve && serve .
# or:
python -m http.server 8000
```

Then open `http://localhost:8000` (or just open `index.html` directly in most browsers).

## Project layout

```
Metadata-Viewer/
  index.html    — shell: upload area, preview panel, metadata cards, quick actions
  styles.css    — responsive design tokens, card/animations, mobile layout
  script.js     — zero-dependency parser engine + UI wiring (runs in-browser)
```

## How it works

`script.js` reads files with the File API and parses their bytes with the native DataView and
TextDecoder APIs — no external parsing libraries and no file upload. Format detection is done by
magic-byte sniffing so mislabeled files are still identified correctly.

## Privacy

Everything is processed **locally in-memory**. Files are revoked with `URL.revokeObjectURL` after
previewing, and no data is sent over the network except the optional ExifReader CDN script.
