# Metadata Viewer

> Inspect the hidden details inside your files without uploading them anywhere.

Metadata Viewer is a privacy-first, browser-based analyzer for images, media, documents, archives, fonts, executables, and text. Drop in a file, preview it, explore structured metadata, search the report, and export what you need.

Everything runs locally in your browser.

![Privacy](https://img.shields.io/badge/privacy-100%25%20local-10b981?style=flat-square)
![Runtime](https://img.shields.io/badge/runtime-browser%20only-2563eb?style=flat-square)
![License](https://img.shields.io/badge/license-MIT-f59e0b?style=flat-square)

---

## 🤔 Why Metadata Viewer?

Metadata can reveal camera settings, timestamps, locations, authors, software, document history, and more. Metadata Viewer gives you a quick way to inspect that information before sharing a file, without sending the file to a third-party service.

- **Private by default**: files are read and analyzed in your browser.
- **Broad format coverage**: one workflow for media, documents, archives, and technical files.
- **Useful output**: structured categories, previews, hashes, search, copy, and JSON export.
- **No build pipeline required**: the app is a small static web project.

👉 [Live Preview](https://akash098p.github.io/Metadata-Viewer/)

---

## 🛠️ What you can do

| Workflow | Included |
| --- | --- |
| Inspect | EXIF, GPS, XMP, IPTC, ICC, ID3, container, document, archive, font, and executable metadata |
| Preview | Images, video, audio, PDFs, fonts, cover art, and text files in the browser |
| Find | Search and filter the complete metadata report in real time |
| Verify | Calculate MD5, SHA-1, and SHA-256 hashes locally |
| Export | Download the full report as JSON or copy individual values |
| Clean | Remove supported EXIF/XMP/IPTC metadata from images and download a cleaned copy |
| Compare | Keep the original file available for download while inspecting its metadata |
| Adapt | Use the responsive interface on desktop or mobile, with light and dark themes |

---

## 📦 Supported formats

### 🖼️ Images

JPEG, PNG, GIF, WebP, BMP, TIFF, HEIC/HEIF, ICO, and SVG metadata.

### 🎬 Video and audio

MP4/MOV, MKV/WebM, AVI, MP3 with ID3v1/v2 and MPEG frame data, FLAC, WAV/RIFF, OGG with Vorbis/Opus/Speex/Theora, and M4A/AAC.

### 📄 Documents and text

PDF, DOC/DOCX, XLS/XLSX, PPT/PPTX, ODT/ODS/ODP, RTF, EPUB, TXT, CSV, Markdown, JSON, XML, CSS, JavaScript, HTML, and TypeScript.

### 🗄️ Archives and containers

ZIP, JAR, EPUB, DOCX, XLSX, RAR, 7-Zip, GZIP, TAR, ISO9660, CPIO, RPM, CramFS, Zstd, Bzip2, XZ, and LZ4.

### 🔤 Fonts and executables

OpenType, TrueType, WOFF, WOFF2, PE files such as EXE/DLL, ELF, WebAssembly, NE, LX, and CHM.

---

## 🚀 Quick start

### 📋 Requirements

- A modern browser with File API, Web Crypto, DataView, and TextDecoder support.
- Node.js and npm only if you want to use the included convenience command.

### 🖥️ Run with a local server

```bash
git clone https://github.com/akash098p/Metadata-Viewer.git
cd Metadata-Viewer
npm start
```

Then open [http://localhost:8000](http://localhost:8000).

If your local `serve` version does not accept the package script's port flag, use the compatible command directly:

```bash
npx serve . -l 8000
```

You can also use any static server, for example:

```bash
python -m http.server 8000
```

For simple use, opening `index.html` directly may work in your browser, although a local server is more reliable for browser resource loading.

---

## ⚙️ How it works

1. The browser receives a `File` object from drag-and-drop or the file picker.
2. `script.js` reads bounded portions or the full file in memory as needed.
3. Format detection uses file signatures and metadata structures rather than trusting only the filename.
4. Parsers decode fields into grouped categories for the interface.
5. Previews and derived values such as hashes are generated locally.

The core parser engine uses browser APIs including `File`, `DataView`, `TextDecoder`, Web Crypto, and object URLs. The project is intentionally dependency-light and does not require a backend.

---

## 🔒 Privacy model

Your files are processed in memory in the current browser session. Metadata Viewer does not upload files, create an account, or use tracking analytics. Preview object URLs are revoked when they are no longer needed.

The page may load the ExifReader script from its configured CDN source for image EXIF parsing. If you need a fully disconnected environment, vendor that dependency locally before using the app offline.

As with any browser tool, avoid opening sensitive files in a browser profile or environment you do not control.

---

## 🗂️ Project structure

```text
Metadata-Viewer/
├── index.html    # Application shell and accessible upload workflow
├── styles.css    # Theme tokens, responsive layout, states, and animations
├── script.js     # File detection, parsers, previews, and UI behavior
├── package.json  # Local development commands and project metadata
└── README.md     # Documentation
```

---

## 👨‍💻 Development

This project uses vanilla HTML, CSS, and JavaScript. No bundler or framework is required.

Check JavaScript syntax with:

```bash
npm run lint
```

When adding a parser or metadata field:

1. Keep parsing local and bounded where possible.
2. Preserve the existing output shape used by the metadata cards and JSON export.
3. Add a representative fixture or manual test case for the format.
4. Verify both desktop and mobile layouts.
5. Run `npm run lint` before opening a pull request.

---

## 👤 Developer

**Akash Pramanik**

<p>
  <strong>For questions or support: </strong>
<a href="https://instagram.com/akash.098p" target="_blank">
  <img src="https://img.shields.io/badge/akash.098p-E4405F?style=flat&logo=instagram&logoColor=white"/>
</a>

<a href="mailto:akashpramanik098@gmail.com">
  <img src="https://img.shields.io/badge/akashpramanik422%40gmail.com-D14836?style=flat&logo=gmail&logoColor=white"/>
</a>
</p>

---

## 🤝 Contributing

Issues and pull requests are welcome. Please include:

- The file type and sample metadata structure involved.
- Reproduction steps and browser details.
- A small fixture when it can be shared safely.
- Screenshots for visible UI changes.

Do not commit private files or samples containing personal metadata.

---

## 📜 License

MIT. See the repository metadata for details.

---
