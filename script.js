"use strict";
/* Metadata Viewer — Universal File & Media Metadata Analyzer (vanilla JS, 100% browser).
   Externals (CDN): ExifReader 4.14.0, jsmediatags 3.9.7, UTIF 3.1.0 + pako. */
const MAX_PARSE_BYTES = 512 * 1024 * 1024;
const EOCD_SCAN = 65557;
const UTF8 = new TextDecoder("utf-8");
const UTF8FATAL = new TextDecoder("utf-8", { fatal: true });
const LATIN1 = new TextDecoder("latin1");
const WIN1252 = new TextDecoder("windows-1252");

const state = {
  file: null,
  buffer: null,
  head: null,
  tail: null,
  format: null,
  categories: [],
  items: [],
  rawItems: [],
  gps: null,
  exportData: null,
  mediaDuration: null,
  mediaWidth: null,
  mediaHeight: null,
  mediaDate: null,
  objectUrls: [],
};
let startTime = 0;

const $ = (i) => document.getElementById(i);
const uploadArea = $("uploadArea"),
  fileInput = $("fileInput"),
  uploadSection = $("uploadSection"),
  contentArea = $("contentArea"),
  loadingOverlay = $("loadingOverlay"),
  loadingText = $("loadingText"),
  previewBox = $("previewContainer"),
  processingTime = $("processingTime"),
  gpsCard = $("gpsCard"),
  gpsContent = $("gpsContent"),
  gpsCopy = $("gpsCopy"),
  categoryCardsEl = $("categoryCards"),
  allMetadataEl = $("allMetadata"),
  totalCountEl = $("totalCount"),
  searchInput = $("metadataSearch"),
  newFileBtn = $("newFileBtn"),
  downloadOriginalBtn = $("downloadOriginalBtn"),
  removeMetadataBtn = $("removeMetadataBtn"),
  exportJsonBtn = $("exportJsonBtn"),
  copyJsonBtn = $("copyJsonBtn"),
  themeToggle = $("themeToggle"),
  toastContainer = document.createElement("div");
toastContainer.className = "toast-container";
document.body.appendChild(toastContainer);
const savedTheme = localStorage.getItem("metadata-viewer-theme");
const applyTheme = (theme) => {
  const isDark = theme === "dark";
  document.documentElement.dataset.theme = isDark ? "dark" : "light";
  themeToggle.setAttribute("aria-pressed", String(isDark));
  themeToggle.setAttribute(
    "aria-label",
    isDark ? "Switch to light mode" : "Switch to dark mode",
  );
  themeToggle.querySelector(".theme-toggle-label").textContent = isDark
    ? "Dark"
    : "Light";
};
applyTheme(savedTheme === "dark" ? "dark" : "light");
const det = {
  fileName: $("fileName"),
  fileFormat: $("fileFormat"),
  fileType: $("fileType"),
  fileSize: $("fileSize"),
  fileModified: $("fileModified"),
  dimensions: $("dimensions"),
  duration: $("durationVal"),
  sha256: $("sha256"),
  sha1: $("sha1"),
  entropy: $("entropy"),
  rowDimensions: $("rowDimensions"),
  rowDuration: $("rowDuration"),
};
const toast = (message, type = "info", dur = 3200) => {
  const t = document.createElement("div");
  t.className = "toast " + (type || "info");
  const icons = { success: "✓", error: "✕", info: "ⓘ" };
  t.innerHTML =
    '<span class="toast-icon">' +
    (icons[type] || "ⓘ") +
    "</span><span>" +
    escapeHtml(message) +
    "</span>";
  const c = document.createElement("span");
  c.className = "toast-close";
  c.textContent = "×";
  c.onmousedown = (e) => {
    e.preventDefault();
  };
  c.onclick = () => {
    clearTimeout(tm);
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  };
  t.appendChild(c);
  toastContainer.appendChild(t);
  requestAnimationFrame(() => t.classList.add("show"));
  const tm = setTimeout(() => {
    t.classList.remove("show");
    setTimeout(() => t.remove(), 300);
  }, dur);
};

const formatBytes = (b) => {
  if (!b) return "0 Bytes";
  const k = 1024,
    s = ["Bytes", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return parseFloat((b / Math.pow(k, i)).toFixed(i < 2 ? 0 : 2)) + " " + s[i];
};
const escapeHtml = (t) => {
  if (t === undefined || t === null) return "";
  const d = document.createElement("div");
  d.textContent = String(t);
  return d.innerHTML;
};
const formatDuration = (s) => {
  const x = parseFloat(s);
  if (!isFinite(x) || x < 0) return "-";
  if (x >= 86400)
    return `${Math.floor(x / 86400)}d ${Math.floor((x % 86400) / 3600)}h ${Math.floor((x % 3600) / 60)}m`;
  const h = Math.floor(x / 3600);
  const m = Math.floor((x % 3600) / 60);
  const r = x % 60;
  if (h > 0) return h + "h " + m + "m " + r.toFixed(0) + "s";
  if (m > 0) return m + "m " + r.toFixed(1) + "s";
  return r.toFixed(2) + "s";
};
const formatDate = (ms) => {
  if (!ms || !isFinite(ms)) return "-";
  return new Date(ms).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
};
const formatDateExif = (str) => {
  if (!str) return "-";
  let s = String(str);
  if (s.startsWith("D:")) s = s.slice(2);
  const m = s.match(
    /^(\d{4}):?(\d{2}):?(\d{2})[ T](\d{2}):(\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:?\d{2})?$/,
  );
  if (m) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00${m[7] || "Z"}`;
    const d = new Date(iso);
    return isNaN(d)
      ? str
      : d.toLocaleString(undefined, {
          dateStyle: "medium",
          timeStyle: "short",
        });
  }
  const d2 = new Date(str);
  return isNaN(d2)
    ? str
    : d2.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
};
const byteAt = (b, i) => (i < b.length ? b[i] : 0);
const u32be = (b, i) =>
  (byteAt(b, i) << 24) |
  (byteAt(b, i + 1) << 16) |
  (byteAt(b, i + 2) << 8) |
  byteAt(b, i + 3);
const u16be = (b, i) => (byteAt(b, i) << 8) | byteAt(b, i + 1);
const sCopy = (b, o, l) =>
  o < b.length ? b.subarray(o, o + l) : new Uint8Array(0);
const decodeUtf8 = (dv, o, l) =>
  UTF8.decode(
    dv instanceof DataView
      ? dv.buffer.slice(dv.byteOffset + o, dv.byteOffset + o + l)
      : dv.subarray(o, o + l),
  );
const decodeLatin1 = (b, o, l) => LATIN1.decode(sCopy(b, o, l));
const arrayBufferToBase64 = (buf) => {
  let s = "";
  const c = new Uint8Array(buf);
  for (let i = 0; i < c.length; i += 1 << 20)
    s += String.fromCharCode.apply(null, c.subarray(i, i + (1 << 20)));
  return btoa(s);
};
const entropyBits = (buf) => {
  const b = new Uint8Array(buf);
  const n = Math.min(b.length, 131072);
  const f = new Uint32Array(256);
  for (let i = 0; i < n; i++) f[b[i]]++;
  let e = 0;
  for (let k = 0; k < 256; k++) {
    const p = f[k] / n;
    if (p > 0) e -= p * Math.log2(p);
  }
  return e.toFixed(2) + " / 8";
};
const copyText = (txt) =>
  navigator.clipboard.writeText(txt).catch(() => {
    const ta = document.createElement("textarea");
    ta.value = txt;
    document.body.append(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  });
const trackUrl = (u) => {
  state.objectUrls.push(u);
  return u;
};
const revokeAllUrls = () => {
  for (const u of state.objectUrls)
    try {
      URL.revokeObjectURL(u);
    } catch (e) {}
  state.objectUrls = [];
};
const downloadFromUrl = (url, name) => {
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.rel = "noopener noreferrer";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
};
const downloadBlob = (blob, name) =>
  downloadFromUrl(trackUrl(URL.createObjectURL(blob)), name);
const showPlaceholder = (icon, title, sub) => {
  previewBox.innerHTML = "";
  const w = document.createElement("div");
  w.className = "file-placeholder";
  w.innerHTML =
    '<div class="placeholder-icon">' +
    icon +
    '</div><div style="font-size:18px;font-weight:600;color:var(--gray-700);margin-bottom:6px">' +
    escapeHtml(title) +
    '</div><div class="placeholder-sub">' +
    escapeHtml(sub || "") +
    "</div>";
  previewBox.appendChild(w);
};
const showMediaPreview = (src, type) => {
  previewBox.innerHTML = "";
  if (type === "image") {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "preview";
    img.onload = () => (state.mediaWidth = img.naturalWidth);
    previewBox.appendChild(img);
    trackUrl(src);
  } else if (type === "video") {
    const v = document.createElement("video");
    v.controls = true;
    v.playsInline = true;
    v.src = src;
    trackUrl(src);
    v.onloadedmetadata = () => {
      state.mediaWidth = v.videoWidth;
      state.mediaHeight = v.videoHeight;
      state.mediaDuration = v.duration;
      if (v.videoWidth) {
        setDetail("dimensions", v.videoWidth + " × " + v.videoHeight + " px");
        showDetailRow("rowDimensions");
      }
      if (isFinite(v.duration) && v.duration > 0) {
        setDetail("duration", formatDuration(v.duration));
        showDetailRow("rowDuration");
      }
    };
    v.onerror = () =>
      showPlaceholder(
        "🎬",
        "Video preview unavailable",
        "This video uses a codec unsupported by your browser.",
      );
    previewBox.appendChild(v);
  } else if (type === "audio") {
    const a = document.createElement("audio");
    a.controls = true;
    a.src = src;
    trackUrl(src);
    a.onloadedmetadata = () => {
      state.mediaDuration = a.duration;
      if (isFinite(a.duration) && a.duration > 0) {
        setDetail("duration", formatDuration(a.duration));
        showDetailRow("rowDuration");
      }
    };
    a.onerror = () =>
      showPlaceholder(
        "🔊",
        "Audio preview unavailable",
        "Your browser cannot play this audio.",
      );
    previewBox.appendChild(a);
  } else if (type === "pdf") {
    const fr = document.createElement("iframe");
    fr.src = src;
    fr.title = "PDF preview";
    trackUrl(src);
    previewBox.appendChild(fr);
  } else if (type === "cover") {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "cover";
    img.className = "cover-art";
    previewBox.appendChild(img);
    trackUrl(src);
  } else if (type === "text") {
    const pre = document.createElement("pre");
    pre.className = "text-preview";
    pre.textContent = String(src).slice(0, 20000);
    previewBox.appendChild(pre);
  }
};

/* ----------------------------- Event wiring ------------------------------ */
themeToggle.addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  applyTheme(nextTheme);
  localStorage.setItem("metadata-viewer-theme", nextTheme);
});
uploadArea.addEventListener("click", () => fileInput.click());
uploadArea.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    fileInput.click();
  }
});
["dragover", "dragenter"].forEach((ev) => {
  uploadArea.addEventListener(ev, (e) => {
    e.preventDefault();
    uploadArea.classList.add("dragover");
  });
});
["dragleave", "drop"].forEach((ev) => {
  uploadArea.addEventListener(ev, (e) => {
    if (e.target === uploadArea || e.type === "drop") {
      e.preventDefault();
      uploadArea.classList.remove("dragover");
    }
  });
});
uploadArea.addEventListener("drop", (e) => {
  if (e.dataTransfer.files.length) processFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener("change", (e) => {
  if (e.target.files.length) processFile(e.target.files[0]);
});
newFileBtn.addEventListener("click", resetApp);
downloadOriginalBtn.addEventListener("click", downloadOriginal);
removeMetadataBtn.addEventListener("click", removeAndDownload);
exportJsonBtn.addEventListener("click", exportJson);
copyJsonBtn.addEventListener("click", copyJson);
gpsCopy.addEventListener("click", () => {
  if (state.gps) copyText(formatGpsLine(state.gps));
  toast("Coordinates copied", "success", 1200);
});
searchInput.addEventListener("input", filterMetadata);

const IMG_EXT = [
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "tiff",
  "tif",
  "heic",
  "heif",
  "avif",
  "jxl",
  "svg",
  "ico",
  "psd",
];
const VID_EXT = [
  "mp4",
  "mov",
  "m4v",
  "mkv",
  "webm",
  "avi",
  "wmv",
  "flv",
  "mpg",
  "mpeg",
  "ts",
  "3gp",
  "mts",
  "m2ts",
];
const AUD_EXT = [
  "mp3",
  "flac",
  "wav",
  "ogg",
  "oga",
  "m4a",
  "wma",
  "aac",
  "opus",
  "aiff",
  "aif",
];
const ARC_EXT = [
  "zip",
  "7z",
  "rar",
  "tar",
  "gz",
  "tgz",
  "bz2",
  "xz",
  "iso",
  "zst",
  "lz",
  "lzma",
];
const DOC_EXT = [
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "odt",
  "ods",
  "odp",
  "epub",
  "rtf",
];
const TXT_EXT = [
  "txt",
  "json",
  "csv",
  "md",
  "log",
  "ts",
  "tsx",
  "js",
  "jsx",
  "css",
  "html",
  "htm",
  "xml",
  "py",
  "cpp",
  "c",
  "h",
  "hpp",
  "java",
  "sql",
  "ini",
  "cfg",
  "yaml",
  "yml",
  "toml",
  "sh",
  "bat",
  "ps1",
];
const EXT_MAP = {
  jpg: "image",
  jpeg: "image",
  png: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  tiff: "image",
  tif: "image",
  heic: "image",
  heif: "image",
  avif: "image",
  jxl: "image",
  svg: "image",
  ico: "image",
  psd: "image",
  mp4: "video",
  mov: "video",
  m4v: "video",
  mkv: "video",
  webm: "video",
  avi: "video",
  wmv: "video",
  flv: "video",
  mpg: "video",
  mpeg: "video",
  ts: "video",
  "3gp": "video",
  mts: "video",
  m2ts: "video",
  mp3: "audio",
  flac: "audio",
  wav: "audio",
  ogg: "audio",
  oga: "audio",
  m4a: "audio",
  m4b: "audio",
  m4r: "audio",
  m4p: "audio",
  wma: "audio",
  aac: "audio",
  opus: "audio",
  aiff: "audio",
  aif: "audio",
};
function extOverride(ext) {
  if (!ext) return null;
  const cat = EXT_MAP[ext];
  if (cat === "image") {
    const mime =
      {
        svg: "image/svg+xml",
        heic: "image/heic",
        avif: "image/avif",
        ico: "image/x-icon",
      }[ext] || "image/" + ext.replace("jpg", "jpeg");
    return [
      "image",
      ext.toUpperCase().replace("JPG", "JPEG") + " image",
      mime,
      ext,
    ];
  }
  if (cat === "video") {
    const mt =
      {
        mkv: "x-matroska",
        webm: "webm",
        avi: "x-msvideo",
        wmv: "x-ms-wmv",
        flv: "x-flv",
        mpg: "mpeg",
        m4v: "mp4",
        ts: "mp2t",
      }[ext] || ext;
    return ["video", ext.toUpperCase() + " video", "video/" + mt, ext];
  }
  if (cat === "audio") {
    const mt =
      {
        mp3: "mpeg",
        oga: "ogg",
        m4a: "mp4",
        wav: "wav",
        aac: "aac",
        opus: "opus",
        webm: "webm",
        flac: "flac",
      }[ext] || ext;
    return ["audio", ext.toUpperCase() + " audio", "audio/" + mt, ext];
  }
  if (ARC_EXT.includes(ext))
    return [
      "archive",
      ext.toUpperCase() + " archive",
      "application/x-" + ext,
      ext,
    ];
  if (DOC_EXT.includes(ext)) {
    const sub = {
      pdf: "pdf",
      docx: "docx",
      xlsx: "xlsx",
      pptx: "pptx",
      odt: "odt",
      ods: "ods",
      odp: "odp",
      epub: "epub",
      rtf: "rtf",
      doc: "ole",
      xls: "ole",
      ppt: "ole",
    }[ext];
    return [
      "document",
      ext.toUpperCase() + " document",
      "application/" + ext,
      sub,
    ];
  }
  if (TXT_EXT.includes(ext))
    return ["text", ext.toUpperCase() + " text/source", "text/plain", ext];
  if (["ttf", "otf", "woff", "woff2"].includes(ext))
    return ["font", ext.toUpperCase() + " font", "font/" + ext, ext];
  if (ext === "wasm")
    return ["application", "WebAssembly", "application/wasm", "wasm"];
  if (ext === "class")
    return ["application", "Java class", "application/java", "class"];
  return null;
}

function sig(h, a, o = 0) {
  for (let i = 0; i < a.length; i++) {
    if (o + i >= h.length || h[o + i] !== a[i]) return false;
  }
  return true;
}
function sigStr(h, o, l) {
  return ascii(h, o, l).replace(/\0/g, "");
}
function ascii(h, o, l) {
  let s = "";
  for (let i = 0; i < l; i++) {
    const c = o + i < h.length ? h[o + i] : 0;
    if (!c) break;
    s += String.fromCharCode(c);
  }
  return s;
}
function readMp4Brands(h, start = 12) {
  const out = [];
  const n = Math.min(h.length, 262144);
  for (let o = start || 12; o + 4 <= n; o += 4) {
    const b = sigStr(h, o, 4);
    if (/^[a-z0-9 ]{4}$/i.test(b)) out.push(b);
    else break;
  }
  return out;
}

function checkIsobmff(h, ext) {
  if (!(h[0] === 0 && h[1] === 0 && h[2] === 0 && h[4] === 0x66)) return null;
  const br = sigStr(h, 4, 4);
  const minor = u32be(h, 8);
  const brands = readMp4Brands(h);
  let cat, label;
  if (br === "qt  ") {
    cat = "video";
    label = "QuickTime MOV";
  } else if (br === "avif" || br === "avis") {
    cat = "image";
    label = "AVIF";
  } else if (
    ["heic", "heix", "hevc", "hevx", "mif1", "msf1", "heim", "heis"].includes(
      br,
    )
  ) {
    cat = "image";
    label = "HEIC/HEIF";
  } else if (
    ["M4A ", "M4B ", "M4P ", "m4a ", "m4b ", "m4p "].includes(br) ||
    ["m4a", "m4r", "m4b", "m4p"].includes(ext)
  ) {
    cat = "audio";
    label = "MP4 Audio (M4A)";
  } else {
    cat = "video";
    label = "MP4/MOV";
  }
  const mime =
    cat === "image"
      ? label.includes("AVIF")
        ? "image/avif"
        : "image/heic"
      : cat === "audio"
        ? "audio/mp4"
        : "video/mp4";
  const sub =
    cat === "audio"
      ? "m4a"
      : cat === "image"
        ? br === "avif" || br === "avis"
          ? "avif"
          : "heic"
        : "mp4";
  return [cat, label, mime, sub, { brands, brand: br, minor }];
}
function checkRiff(h) {
  if (!sig(h, [0x52, 0x49, 0x46, 0x46])) return null;
  const w = sigStr(h, 8, 4);
  if (w === "WEBP") return ["image", "WebP", "image/webp", ""];
  if (w === "WAVE") return ["audio", "WAV", "audio/wav", "wav"];
  if (w === "AVI ") return ["video", "AVI", "video/x-msvideo", ""];
  return ["other", "RIFF (" + w + ")", "", ""];
}
function checkText(h) {
  if (h[0] !== 0x3c) return null;
  const s = ascii(h, 0, Math.min(h.length, 2048)).toLowerCase();
  const t = s.trim();
  if (t.startsWith("<svg")) return ["image", "SVG", "image/svg+xml", "svg"];
  if (t.startsWith("<!doctype html") || t.startsWith("<html"))
    return ["text", "HTML document", "text/html", "html"];
  if (t.startsWith("<?xml")) return ["text", "XML", "application/xml", "xml"];
  if (t.startsWith("%pdf"))
    return ["document", "PDF", "application/pdf", "pdf"];
  if (
    /^[\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]*$/.test(t.slice(0, 300)) &&
    t.length >= 3
  )
    return ["text", "Text file", "text/plain", "txt"];
  return null;
}
function detectFormat(head, size, type, name) {
  const ext = name ? name.split(".").pop().toLowerCase() : "";
  let r = null;
  const tests = [
    () =>
      sig(head, [0xff, 0xd8, 0xff])
        ? ["image", "JPEG", "image/jpeg", ""]
        : null,
    () =>
      sig(head, [0x89, 0x50, 0x4e, 0x47])
        ? ["image", "PNG", "image/png", ""]
        : null,
    () =>
      sig(head, [0x47, 0x49, 0x46, 0x37, 0x61])
        ? ["image", "GIF87a", "image/gif", ""]
        : null,
    () =>
      sig(head, [0x47, 0x49, 0x46, 0x38, 0x61])
        ? ["image", "GIF89a", "image/gif", ""]
        : null,
    () => (sig(head, [0x42, 0x4d]) ? ["image", "BMP", "image/bmp", ""] : null),
    () =>
      sig(head, [0x00, 0x00, 0x01, 0x00])
        ? ["image", "Windows Icon", "image/x-icon", ""]
        : null,
    () =>
      sig(head, [0x49, 0x44, 0x33]) ||
      (head[0] === 0xff && [0xfb, 0xf3, 0xf9, 0xfa, 0xf2].includes(head[1]))
        ? ["audio", "MP3", "audio/mpeg", "mp3"]
        : null,
    () => (sig(head, [0x52, 0x49, 0x46, 0x46]) ? checkRiff(head) : null),
    () =>
      sig(head, [0x1a, 0x45, 0xdf, 0xa3])
        ? ["video", "Matroska/WebM", "video/webm", "ebml"]
        : null,
    () => checkIsobmff(head, ext),
    () =>
      head[0] === 0xff && head[1] === 0xf1
        ? ["audio", "AAC (ADTS)", "audio/aac", "aac"]
        : null,
    () =>
      sig(head, [0x4f, 0x67, 0x67, 0x53])
        ? ["audio", "Ogg", "audio/ogg", "ogg"]
        : null,
    () =>
      sig(head, [0x66, 0x4c, 0x61, 0x43])
        ? ["audio", "FLAC", "audio/flac", "flac"]
        : null,
    () =>
      sig(head, [0x38, 0x42, 0x50, 0x53])
        ? ["image", "JPEG XL", "image/jxl", ""]
        : null,
    () =>
      sig(head, [0x25, 0x50, 0x44, 0x46])
        ? ["document", "PDF", "application/pdf", "pdf"]
        : null,
    () =>
      sig(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1])
        ? [
            "document",
            "OLE Compound Document",
            "application/octet-stream",
            "ole",
          ]
        : null,
    () =>
      sig(head, [0x50, 0x4b, 0x03, 0x04])
        ? ["archive", "ZIP Archive", "application/zip", "zip"]
        : null,
    () =>
      sig(head, [0x50, 0x4b, 0x05, 0x06])
        ? ["archive", "ZIP Archive (empty)", "application/zip", "zip"]
        : null,
    () =>
      sig(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])
        ? ["archive", "RAR", "application/x-rar-compressed", "rar"]
        : null,
    () =>
      sig(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])
        ? ["archive", "7-Zip", "application/x-7z-compressed", "7z"]
        : null,
    () =>
      sig(head, [0x42, 0x5a, 0x68])
        ? ["archive", "BZip2", "application/x-bzip2", "bzip2"]
        : null,
    () =>
      head[0] === 0xfd &&
      head[1] === 0x37 &&
      head[2] === 0x7a &&
      head[3] === 0x58 &&
      head[4] === 0x5a
        ? ["archive", "XZ", "", "xz"]
        : null,
    () =>
      size >= 262 && u32be(head, 257) === 0x756e6974
        ? ["archive", "TAR", "application/x-tar", "tar"]
        : null,
    () =>
      head[0] === 0x4d && head[1] === 0x5a
        ? ["application", "Windows EXE", "application/x-msdownload", "exe"]
        : null,
    () =>
      sig(head, [0x7f, 0x45, 0x4c, 0x46])
        ? ["application", "ELF Executable", "application/x-executable", "elf"]
        : null,
    () => (head[0] === 0x3c ? checkText(head) : null),
  ];
  for (const t of tests) {
    const v = t();
    if (v) {
      r = v;
      break;
    }
  }
  if (!r)
    r = extOverride(ext) || [
      "other",
      "Unknown",
      type || "application/octet-stream",
      "",
    ];
  return {
    category: r[0],
    label: r[1],
    mime: r[2] || type || "application/octet-stream",
    ext,
    subtype: r[3] || "",
    ...(r[4] || {}),
  };
}

/* ----------------------------- File flow --------------------------------- */
async function sliceToUint8(file, start, len) {
  const b = await file.slice(start, start + len).arrayBuffer();
  return new Uint8Array(b);
}

function showOverlay(text = "Analyzing…") {
  loadingText.textContent = text;
  loadingOverlay.classList.remove("hidden");
}
function hideOverlay() {
  loadingOverlay.classList.add("hidden");
}

function populateFileInfo(file, fmt) {
  det.fileName.textContent = file.name;
  let extra = "";
  if (fmt.brand) extra = " (" + fmt.brand + ")";
  else if (fmt.brands && fmt.brands.length)
    extra = " [" + fmt.brands.slice(0, 3).join(", ") + "]";
  det.fileFormat.textContent = fmt.label + extra;
  det.fileType.textContent = fmt.mime || file.type || "-";
  det.fileSize.textContent = formatBytes(file.size);
  det.fileModified.textContent = formatDate(file.lastModified);
  det.sha256.textContent = "calculating…";
  det.sha1.textContent = "calculating…";
  const sample = state.buffer || state.head;
  det.entropy.textContent = sample ? entropyBits(sample) : "-";
  det.rowDimensions.classList.add("hidden");
  det.rowDuration.classList.add("hidden");
  det.dimensions.textContent = "-";
  det.duration.textContent = "-";
}

function finishProcessing() {
  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  processingTime.textContent = "Analyzed in " + elapsed + "s";
  processingTime.classList.add("badge-time");
  uploadSection.style.display = "none";
  contentArea.classList.remove("hidden");
  renderCategories();
  renderAllMetadata();
  buildExportData();
  if (state.buffer && state.buffer.byteLength <= MAX_PARSE_BYTES)
    computeHashes(state.buffer);
}

function setDefaults() {
  det.fileName.textContent = "-";
  det.fileFormat.textContent = "-";
  det.fileType.textContent = "-";
  det.fileSize.textContent = "-";
  det.fileModified.textContent = "-";
  det.dimensions.textContent = "-";
  det.duration.textContent = "-";
  det.sha256.textContent = "—";
  det.sha1.textContent = "—";
  det.entropy.textContent = "-";
  det.rowDimensions.classList.add("hidden");
  det.rowDuration.classList.add("hidden");
  removeMetadataBtn.style.display = "none";
}

function resetView() {
  revokeAllUrls();
  state.categories = [];
  state.items = [];
  state.rawItems = [];
  state.gps = null;
  state.mediaDuration = null;
  state.mediaWidth = null;
  state.mediaHeight = null;
  state.mediaDate = null;
  state.exportData = null;
  uploadSection.style.display = "block";
  contentArea.classList.add("hidden");
  previewBox.innerHTML = "";
  gpsCard.classList.add("hidden");
  categoryCardsEl.innerHTML = "";
  allMetadataEl.innerHTML = "";
  totalCountEl.textContent = "0";
  searchInput.value = "";
}

function resetApp() {
  resetView();
  fileInput.value = "";
  state.file = null;
  state.buffer = null;
  state.format = null;
  setDefaults();
}

async function processFile(file) {
  if (!file) return;
  resetView();
  setDefaults();
  state.file = file;
  startTime = performance.now();
  loadingText.textContent = "Analyzing " + file.name;
  showOverlay();
  try {
    if (file.size > MAX_PARSE_BYTES) {
      state.head = await sliceToUint8(file, 0, 65536);
      state.tail = await sliceToUint8(
        file,
        Math.max(0, file.size - 65536),
        65536,
      );
    } else {
      state.buffer = await file.arrayBuffer();
      const len = state.buffer.byteLength;
      state.head = new Uint8Array(state.buffer, 0, Math.min(len, 65536));
      state.tail =
        len > 65536
          ? new Uint8Array(state.buffer, len - 65536, 65536)
          : state.head;
    }
    state.format = detectFormat(
      state.head,
      state.buffer ? state.buffer.byteLength : file.size,
      file.type,
      file.name,
    );
    populateFileInfo(file, state.format);
    removeMetadataBtn.style.display =
      state.format.category === "image" ? "inline-flex" : "none";
    const f = state.format;
    if (f.category === "image") await handleImage(file, state.buffer, f);
    else if (f.category === "video") await handleVideo(file, state.buffer, f);
    else if (f.category === "audio") await handleAudio(file, state.buffer, f);
    else if (f.category === "document")
      await handleDocument(file, state.buffer, f);
    else if (f.category === "archive")
      await handleArchive(file, state.buffer, f);
    else if (f.category === "text") await handleText(file, state.buffer, f);
    else await handleOther(file, state.buffer, f);
    finishProcessing();
  } catch (err) {
    console.error(err);
    toast("Failed to analyze this file: " + (err.message || err), "error");
    uploadSection.style.display = "block";
    contentArea.classList.add("hidden");
  } finally {
    hideOverlay();
  }
}

/* ----------------------------- Rendering --------------------------------- */
function countValid(c) {
  return c.items.filter(
    (i) => String(i.label) && String(i.value) && String(i.value) !== "-",
  ).length;
}
function makeCategory(title, icon) {
  const c = { title, icon, items: [], blocks: [], refs: {} };
  state.categories.push(c);
  return c;
}
function addItem(c, label, value) {
  c.items.push({
    label: label || "",
    value: value === undefined ? null : value,
  });
  return c;
}
function addBlock(c, block) {
  c.blocks.push(block);
  return c;
}
function updateItem(card, label, val) {
  const it = card.items.find((i) => i.label === label);
  if (!it) return;
  it.value = val;
  if (it.refs && it.refs.valueEl) it.refs.valueEl.textContent = val;
}
function updateCard(title, label, val) {
  const c = state.categories.find((c) => c.title === title);
  if (c) updateItem(c, label, val);
}
function setDetail(id, val) {
  if (det[id]) {
    det[id].textContent = val;
  }
}
function showDetailRow(rowId) {
  if (det[rowId]) det[rowId].classList.remove("hidden");
}

function makeItemEl(label, value, it) {
  const row = document.createElement("div");
  row.className = "metadata-item";
  row.dataset.search = (label + " " + value).toLowerCase();
  const lbl = document.createElement("div");
  lbl.className = "metadata-label";
  lbl.textContent = label;
  const valEl = document.createElement("div");
  valEl.className = "metadata-value";
  if (it) it.refs = { valueEl: valEl };
  const v =
    value === null || value === undefined || value === "" ? "-" : String(value);
  valEl.textContent =
    typeof v === "string" && v.length > 400 ? v.slice(0, 400) + "…" : v;
  row.appendChild(lbl);
  row.appendChild(valEl);
  return row;
}
function makeBlockEl(block) {
  if (block.type === "list") {
    const wrap = document.createElement("div");
    wrap.className = "entry-list";
    const ol = document.createElement("ol");
    for (const e of block.items) {
      const li = document.createElement("li");
      li.textContent = e;
      ol.appendChild(li);
    }
    wrap.appendChild(ol);
    return wrap;
  }
  if (block.type === "text") {
    const pre = document.createElement("pre");
    pre.className = "text-preview";
    pre.textContent = block.text;
    return pre;
  }
  if (block.type === "image") {
    const img = document.createElement("img");
    img.className = "cover-art";
    img.src = block.src;
    img.alt = block.alt || "";
    return img;
  }
  if (block.type === "html") {
    const d = document.createElement("div");
    d.innerHTML = block.html;
    return d;
  }
  return document.createElement("div");
}
function renderCategories() {
  categoryCardsEl.innerHTML = "";
  let any = false;
  for (const c of state.categories) {
    if (!c.items.length && !c.blocks.length) continue;
    any = true;
    const card = document.createElement("div");
    card.className = "category-card card";
    const hdr = document.createElement("div");
    hdr.className = "card-header";
    hdr.innerHTML =
      "<h3>" +
      (c.icon || "") +
      " " +
      escapeHtml(c.title) +
      "</h3>" +
      '<span class="badge badge-count">' +
      countValid(c) +
      "</span>";
    card.appendChild(hdr);
    const body = document.createElement("div");
    body.className = "metadata-grid";
    if (c.items.length) {
      for (const it of c.items)
        body.appendChild(makeItemEl(it.label, it.value, it));
    } else {
      body.innerHTML = '<div class="no-data">No data</div>';
    }
    for (const blk of c.blocks) body.appendChild(makeBlockEl(blk));
    card.appendChild(body);
    categoryCardsEl.appendChild(card);
  }
  if (!any)
    categoryCardsEl.innerHTML =
      '<p style="color:var(--gray-500)">No structured metadata available for this file.</p>';
}
function addRaw(group, label, value) {
  if (value === undefined || value === null || value === "") return;
  state.rawItems.push({
    group: group || "",
    label: label,
    value: String(value),
  });
}

function renderAllMetadata() {
  allMetadataEl.innerHTML = "";
  if (!state.rawItems.length) {
    allMetadataEl.innerHTML =
      '<div class="no-data">No metadata available</div>';
    totalCountEl.textContent = "0";
    return;
  }
  totalCountEl.textContent = state.rawItems.length;
  for (const it of state.rawItems) {
    const row = document.createElement("div");
    row.className = "metadata-item";
    row.dataset.search = (
      (it.group || "") +
      " " +
      it.label +
      " " +
      it.value
    ).toLowerCase();
    const lbl = document.createElement("div");
    lbl.className = "metadata-label";
    lbl.textContent = (it.group ? it.group + " — " : "") + it.label;
    const val = document.createElement("div");
    val.className = "metadata-value";
    let v = it.value;
    if (typeof v === "string" && v.length > 400) v = v.slice(0, 400) + "…";
    val.textContent = v;
    row.appendChild(lbl);
    row.appendChild(val);
    allMetadataEl.appendChild(row);
  }
}
function filterMetadata() {
  const q = searchInput.value.trim().toLowerCase();
  allMetadataEl.querySelectorAll(".metadata-item").forEach((r) => {
    r.style.display = !q || r.dataset.search.includes(q) ? "" : "none";
  });
}
function buildExportData() {
  const cats = state.categories
    .map((c) => ({
      title: c.title,
      items: c.items
        .filter((i) => String(i.value) && String(i.value) !== "-")
        .map((i) => ({ label: i.label, value: i.value })),
    }))
    .filter((c) => c.items.length);
  state.exportData = {
    generatedAt: new Date().toISOString(),
    file: state.file
      ? {
          name: state.file.name,
          size: state.file.size,
          type: state.file.type,
          lastModified: state.file.lastModified,
        }
      : null,
    detectedFormat: state.format ? { ...state.format } : null,
    processingTime: processingTime.textContent,
    gps: state.gps || null,
    categories: cats,
    allMetadata: state.rawItems,
  };
}
function formatGpsLine(g) {
  let s = g.latitude.toFixed(6) + ", " + g.longitude.toFixed(6);
  if (g.altitude != null && g.altitude !== "")
    s += "  (alt " + g.altitude + ")";
  return s;
}
function decimalToDms(v, kind) {
  const hemi = kind === "lat" ? (v < 0 ? "S" : "N") : v < 0 ? "W" : "E";
  const a = Math.abs(v);
  const d = Math.floor(a);
  const mf = Math.floor((a - d) * 60);
  const s = ((a - d) * 60 - mf) * 60;
  return d + "° " + mf + "' " + s.toFixed(3) + '" ' + hemi;
}
function showGpsCard(g, source) {
  state.gps = g;
  gpsContent.innerHTML = "";
  const rows = document.createElement("div");
  rows.className = "gps-grid";
  const add = (label, value) => {
    const d = document.createElement("div");
    d.className = "gps-item";
    const l = document.createElement("span");
    l.className = "gps-label";
    l.textContent = label;
    const v = document.createElement("span");
    v.className = "gps-value";
    v.textContent = value;
    d.append(l, v);
    rows.appendChild(d);
  };
  add("Latitude", decimalToDms(g.latitude, "lat"));
  add("Longitude", decimalToDms(g.longitude, "lon"));
  if (g.altitude != null) add("Altitude", String(g.altitude));
  if (source) add("Source", source);
  const link = document.createElement("a");
  link.href = "https://www.google.com/maps?q=" + g.latitude + "," + g.longitude;
  link.target = "_blank";
  link.rel = "noopener";
  link.className = "map-link";
  link.textContent = "🗺️ View on Google Maps";
  gpsContent.append(rows, link);
  gpsCard.classList.remove("hidden");
}
function parseCoordString(s) {
  if (typeof s !== "string") return null;
  s = s.trim();
  if (!s) return null;
  const num = s
    .replace(/[NSEW]/gi, "")
    .replace(/°|["'″′]/g, " ")
    .replace(/,/g, ".")
    .trim();
  const arr = num
    .split(/\s+/)
    .map(Number)
    .filter((n) => !isNaN(n) && isFinite(n));
  if (!arr.length) return null;
  let val =
    arr.length === 1
      ? arr[0]
      : arr.length >= 3
        ? arr[0] + arr[1] / 60 + arr[2] / 3600
        : arr[0] + arr[1] / 60;
  const last = (s.match(/([NSEW])\s*$/i) || [])[1];
  if (last === "S" || last === "W" || (!last && s.includes("-")))
    val = -Math.abs(val);
  else val = Math.abs(val);
  return isFinite(val) ? val : null;
}
function parseIso6709(s) {
  if (typeof s !== "string") return null;
  s = s.trim().replace(/\/$/, "").replace(/\s/g, "");
  const nums = s.match(/[+-]\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const lat = parseFloat(nums[0]);
  const lon = parseFloat(nums[1]);
  if (isNaN(lat) || isNaN(lon)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
  const alt = nums[2] ? parseFloat(nums[2]) : null;
  return { latitude: lat, longitude: lon, altitude: isNaN(alt) ? null : alt };
}

/* ----------------------------- Downloads -------------------------------- */
function downloadOriginal() {
  if (!state.file) return;
  const url = trackUrl(URL.createObjectURL(state.file));
  downloadFromUrl(url, state.file.name);
  toast("Original file ready", "success", 1500);
}

async function removeAndDownload() {
  if (!state.file || !state.buffer || state.format.category !== "image") {
    toast("Remove Metadata only works on images", "error");
    return;
  }
  showOverlay("Stripping metadata…");
  let url = null;
  try {
    url = trackUrl(URL.createObjectURL(state.file));
    const img = new Image();
    img.src = url;
    await new Promise((res, rej) => {
      img.onload = res;
      img.onerror = rej;
    });
    if (!img.naturalWidth) throw new Error("Image did not load");
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d");
    // Browsers apply EXIF orientation for <img>; drawing to canvas flattens/removes metadata.
    ctx.drawImage(img, 0, 0);
    const mime = state.format.label === "JPEG" ? "image/jpeg" : "image/png";
    const blob = await new Promise((res) =>
      canvas.toBlob(res, mime, mime === "image/jpeg" ? 0.95 : 1.0),
    );
    URL.revokeObjectURL(url);
    url = null;
    if (!blob) throw new Error("Could not generate clean image");
    const base = state.file.name.replace(/\.[^.]+$/im, "");
    downloadBlob(
      blob,
      base + "_no_metadata." + (mime === "image/jpeg" ? "jpeg" : "png"),
    );
    toast(
      (state.format.subtype === "gif"
        ? "Animation flattened to first frame. "
        : "") + "Clean copy generated (metadata stripped)",
      "success",
    );
  } catch (err) {
    console.error(err);
    if (url)
      try {
        URL.revokeObjectURL(url);
      } catch (e) {}
    toast("Error removing metadata: " + (err.message || err), "error");
  } finally {
    hideOverlay();
  }
}

function exportJson() {
  if (!state.exportData) {
    toast("No data to export yet", "info");
    return;
  }
  const name =
    (state.file ? state.file.name.replace(/\.[^.]+$/im, "") : "metadata") +
    ".metadata.json";
  downloadBlob(
    new Blob([JSON.stringify(state.exportData, null, 2)], {
      type: "application/json",
    }),
    name,
  );
  toast("Metadata exported as JSON", "success", 1500);
}

function copyJson() {
  if (!state.exportData) {
    toast("No data to copy", "info");
    return;
  }
  copyText(JSON.stringify(state.exportData, null, 2));
  toast("Metadata JSON copied to clipboard", "success", 1600);
}

/* --------------------- Image metadata helpers --------------------------- */
const GROUP_LABELS = {
  exif: "EXIF",
  gps: "GPS",
  iptc: "IPTC",
  xmp: "XMP",
  icc: "ICC",
  mpf: "MPF",
  png: "PNG",
  jfif: "JFIF",
  file: "File",
  composite: "Composite",
  photoshop: "Photoshop",
};
const SKIP_GROUPS = ["thumbnail", "errors"];

function serializeTagValue(tag) {
  try {
    if (!tag || typeof tag !== "object")
      return tag === undefined ? null : String(tag);
    let d = tag.description;
    if (typeof d === "string" && d.length > 0) return d;
    const v = tag.value;
    if (v === undefined || v === null)
      return d !== undefined && d !== null ? String(d) : null;
    if (typeof v === "number" || typeof v === "boolean") return String(v);
    if (typeof v === "string") return v;
    if (Array.isArray(v)) {
      const parts = v.slice(0, 64).map((x) => {
        if (x && typeof x === "object") {
          if (Array.isArray(x))
            return x.length === 2 && typeof x[1] === "number"
              ? x[1]
                ? x[0] / x[1]
                : x[0]
              : x.join("/");
          if (x.description) return x.description;
          if ("value" in x) return String(x.value);
        }
        return typeof x === "number"
          ? Number.isInteger(x)
            ? String(x)
            : String(Math.round(x * 1e6) / 1e6)
          : String(x);
      });
      let s = parts.join(", ");
      if (v.length > 64) s += " …(+" + (v.length - 64) + " more)";
      return s;
    }
    if (typeof v === "object") return JSON.stringify(v).slice(0, 400);
    return String(v);
  } catch (e) {
    return null;
  }
}

function flattenGroups(tags) {
  const items = [];
  Object.keys(tags).forEach((gk) => {
    if (SKIP_GROUPS.includes(gk)) return;
    const g = tags[gk];
    if (!g || typeof g !== "object" || Array.isArray(g)) return;
    const gl = GROUP_LABELS[gk] || gk.toUpperCase();
    Object.keys(g).forEach((k) => {
      const t = g[k];
      if (!t || typeof t !== "object") return;
      if ("description" in t || "value" in t) {
        const v = serializeTagValue({
          description: t.description,
          value: t.value,
        });
        if (v !== null) items.push({ group: gl, label: k, value: v });
      } else {
        Object.keys(t).forEach((sk) => {
          const st = t[sk];
          if (
            st &&
            typeof st === "object" &&
            ("description" in st || "value" in st)
          ) {
            const v = serializeTagValue({
              description: st.description,
              value: st.value,
            });
            if (v !== null)
              items.push({ group: gl, label: k + "." + sk, value: v });
          }
        });
      }
    });
  });
  return items;
}

function findGroupTag(tags, ...keys) {
  if (!tags) return null;
  for (const gk of Object.keys(tags)) {
    const g = tags[gk];
    if (!g || typeof g !== "object" || Array.isArray(g)) continue;
    for (const k of keys) {
      const t = g[k];
      if (t && ("description" in t || "value" in t)) return t;
    }
  }
  return null;
}

function extractThumbnail(tags) {
  try {
    const th = tags.thumbnail;
    if (!th) return null;
    if (th.base64) return "data:image/jpeg;base64," + th.base64;
    if (th.image && th.image instanceof ArrayBuffer)
      return (
        "data:" +
        (th.type || "image/jpeg") +
        ";base64," +
        arrayBufferToBase64(th.image)
      );
    return null;
  } catch (e) {
    return null;
  }
}

function gpsDms(tag, ref) {
  if (!tag) return null;
  let deg = null;
  const v = tag.value,
    d = tag.description;
  if (Array.isArray(v)) {
    const p = v.map((fr) =>
      Array.isArray(fr) ? (fr[1] ? fr[0] / fr[1] : fr[0]) : Number(fr),
    );
    if (p.length >= 3) deg = p[0] + p[1] / 60 + p[2] / 3600;
    else if (p.length) deg = p[0];
  } else {
    const cd = parseCoordString(String(d !== undefined && d !== null ? d : v));
    if (cd !== null) deg = cd;
  }
  if (deg === null) return null;
  const r = ref
    ? String(
        ref.value !== undefined && ref.value !== null
          ? ref.value
          : ref.description || "",
      )
        .trim()
        .toUpperCase()
    : "";
  if (r.startsWith("S") || r.startsWith("W")) deg = -Math.abs(deg);
  else if (r.startsWith("N") || r.startsWith("E")) deg = Math.abs(deg);
  return deg;
}
function findTagValue(obj, regex) {
  if (!obj) return null;
  for (const k of Object.keys(obj)) {
    if (regex.test(k)) {
      const t = obj[k];
      const v =
        t && t.description != null
          ? t.description
          : t && "value" in t
            ? t.value
            : t;
      if (v != null) return String(v);
    }
  }
  return null;
}
function findTagPair(obj, latRe, lonRe) {
  const la = findTagValue(obj, latRe);
  const lo = findTagValue(obj, lonRe);
  if (la != null && lo != null) {
    const lat = parseCoordString(la);
    const lon = parseCoordString(lo);
    if (lat != null && lon != null) return { latitude: lat, longitude: lon };
  }
  return null;
}
function extractExifGps(tags) {
  if (!tags) return null;
  let lat = null,
    lon = null,
    alt = null,
    src = "";
  if (tags.gps) {
    if (tags.gps.Latitude) lat = parseFloat(tags.gps.Latitude.description);
    if (tags.gps.Longitude) lon = parseFloat(tags.gps.Longitude.description);
    if (tags.gps.Altitude) alt = parseFloat(tags.gps.Altitude.description);
    src = "EXIF GPS";
  }
  if (
    (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) &&
    tags.exif
  ) {
    const e = tags.exif;
    if ((lat === null || Number.isNaN(lat)) && e.GPSLatitude)
      lat = gpsDms(e.GPSLatitude, e.GPSLatitudeRef);
    if ((lon === null || Number.isNaN(lon)) && e.GPSLongitude)
      lon = gpsDms(e.GPSLongitude, e.GPSLongitudeRef);
    if ((alt === null || Number.isNaN(alt)) && e.GPSAltitude)
      alt = parseFloat(e.GPSAltitude.description);
    if (!src) src = "EXIF GPS";
  }
  if (
    (lat === null || lon === null || Number.isNaN(lat) || Number.isNaN(lon)) &&
    tags.xmp
  ) {
    const p = findTagPair(tags.xmp, /GPSLatitude$/i, /GPSLongitude$/i);
    if (p) {
      lat = p.latitude;
      lon = p.longitude;
    } else {
      const c = findTagValue(tags.xmp, /GPSCoordinates$/i);
      const iso = parseIso6709(c);
      if (iso) {
        lat = iso.latitude;
        lon = iso.longitude;
        if (iso.altitude != null && alt === null) alt = iso.altitude;
      }
    }
    if (!src) src = "XMP GPS";
  }
  if (lat != null && lon != null && !Number.isNaN(lat) && !Number.isNaN(lon))
    return {
      latitude: lat,
      longitude: lon,
      altitude: alt != null && !Number.isNaN(alt) ? alt : null,
      source: src || "EXIF",
    };
  return null;
}

/* ----------------------------- Image helpers ----------------------------- */
const camFmt = {
  FNumber: (v) => "f/" + v,
  FocalLength: (v) => v + " mm",
  FocalLengthIn35mmFilm: (v) => v + " mm",
  ExposureBiasValue: (v) => v + " EV",
  MaxApertureValue: (v) => "f/" + v,
  ExposureTime: (v) => (/[/]/.test(v) ? v + " s" : parseFloat(v) + " s"),
};
function fmtValue(t, f) {
  const raw = t.description != null ? String(t.description) : String(t.value);
  if (!f) return raw;
  try {
    return f(raw);
  } catch (e) {
    return raw;
  }
}

async function decodeTiff(buffer) {
  if (typeof UTIF === "undefined" || !buffer) return null;
  try {
    const ifds = UTIF.decode(buffer);
    let page = ifds.find((p) => p && p.width > 0) || ifds[0];
    if (!page) return null;
    UTIF.decodeImage(buffer, page, ifds); // requires pako for compressed strips
    const rgba = UTIF.toRGBA8(page);
    const w = page.width,
      h = page.height;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    const id = ctx.createImageData(w, h);
    id.data.set(rgba);
    ctx.putImageData(id, 0, 0);
    return { width: w, height: h, dataUrl: canvas.toDataURL("image/png") };
  } catch (e) {
    console.warn("TIFF decode failed:", e);
    return null;
  }
}

/* ----------------------------- Image handler ----------------------------- */
async function handleImage(file, buffer, fmt) {
  let groups = null,
    flat = null;
  if (typeof ExifReader !== "undefined" && buffer) {
    try {
      groups = ExifReader.load(buffer, { expanded: true });
    } catch (e) {}
    if (!groups) {
      try {
        groups = ExifReader.load(buffer, { expanded: true });
      } catch (e2) {}
    }
    if (!groups) {
      try {
        flat = ExifReader.load(buffer);
      } catch (e) {}
    }
  }
  const ctx = groups || (flat ? { exif: flat } : null);
  const thumb = extractThumbnail(ctx || {});
  const props = makeCategory("Image Properties", "📐");
  const camera = makeCategory("Camera & Capture", "📷");
  const dates = makeCategory("Date & Time", "🕐");

  const failPreview = () => {
    if (thumb) {
      const img = document.createElement("img");
      img.src = thumb;
      img.alt = "Embedded thumbnail";
      previewBox.innerHTML = "";
      previewBox.appendChild(img);
      state.objectUrls.push(thumb);
    } else
      showPlaceholder(
        "🖼️",
        fmt.label,
        "Preview not supported in your browser — metadata still extracted.",
      );
  };
  if (fmt.subtype === "tiff") {
    const r = await decodeTiff(buffer);
    if (r) {
      state.mediaWidth = r.width;
      state.mediaHeight = r.height;
      showDetailRow("rowDimensions");
      det.dimensions.textContent = r.width + " × " + r.height + " px";
      showMediaPreview(r.dataUrl, "image");
    } else failPreview();
  } else {
    const url = trackUrl(URL.createObjectURL(file));
    const img = new Image();
    img.onload = () => {
      state.mediaWidth = img.naturalWidth;
      state.mediaHeight = img.naturalHeight;
      showDetailRow("rowDimensions");
      det.dimensions.textContent =
        img.naturalWidth + " × " + img.naturalHeight + " px";
    };
    img.onerror = () => failPreview();
    img.src = url;
    previewBox.innerHTML = "";
    previewBox.appendChild(img);
  }

  if (ctx) {
    const w = findGroupTag(
      ctx,
      "ImageWidth",
      "ExifImageWidth",
      "PixelXDimension",
    );
    const h = findGroupTag(
      ctx,
      "ImageHeight",
      "ExifImageHeight",
      "PixelYDimension",
    );
    if (w)
      addItem(
        props,
        "Width",
        String(w.description != null ? w.description : w.value),
      );
    if (h)
      addItem(
        props,
        "Height",
        String(h.description != null ? h.description : h.value),
      );
    if (state.mediaWidth)
      addItem(
        props,
        "Rendered Dimensions",
        state.mediaWidth + " × " + state.mediaHeight + " px",
      );
    let t;
    if ((t = findGroupTag(ctx, "Orientation")))
      addItem(props, "Orientation", String(t.description));
    if ((t = findGroupTag(ctx, "XResolution")))
      addItem(props, "X Resolution", String(t.description));
    if ((t = findGroupTag(ctx, "ResolutionUnit")))
      addItem(props, "Resolution Unit", String(t.description));
    if ((t = findGroupTag(ctx, "BitsPerSample", "BitDepth")))
      addItem(props, "Bit Depth", String(t.description));
    if ((t = findGroupTag(ctx, "ColorSpace", "ColorType")))
      addItem(props, "Color Space/Type", String(t.description));
    if ((t = findGroupTag(ctx, "Compression")))
      addItem(props, "Compression", String(t.description));
    if (ctx.icc) {
      addItem(
        props,
        "ICC Profile",
        "present (" + Object.keys(ctx.icc).length + " tags)",
      );
      addRaw("ICC", "ICC profile", "present");
    }
    if (ctx.mpf) addItem(props, "MPF", "Multi-Picture Format present");

    const camFields = [
      ["Camera Make", "Make"],
      ["Camera Model", "Model"],
      ["Lens Make", "LensMake"],
      ["Lens Model", "LensModel"],
      ["Lens Specification", "LensSpecification"],
      ["ISO", "ISOSpeedRatings"],
      ["Aperture", "FNumber"],
      ["Shutter Speed", "ExposureTime"],
      ["Focal Length", "FocalLength"],
      ["Focal Length (35mm)", "FocalLengthIn35mmFilm"],
      ["Exposure Compensation", "ExposureBiasValue"],
      ["Max Aperture", "MaxApertureValue"],
      ["Exposure Program", "ExposureProgram"],
      ["Metering Mode", "MeteringMode"],
      ["Flash", "Flash"],
      ["White Balance", "White Balance"],
      ["Subject Distance", "SubjectDistance"],
    ];
    for (const [label, key] of camFields) {
      const t = findGroupTag(ctx, key);
      if (t) {
        const v = fmtValue(t, camFmt[key]);
        addItem(camera, label, v);
        addRaw("Camera", label, v);
      }
    }

    const dateFields = [
      ["Date Taken", "DateTimeOriginal"],
      ["Date Digitized", "DateTimeDigitized"],
      ["Date/Time Modified", "DateTime"],
      ["Create Date", "CreateDate"],
      ["Modified Date", "ModifyDate"],
      ["Time Zone", "OffsetTime"],
      ["Subseconds", "SubSecTime"],
    ];
    for (const [label, key] of dateFields) {
      const t = findGroupTag(ctx, key);
      if (t) {
        const v = String(t.description != null ? t.description : t.value);
        addItem(dates, label, v);
        addRaw("Date/Time", label, v);
      }
    }
    if (ctx.xmp) {
      for (const [kk, ll] of [
        ["CreateDate", "Creation Date (XMP)"],
        ["ModifyDate", "Modification Date (XMP)"],
        ["MetadataDate", "Metadata Date"],
      ]) {
        const t = findGroupTag(ctx, kk);
        if (t) {
          const v = String(t.description != null ? t.description : t.value);
          addItem(dates, ll, v);
          addRaw("XMP", ll, v);
        }
      }
    }

    if (groups)
      flattenGroups(groups).forEach((it) =>
        addRaw(it.group, it.label, it.value),
      );
    else
      Object.keys(flat).forEach((k) => {
        const t = flat[k];
        if (t && ("description" in t || "value" in t)) {
          const v = serializeTagValue({
            description: t.description,
            value: t.value,
          });
          if (v !== null) addRaw("EXIF", k, v);
        }
      });
  }

  const gps = ctx ? extractExifGps(ctx) : null;
  if (gps) showGpsCard(gps, gps.source || "EXIF");
  if (!state.rawItems.length && !gps) {
    const c = makeCategory("No Metadata", "ℹ️");
    addItem(c, "Info", "No EXIF/XMP/IPTC metadata was found in this image.");
    addRaw(
      "Info",
      "No metadata found",
      "No EXIF/XMP/IPTC metadata was found in this image.",
    );
  }
}

/* ----------------------------- MP4 / MOV parser -------------------------- */
const MP4_KEY_LABELS = {
  "©nam": "Title",
  "©alb": "Album",
  "©ART": "Artist",
  aART: "Album Artist",
  "©wrt": "Composer",
  "©day": "Year/Date",
  "©swr": "Software",
  "©too": "Encoder",
  "©cmt": "Comment",
  "©gen": "Genre",
  "©enc": "Encoded By",
  covr: "Cover Art",
  desc: "Description",
  trkn: "Track Number",
  disk: "Disc Number",
  tmpo: "BPM",
  cpil: "Compilation",
  "©mak": "Make",
  "©mod": "Model",
  "©xyz": "Location (°)",
  "com.apple.quicktime.make": "Make",
  "com.apple.quicktime.model": "Camera Model",
  "com.apple.quicktime.software": "Software",
  "com.apple.quicktime.creationdate": "Creation Date",
  "com.apple.quicktime.location.ISO6709": "GPS Location",
  "com.apple.quicktime.content.identifier": "Content ID",
  "com.apple.quicktime.duration": "Duration",
  GPSCoordinates: "GPS Coordinates (ISO6709)",
  "©lyr": "Lyrics",
  "©grp": "Grouping",
};
function normalizeMp4Key(k) {
  return MP4_KEY_LABELS[k] || k;
}
function hexFromBytes(b) {
  let s = "";
  for (let i = 0; i < b.length; i++)
    s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
  return s;
}
function parseFloat3(dv, off) {
  for (const start of [off, off + 2, off + 4]) {
    if (!start || start + 12 > dv.byteLength) continue;
    const la = dv.getFloat32(start),
      lo = dv.getFloat32(start + 4),
      al = dv.getFloat32(start + 8);
    if (
      isFinite(la) &&
      isFinite(lo) &&
      Math.abs(la) <= 90 &&
      Math.abs(lo) <= 180
    )
      return { latitude: la, longitude: lo, altitude: al };
  }
  return null;
}

function parseMp4(buffer) {
  const out = {
    brands: [],
    brand: "",
    minor: 0,
    creationDate: null,
    modificationDate: null,
    durationS: null,
    timescale: 1,
    tracks: [],
    tags: {},
    xmp: "",
    cover: null,
    gps: null,
  };
  if (!buffer || buffer.byteLength < 16) return out;
  const dv = new DataView(buffer);
  const H = new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 262144));
  const four = (o) =>
    String.fromCharCode(
      dv.getUint8(o),
      dv.getUint8(o + 1),
      dv.getUint8(o + 2),
      dv.getUint8(o + 3),
    );
  const u64 = (o) => {
    const hi = dv.getUint32(o),
      lo = dv.getUint32(o + 4);
    return hi * 4294967296 + lo;
  };
  const mp4Time = (raw) => {
    if (!raw || raw < 1e6 || raw > 1e18) return null;
    let ms;
    if (raw >= 2082844800 && raw <= 4102444800) ms = (raw - 2082844800) * 1000;
    else if (raw >= 1e17) ms = raw / 1e6;
    else if (raw >= 1e9 && raw < 1e12) ms = raw * 1000;
    else ms = raw * 1000;
    const d = new Date(ms);
    return d.getFullYear() > 1900 && d.getFullYear() < 2300 ? d : null;
  };
  const st = { track: null, itemKey: null, keys: {} };
  function parseMp4Data(body, end) {
    if (end - body < 12) return;
    const typeInd = dv.getUint32(body);
    const dataOff = body + 8;
    const len = end - dataOff;
    const key = st.itemKey;
    const label = normalizeMp4Key(key);
    let value = null,
      kind = "text";
    if (key === "©xyz" && typeInd === 0 && len >= 12) {
      const g = parseFloat3(dv, dataOff);
      if (g) {
        out.gps = {
          latitude: g.latitude,
          longitude: g.longitude,
          altitude: g.altitude,
          source: "©xyz",
        };
        value =
          g.latitude +
          ", " +
          g.longitude +
          (g.altitude != null ? " (alt " + g.altitude + ")" : "");
      }
    } else {
      try {
        if (typeInd === 1 || typeInd === 2 || typeInd === 4 || typeInd === 0)
          value = decodeUtf8(dv, dataOff, Math.min(len, 4096)).replace(
            /\0+$/g,
            "",
          );
        else if (typeInd === 13 || typeInd === 14 || typeInd === 27) {
          kind = "image";
          const mime =
            typeInd === 14
              ? "image/png"
              : typeInd === 27
                ? "image/bmp"
                : "image/jpeg";
          out.cover = { mime, bytes: buffer.slice(dataOff, end) };
        } else if (typeInd === 21) value = String(dv.getInt32(dataOff));
        else if (typeInd === 22) value = String(dv.getUint32(dataOff));
        else if (typeInd === 23)
          value = String(Math.round(dv.getFloat32(dataOff) * 1000) / 1000);
        else if (typeInd === 24) value = String(dv.getFloat64(dataOff));
        else
          value = decodeUtf8(dv, dataOff, Math.min(len, 4096)).replace(
            /\0+$/g,
            "",
          );
      } catch (e) {
        value = null;
      }
    }
    if (value === null || value === "") return;
    out.tags[label || key] = value;
    addRaw("MP4", label || key, value);
    if (/gps|location|coord/i.test(label || key)) {
      const g = parseIso6709(value);
      if (g && !out.gps)
        out.gps = {
          latitude: g.latitude,
          longitude: g.longitude,
          altitude: g.altitude,
          source: label || "GPS",
        };
    }
  }
  function parseDataBoxes(start, end) {
    let off = start;
    while (off + 8 <= end) {
      let size = dv.getUint32(off);
      const t = four(off + 4);
      let hdr = 8;
      if (size === 1) {
        if (off + 16 > end) break;
        size = u64(off + 8);
        hdr = 16;
      } else if (size === 0) size = end - off;
      if (size < hdr || off + size > end) break;
      if (t === "data") parseMp4Data(off + hdr, off + size);
      off += size;
    }
  }
  function parseIlstItems(start, end) {
    let off = start;
    while (off + 8 <= end) {
      let size = dv.getUint32(off);
      const t = four(off + 4);
      let hdr = 8;
      if (size === 1) {
        if (off + 16 > end) break;
        size = u64(off + 8);
        hdr = 16;
      } else if (size === 0) size = end - off;
      if (size < hdr || off + size > end) break;
      const body = off + hdr,
        bodyEnd = off + size;
      st.itemKey =
        t === "mdta"
          ? st.keys[dv.getUint32(body)] || "Key#" + dv.getUint32(body)
          : t;
      parseDataBoxes(body, bodyEnd);
      off += size;
    }
  }

  function walk(start, end, ctx, depth) {
    let off = start;
    while (off + 8 <= end && depth < 12) {
      let size = dv.getUint32(off);
      const type = four(off + 4);
      let hdr = 8;
      if (size === 1) {
        if (off + 16 > end) break;
        size = u64(off + 8);
        hdr = 16;
      } else if (size === 0) size = end - off;
      if (size < hdr || off + size > end) break;
      const body = off + hdr,
        bodyEnd = off + size;
      if (type === "ftyp") {
        out.brand = four(body);
        out.minor = dv.getUint32(body + 4);
        out.brands = readMp4Brands(H, 16);
      } else if (
        type === "moov" ||
        type === "mdia" ||
        type === "minf" ||
        type === "stbl" ||
        type === "udta" ||
        type === "mvex" ||
        type === "sinf" ||
        type === "schm" ||
        type === "schi" ||
        type === "dinf" ||
        type === "dref" ||
        type === "stsc" ||
        type === "stsz" ||
        type === "stco" ||
        type === "co64" ||
        type === "stsh" ||
        type === "padb" ||
        type === "saio" ||
        type === "saft"
      )
        walk(body, bodyEnd, ctx, depth + 1);
      else if (type === "meta") {
        let s = body;
        if (s + 4 <= bodyEnd && dv.getUint32(s) === 0) s += 4;
        walk(s, bodyEnd, "meta", depth + 1);
      } else if (type === "tkhd") {
        const v = dv.getUint8(body);
        if (st.track)
          st.track.creationDate = mp4Time(
            v === 1 ? u64(body + 12) : dv.getUint32(body + 4),
          );
        const wOff = body + 4 + (v === 1 ? 32 : 20) + 52;
        if (bodyEnd >= wOff + 8) {
          st.track.width = dv.getUint32(wOff) >>> 16;
          st.track.height = dv.getUint32(wOff + 4) >>> 16;
        }
      } else if (type === "trak") {
        const tk = {
          type: "unknown",
          codec: "",
          width: 0,
          height: 0,
          timescale: 0,
          durationS: 0,
          fps: null,
          sampleRate: null,
          channels: null,
          name: "",
          creationDate: null,
        };
        st.track = tk;
        out.tracks.push(tk);
        walk(body, bodyEnd, "trak", depth + 1);
      } else if (type === "mdhd") {
        const v = dv.getUint8(body);
        if (st.track) {
          st.track.timescale =
            v === 1 ? u64(body + 20) : dv.getUint32(body + 12);
          st.track.durationS =
            v === 1 ? u64(body + 24) : dv.getUint32(body + 16);
          if (st.track.timescale > 0) st.track.fps = null;
        }
      } else if (type === "mvhd") {
        const v = dv.getUint8(body);
        if (v === 1) {
          out.creationDate = mp4Time(u64(body + 4));
          out.modificationDate = mp4Time(u64(body + 12));
          out.timescale = u64(body + 20);
          const dur = u64(body + 28);
          if (out.timescale > 0) out.durationS = dur / out.timescale;
        } else {
          out.creationDate = mp4Time(dv.getUint32(body + 4));
          out.modificationDate = mp4Time(dv.getUint32(body + 8));
          out.timescale = dv.getUint32(body + 12);
          const dur = dv.getUint32(body + 16);
          if (out.timescale > 0) out.durationS = dur / out.timescale;
        }
      } else if (type === "hdlr") {
        if (st.track && bodyEnd >= body + 12) st.track.type = four(body + 8);
      } else if (type === "stsd") {
        if (st.track && bodyEnd >= body + 16) st.track.codec = four(body + 12);
      } else if (type === "stts") {
        if (st.track && st.track.timescale > 0 && bodyEnd >= body + 16) {
          const n = dv.getUint32(body + 4);
          if (n > 0) {
            const delta = dv.getUint32(body + 12);
            if (delta > 0)
              st.track.fps =
                Math.round((st.track.timescale / delta) * 100) / 100;
          }
        }
      } else if (type === "keys") {
        let p = body + 4;
        if (bodyEnd < p) break;
        const cnt = dv.getUint32(p);
        p += 4;
        for (let i = 0; i < cnt && p + 8 <= bodyEnd; i++) {
          const es = dv.getUint32(p);
          const idx = dv.getUint32(p + 4);
          if (es < 8 || p + es > bodyEnd) break;
          st.keys[idx] = decodeUtf8(dv, p + 8, es - 8);
          p += es;
        }
      } else if (type === "ilst") parseIlstItems(body, bodyEnd);
      else if (type === "xml" || type === "XML ")
        out.xmp += decodeUtf8(dv, body, Math.min(bodyEnd - body, 262144));
      else if (type === "uuid" && off + 24 <= bodyEnd) {
        const id = hexFromBytes(new Uint8Array(buffer, off + 8, 16));
        if (id.toLowerCase().startsWith("be7acfcb"))
          out.xmp += decodeUtf8(
            dv,
            off + 24,
            Math.max(0, bodyEnd - (off + 24)),
          );
      }
      off += size;
    }
  }
  walk(0, dv.byteLength, "root", 0);
  if (out.durationS) {
    state.mediaDuration = out.durationS;
    setDetail("duration", formatDuration(out.durationS));
    showDetailRow("rowDuration");
  }
  if (out.tracks.some((t) => t.type === "vide")) {
    const v = out.tracks.find((t) => t.type === "vide");
    if (v.width && v.height) {
      state.mediaWidth = v.width;
      state.mediaHeight = v.height;
      setDetail("dimensions", v.width + " × " + v.height + " px");
      showDetailRow("rowDimensions");
    }
  }
  return out;
}

/* ----------------------------- EBML (MKV/WebM) parser -------------------- */
function ebmlDate(rawNs) {
  if (rawNs == null) return null;
  let ms = rawNs / 1e6 + 978307200000;
  if (Math.abs(rawNs) < 1e14) ms = rawNs * 1000; // fallback: treat as unix-ish milliseconds
  const d = new Date(ms);
  return d.getFullYear() > 1900 && d.getFullYear() < 2300 ? d : null;
}

function parseEBML(buffer) {
  const out = {
    docType: "",
    durationS: null,
    dateUTC: null,
    title: "",
    muxingApp: "",
    writingApp: "",
    tracks: [],
    tags: {},
  };
  if (!buffer || buffer.byteLength < 4) return out;
  const dv = new DataView(buffer);
  const readId = (p) => {
    if (p >= dv.byteLength) return null;
    const b = dv.getUint8(p);
    let len;
    b & 0x80
      ? (len = 1)
      : b & 0x40
        ? (len = 2)
        : b & 0x20
          ? (len = 3)
          : b & 0x10
            ? (len = 4)
            : (len = 9);
    if (len > 4 || p + len > dv.byteLength) return null;
    let id = 0;
    for (let i = 0; i < len; i++) id = (id << 8) | dv.getUint8(p + i);
    return { id, len };
  };
  const readSize = (p) => {
    if (p >= dv.byteLength) return { len: 1, value: 0, unknown: true };
    const b = dv.getUint8(p);
    let len;
    b & 0x80
      ? (len = 1)
      : b & 0x40
        ? (len = 2)
        : b & 0x20
          ? (len = 3)
          : b & 0x10
            ? (len = 4)
            : b & 0x08
              ? (len = 5)
              : b & 0x04
                ? (len = 6)
                : b & 0x02
                  ? (len = 7)
                  : (len = 8);
    if (p + len > dv.byteLength) return { len, value: 0, unknown: true };
    const vMask = (1 << (8 - len)) - 1;
    let value = len === 8 ? b : b & vMask;
    for (let i = 1; i < len; i++) value = value * 256 + dv.getUint8(p + i);
    const mMark = len === 8 ? 0xff : 0xff ^ vMask;
    let unknown = len === 8 ? false : (b & mMark) === mMark;
    return { len, value, unknown };
  };
  const ID = {
    0x4282: "DocType",
    0x4287: "DocTypeCompatible",
    0x4285: "DocTypeVersion",
    0x4286: "DocTypeReadVersion",
    0x1549a966: "Info",
    0x2ad7b1: "TimecodeScale",
    0x4489: "Duration",
    0x4461: "DateUTC",
    0x7ba9: "Title",
    0x4d80: "MuxingApp",
    0x5741: "WritingApp",
    0x1654ae6b: "Tracks",
    0x86: "CodecID",
    0x83: "TrackType",
    0x258688: "CodecName",
    0x536e: "Name",
    0xb0: "PixelWidth",
    0xba: "PixelHeight",
    0xb5: "SamplingFrequency",
    0x9f: "Channels",
    0x1254c367: "Tags",
    0x7373: "Tag",
    0x67c8: "SimpleTag",
    0x45a3: "TagName",
    0x4487: "TagString",
    0xae: "TrackEntry",
    0xe0: "Video",
    0xe1: "Audio",
    0x1a45dfa3: "EBML",
    0x18538067: "Segment",
  };
  const MASTERS = {
    0x1a45dfa3: 1,
    0x18538067: 1,
    0x1549a966: 1,
    0x1654ae6b: 1,
    0xae: 1,
    0xe0: 1,
    0xe1: 1,
    0x1254c367: 1,
    0x7373: 1,
    0x67c8: 1,
    0x114d9b74: 1,
    0x1941a469: 1,
    0x1043a770: 1,
    0x1c53bb6b: 1,
  };
  let curTrack = null,
    curTag = null;
  function iter(p, end, scope, depth) {
    while (p + 8 <= end && depth < 14) {
      const idR = readId(p);
      if (!idR) break;
      const id = idR.id;
      const pid = p + idR.len;
      const sz = readSize(pid);
      const body = pid + sz.len;
      const childEnd = sz.unknown ? end : Math.min(end, body + sz.value);
      const name = ID[id];
      if (MASTERS[id]) {
        let ns = scope;
        if (id === 0xae) ns = "track";
        else if (id === 0xe0) ns = "video";
        else if (id === 0xe1) ns = "audio";
        else if (id === 0x67c8) ns = "simpletag";
        else if (id === 0x1549a966) ns = "info";
        else if (id === 0x1654ae6b) ns = "tracks";
        else if (id === 0x1254c367) ns = "tags";
        iter(body, childEnd, ns, depth + 1);
      } else if (name) {
        const dataLen = sz.unknown ? 0 : sz.value;
        if (id === 0x4282)
          out.docType = decodeUtf8(dv, body, Math.min(dataLen, 128));
        else if (id === 0x7ba9 || id === 0x4d80 || id === 0x5741) {
          const s = decodeUtf8(dv, body, Math.min(dataLen, 1024));
          if (id === 0x7ba9) out.title = s;
          else if (id === 0x4d80) out.muxingApp = s;
          else out.writingApp = s;
        } else if (scope === "info" && id === 0x2ad7b1) {
          const ts = dv.getUint32(body);
          if (ts > 0) out.timecodeScale = ts;
        } else if (scope === "info" && id === 0x4489) {
          const d = dataLen === 8 ? dv.getFloat64(body) : dv.getFloat32(body);
          const ts = out.timecodeScale || 1000000;
          out.durationS = (d * ts) / 1e9;
          state.mediaDuration = out.durationS;
        } else if (scope === "info" && id === 0x4461) {
          if (dataLen >= 8)
            out.dateUTC = ebmlDate(Number(dv.getBigInt64(body)));
        } else if (scope === "track") {
          if (id === 0x86) {
            curTrack = {
              type: "unknown",
              codec: decodeUtf8(dv, body, Math.min(dataLen, 64)),
              width: 0,
              height: 0,
              sampleRate: 0,
              channels: 0,
            };
            out.tracks.push(curTrack);
          } else if (id === 0x83 && curTrack)
            curTrack.type = dv.getUint8(body) === 0x1 ? "video" : "audio";
          else if (id === 0x258688 && curTrack)
            curTrack.codecName = decodeUtf8(dv, body, Math.min(dataLen, 128));
        } else if (
          scope === "video" &&
          curTrack &&
          (id === 0xb0 || id === 0xba)
        ) {
          if (id === 0xb0) curTrack.width = dv.getUint32(body, false);
          else curTrack.height = dv.getUint32(body, false);
        } else if (scope === "audio" && curTrack) {
          if (id === 0xb5) curTrack.sampleRate = dv.getFloat32(body, false);
          else if (id === 0x9f) curTrack.channels = dv.getUint8(body);
        } else if (scope === "simpletag") {
          if (id === 0x45a3)
            curTag = decodeUtf8(dv, body, Math.min(dataLen, 256));
          else if (id === 0x4487 && curTag)
            out.tags[curTag] = decodeUtf8(dv, body, Math.min(dataLen, 1024));
        }
      }
      if (sz.unknown) break;
      p = body + sz.value;
    }
  }
  iter(0, dv.byteLength, "root", 0);
  return out;
}

/* ----------------------------- FLAC/Vorbis parser ----------------------- */
function parseFlac(buffer) {
  const out = {
    signature: "",
    format: "FLAC",
    durationS: null,
    sampleRate: 0,
    channels: 0,
    bitsPerSample: 0,
    totalSamples: 0,
    tags: {},
  };
  if (!buffer || buffer.byteLength < 8) return out;
  const dv = new DataView(buffer);
  const magic = new Uint8Array(buffer, 0, 4);
  if (String.fromCharCode.apply(null, magic) !== "fLaC") {
    out.error = "Not a FLAC stream";
    return out;
  }
  out.signature = "fLaC";
  let off = 4;
  // parse METADATA_BLOCK headers until AUDIO frame
  while (off + 4 <= dv.byteLength) {
    const b0 = dv.getUint8(off);
    const type = (b0 & 0x7f) >> 1;
    const isLast = b0 & 0x80;
    const len = dv.getUint32(off + 1) & 0x00ffffff;
    off += 4;
    if (off + len > dv.byteLength) break;
    if (type === 0) {
      // STREAMINFO
      if (off + 17 <= dv.byteLength) {
        out.totalSamples = Number(dv.getBigInt64(off + 6, false));
        out.sampleRate = dv.getUint16(off, false) >> 4;
        out.channels = ((dv.getUint8(off + 4) >> 1) + 1) & 0x07;
        out.bitsPerSample =
          ((dv.getUint8(off + 4) & 0x01) << 2) | (dv.getUint8(off + 5) >> 6);
        if (out.sampleRate > 0 && out.totalSamples > 0)
          out.durationS = out.totalSamples / out.sampleRate;
      }
    } else if (type === 6) {
      // PICTURE
      // skip full block but could decode; not surfaced here
    } else if (type === 4 || type === 5 || type === 3) {
      // VORBIS_COMMENT / CDTOC / CUESHEET (skip)
      if (type === 4 && off + 4 <= dv.byteLength)
        parseVorbisComment(dv, off, off + len, out.tags, false);
    } else if (type === 1) {
      // TRACK_INFO / SEEKTABLE
    } else {
      /* OTHER */
    }
    off += len;
    if (isLast) break;
  }
  state.mediaDuration = out.durationS;
  return out;
}

function parseVorbisComment(dv, p, end, tags, isOgg) {
  // vendor length (4 bytes LE), then comments
  let i = p;
  if (i + 4 > end) return;
  const vlen = dv.getUint32(i, true);
  i += 4;
  if (i + vlen > end) return;
  const vendor = decodeUtf8(dv, i, vlen);
  i += vlen;
  tags["vendor"] = vendor;
  if (i + 4 > end) return;
  const count = dv.getUint32(i, true);
  i += 4;
  let j = 0;
  while (j < count && i + 4 <= end) {
    const clen = dv.getUint32(i, true);
    i += 4;
    if (i + clen > end) break;
    const txt = decodeUtf8(dv, i, clen);
    i += clen;
    const eq = txt.indexOf("=");
    if (eq > 0) {
      const k = txt.slice(0, eq).toUpperCase();
      const v = txt.slice(eq + 1);
      tags[k] = v;
    }
    j++;
  }
}

function parseWav(buffer) {
  const out = {
    format: "WAVE",
    durationS: null,
    sampleRate: 0,
    channels: 0,
    bitsPerSample: 0,
    audioFormat: 0,
    tags: {},
  };
  if (!buffer || buffer.byteLength < 12) {
    out.error = "File too short";
    return out;
  }
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(
    dv.getUint8(0),
    dv.getUint8(1),
    dv.getUint8(2),
    dv.getUint8(3),
  );
  if (magic !== "RIFF") {
    out.error = "Not a RIFF/WAV file";
    return out;
  }
  const fileSize = dv.getUint32(4, true);
  const waveMagic = String.fromCharCode(
    dv.getUint8(8),
    dv.getUint8(9),
    dv.getUint8(10),
    dv.getUint8(11),
  );
  if (waveMagic !== "WAVE") {
    out.error = "RIFF but not WAV";
    return out;
  }
  let off = 12;
  const end = Math.min(dv.byteLength, 8 + fileSize);
  let audioSize = 0,
    factSampleSize = 0,
    dataStart = 0,
    dataEnd = 0;
  while (off + 8 <= end) {
    const ckId = String.fromCharCode(
      dv.getUint8(off),
      dv.getUint8(off + 1),
      dv.getUint8(off + 2),
      dv.getUint8(off + 3),
    );
    const ckSize = dv.getUint32(off + 4, true);
    off += 8;
    if (off + ckSize > end) break;
    if (ckId === "fmt ") {
      out.audioFormat = dv.getUint16(off, true);
      out.channels = dv.getUint16(off + 2, true);
      out.sampleRate = dv.getUint32(off + 4, true);
      dv.getUint32(off + 8, true); // byte rate
      dv.getUint16(off + 12, true); // block align
      out.bitsPerSample = dv.getUint16(off + 14, true);
      if (out.audioFormat === 1 && out.bitsPerSample === 0)
        out.bitsPerSample = 16;
    } else if (ckId === "fact") {
      factSampleSize =
        out.audioFormat === 0xfffe
          ? dv.getUint32(off, true)
          : ckSize >= 4
            ? dv.getUint32(off, true)
            : 0;
    } else if (ckId === "data") {
      dataStart = off;
      dataEnd = off + ckSize;
      audioSize = ckSize;
    } else if (ckId === "LIST") {
      const listType = String.fromCharCode(
        dv.getUint8(off),
        dv.getUint8(off + 1),
        dv.getUint8(off + 2),
        dv.getUint8(off + 3),
      );
      if (listType === "INFO") {
        let p = off + 4;
        while (p + 8 <= off + ckSize) {
          const id = String.fromCharCode(
            dv.getUint8(p),
            dv.getUint8(p + 1),
            dv.getUint8(p + 2),
            dv.getUint8(p + 3),
          );
          const sz = dv.getUint32(p + 4, true);
          p += 8;
          if (p + sz > end) break;
          if (sz > 0)
            out.tags[id] = decodeUtf8(dv, p, Math.min(sz, 512)).replace(
              /\0+$/g,
              "",
            );
          p += sz;
        }
      }
    }
    off += ckSize + (ckSize % 2);
  }
  if (out.sampleRate > 0 && dataEnd > dataStart) {
    const bytesPerSample = out.bitsPerSample ? out.bitsPerSample / 8 : 1;
    const frameSize = bytesPerSample * (out.channels || 1);
    if (frameSize > 0) {
      out.durationS = (dataEnd - dataStart) / frameSize / out.sampleRate;
      state.mediaDuration = out.durationS;
    }
  }
  return out;
}
/* --------------------------- shared byte helpers ------------------------- */
const u16le = (b, i) => byteAt(b, i) | (byteAt(b, i + 1) << 8);
const u32le = (b, i) =>
  (byteAt(b, i) |
    (byteAt(b, i + 1) << 8) |
    (byteAt(b, i + 2) << 16) |
    (byteAt(b, i + 3) << 24)) >>>
  0;
const u64le = (dv, o) =>
  dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296;
const u64be = (dv, o) =>
  dv.getUint32(o, false) * 4294967296 + dv.getUint32(o + 4, false);
function concatBytes(chunks) {
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}
function indexOfBytes(hay, needle, from) {
  outer: for (let i = from || 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++)
      if (hay[i + j] !== needle[j]) continue outer;
    return i;
  }
  return -1;
}
const bytesOf = (str) => {
  const a = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) a[i] = str.charCodeAt(i) & 0xff;
  return a;
};
function dosDateTime(d, t) {
  if (!d) return null;
  const y = 1980 + ((d >> 9) & 0x7f),
    mo = (d >> 5) & 0x0f,
    da = d & 0x1f;
  const h = (t >> 11) & 0x1f,
    mi = (t >> 5) & 0x3f,
    s = (t & 0x1f) * 2;
  const dt = new Date(y, Math.max(0, mo - 1), da || 1, h, mi, s);
  return isNaN(dt) || dt.getFullYear() < 1980 || dt.getFullYear() > 2200
    ? null
    : dt;
}
function octalOf(b, o, len) {
  let s = "";
  for (let i = 0; i < len; i++) {
    const c = byteAt(b, o + i);
    if (c === 0 || c === 0x20) break;
    s += String.fromCharCode(c);
  }
  const v = parseInt(s.trim(), 8);
  return isFinite(v) ? v : 0;
}
function safeDecode(bytes, enc) {
  try {
    if (!bytes || !bytes.length) return "";
    if (enc === 1) {
      if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe)
        return new TextDecoder("utf-16le")
          .decode(bytes.subarray(2))
          .replace(/\0+$/, "");
      if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff)
        return new TextDecoder("utf-16be")
          .decode(bytes.subarray(2))
          .replace(/\0+$/, "");
      return new TextDecoder("utf-16le").decode(bytes).replace(/\0+$/, "");
    }
    if (enc === 2)
      return new TextDecoder("utf-16be").decode(bytes).replace(/\0+$/, "");
    if (enc === 3) return UTF8.decode(bytes).replace(/\0+$/, "");
    return LATIN1.decode(bytes).replace(/\0+$/, "");
  } catch (e) {
    return "";
  }
}
function decodeField(dv, off, len, enc) {
  if (len <= 0 || off < 0 || off + len > dv.byteLength) return "";
  return safeDecode(
    new Uint8Array(dv.buffer, dv.byteOffset + off, len),
    enc,
  ).trim();
}
/* ----------------------------- MPEG audio (MP3) ------------------------- */
const MPEG_BITRATES = {
  1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
};
const MPEG_RATES = {
  1: [44100, 48000, 32000],
  2: [22050, 24000, 16000],
  3: [11025, 12000, 8000],
};

function parseMpegAudio(view, dv, start) {
  const res = {
    version: "",
    layer: "",
    bitrate: 0,
    sampleRate: 0,
    channels: 0,
    mode: "",
    durationS: null,
    vbr: false,
    frames: null,
  };
  const n = view.length;
  let p = start;
  while (p + 4 <= n && p < start + (1 << 20)) {
    if (view[p] === 0xff && (view[p + 1] & 0xe0) === 0xe0) {
      const b1 = view[p + 1],
        b2 = view[p + 2];
      const verBits = (b1 >> 3) & 3,
        layerBits = (b1 >> 1) & 3,
        brIdx = (b2 >> 4) & 15,
        srIdx = (b2 >> 2) & 3;
      if (
        verBits !== 1 &&
        layerBits !== 0 &&
        brIdx > 0 &&
        brIdx < 15 &&
        srIdx < 3
      ) {
        const ver = verBits === 3 ? 1 : verBits === 2 ? 2 : 3;
        const layer = 4 - layerBits;
        const spf = layer === 1 ? 384 : ver === 1 ? 1152 : 576;
        res.version = ver === 1 ? "MPEG-1" : ver === 2 ? "MPEG-2" : "MPEG-2.5";
        res.layer = "Layer " + layer;
        res.bitrate = MPEG_BITRATES[layer][brIdx];
        res.sampleRate = MPEG_RATES[ver][srIdx];
        res.channels = ((b2 >> 6) & 3) === 3 ? 1 : 2;
        res.mode = ["Stereo", "Joint stereo", "Dual channel", "Mono"][
          (b2 >> 6) & 3
        ];
        const sideInfo =
          layer === 1
            ? 17
            : ver === 1
              ? res.channels === 1
                ? 17
                : 32
              : res.channels === 1
                ? 9
                : 17;
        const x = p + 4 + sideInfo;
        if (x + 16 <= n) {
          const tag = ascii(view, x, 4);
          if (tag === "Xing" || tag === "Info") {
            if (dv.getUint32(x + 4, false) & 1) {
              res.frames = dv.getUint32(x + 8, false);
              res.vbr = tag === "Xing";
              if (res.sampleRate > 0)
                res.durationS = (res.frames * spf) / res.sampleRate;
            }
          } else if (ascii(view, x + 32, 4) === "VBRI" && x + 50 <= n) {
            res.frames = dv.getUint32(x + 46, false);
            res.vbr = true;
            if (res.sampleRate > 0 && res.frames > 0)
              res.durationS = (res.frames * spf) / res.sampleRate;
          }
        }
        res.frameOffset = p;
        if (res.durationS == null && res.bitrate > 0) {
          res.durationS = ((n - p) * 8) / (res.bitrate * 1000);
          res.estimated = true;
        }
        return res;
      }
    }
    p++;
  }
  return res;
}
/* ----------------------------- ID3v2 / ID3v1 ---------------------------- */
const ID3_FRAME_LABELS = {
  TIT2: "Title",
  TT2: "Title",
  TPE1: "Artist",
  TP1: "Artist",
  TPE2: "Album Artist",
  TP2: "Album Artist",
  TALB: "Album",
  TAL: "Album",
  TDRC: "Year",
  TYER: "Year",
  TYE: "Year",
  TCON: "Genre",
  TCO: "Genre",
  TRCK: "Track",
  TRK: "Track",
  TPOS: "Disc",
  TPA: "Disc",
  TCOM: "Composer",
  TCM: "Composer",
  TCOP: "Copyright",
  TCR: "Copyright",
  TENC: "Encoded By",
  TEN: "Encoded By",
  TSSE: "Encoder Settings",
  TIT1: "Grouping",
  TT1: "Grouping",
  TIT3: "Subtitle",
  TT3: "Subtitle",
  TBPM: "BPM",
  TBP: "BPM",
  TKEY: "Initial Key",
  TKE: "Initial Key",
  TLAN: "Language",
  TLA: "Language",
  TPUB: "Publisher",
  TPB: "Publisher",
  TSRC: "ISRC",
  TRC: "ISRC",
  TPE3: "Conductor",
  TP3: "Conductor",
  TPE4: "Interpreted By",
  TMED: "Media Type",
  TMT: "Media Type",
  TDAT: "Date",
  TDA: "Date",
  TIME: "Time",
  TORY: "Original Year",
  TOR: "Original Year",
  TOAL: "Original Album",
  TOT: "Original Album",
  TOPE: "Original Artist",
  TOA: "Original Artist",
  TXXX: "Custom",
  TXX: "Custom",
  COMM: "Comment",
  COM: "Comment",
  USLT: "Lyrics",
  ULT: "Lyrics",
  WXXX: "URL",
  WXX: "URL",
  WOAR: "Artist URL",
  TCMP: "Compilation",
  TDRL: "Release Date",
  TDEN: "Encoding Time",
  TDTG: "Tagging Time",
  TVER: "Version",
  TSOA: "Album Sort",
  TSOP: "Artist Sort",
};
const ID3V1_GENRES = [
  "Blues",
  "Classic Rock",
  "Country",
  "Dance",
  "Disco",
  "Funk",
  "Grunge",
  "Hip-Hop",
  "Jazz",
  "Metal",
  "New Age",
  "Oldies",
  "Other",
  "Pop",
  "R&B",
  "Rap",
  "Reggae",
  "Rock",
  "Techno",
  "Industrial",
  "Alternative",
  "Ska",
  "Death Metal",
  "Pranks",
  "Soundtrack",
  "Euro-Techno",
  "Ambient",
  "Trip-Hop",
  "Vocal",
  "Jazz+Funk",
  "Fusion",
  "Trance",
  "Classical",
  "Instrumental",
  "Acid",
  "House",
  "Game",
  "Sound Clip",
  "Gospel",
  "Noise",
  "AlternRock",
  "Bass",
  "Soul",
  "Punk",
  "Space",
  "Meditative",
  "Instrumental Pop",
  "Instrumental Rock",
  "Ethnic",
  "Gothic",
  "Darkwave",
  "Techno-Industrial",
  "Electronic",
  "Pop-Folk",
  "Eurodance",
  "Dream",
  "Southern Rock",
  "Comedy",
  "Cult",
  "Gangsta",
  "Top 40",
  "Christian Rap",
  "Pop/Funk",
  "Jungle",
  "Native American",
  "Cabaret",
  "New Wave",
  "Psychadelic",
  "Rave",
  "Showtunes",
  "Trailer",
  "Lo-Fi",
  "Tribal",
  "Acid Punk",
  "Acid Jazz",
  "Polka",
  "Retro",
  "Musical",
  "Rock & Roll",
  "Hard Rock",
  "Folk",
  "Folk-Rock",
  "National Folk",
  "Swing",
  "Fast Fusion",
  "Bebob",
  "Latin",
  "Revival",
  "Celtic",
  "Bluegrass",
  "Avantgarde",
  "Gothic Rock",
  "Progressive Rock",
  "Psychedelic Rock",
  "Symphonic Rock",
  "Slow Rock",
  "Big Band",
  "Chorus",
  "Easy Listening",
  "Acoustic",
  "Humour",
  "Speech",
  "Chanson",
  "Opera",
  "Chamber Music",
  "Sonata",
  "Symphony",
  "Booty Bass",
  "Primus",
  "Porn Groove",
  "Satire",
  "Slow Jam",
  "Club",
  "Tango",
  "Samba",
  "Folklore",
  "Ballad",
  "Power Ballad",
  "Rhythmic Soul",
  "Freestyle",
  "Duet",
  "Punk Rock",
  "Drum Solo",
  "A capella",
  "Euro-House",
  "Dance Hall",
];
function parseId3(buffer) {
  const out = {
    versions: [],
    tags: {},
    pictures: [],
    audio: null,
    audioOffset: 0,
    v1: null,
  };
  if (!buffer || buffer.byteLength < 10) return out;
  const dv = new DataView(buffer);
  const view = new Uint8Array(buffer);
  const n = view.length;
  let p = 0,
    guard = 0;
  while (
    p + 10 <= n &&
    guard++ < 4 &&
    view[p] === 0x49 &&
    view[p + 1] === 0x44 &&
    view[p + 2] === 0x33
  ) {
    const major = view[p + 3],
      rev = view[p + 4],
      flags = view[p + 5];
    const size =
      ((view[p + 6] & 0x7f) << 21) |
      ((view[p + 7] & 0x7f) << 14) |
      ((view[p + 8] & 0x7f) << 7) |
      (view[p + 9] & 0x7f);
    out.versions.push("ID3v2." + major + "." + rev);
    let q = p + 10;
    const end = Math.min(n, p + 10 + size);
    if (flags & 0x40) {
      // extended header
      if (q + 6 > end) {
        p = end;
        continue;
      }
      if (major === 3) q += 4 + dv.getUint32(q, false);
      else if (major === 4)
        q +=
          ((view[q] & 0x7f) << 21) |
          ((view[q + 1] & 0x7f) << 14) |
          ((view[q + 2] & 0x7f) << 7) |
          (view[q + 3] & 0x7f);
      else q += 6;
    }
    while (q < end) {
      const idLen = major === 2 ? 3 : 4,
        hdrLen = major === 2 ? 6 : 10;
      if (q + hdrLen > end) break;
      let id = "";
      for (let i = 0; i < idLen; i++) {
        const c = view[q + i];
        if (!((c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39))) {
          id = "";
          break;
        }
        id += String.fromCharCode(c);
      }
      if (!id) break; // padding reached
      const fsize =
        major === 2
          ? (view[q + 3] << 16) | (view[q + 4] << 8) | view[q + 5]
          : major === 4
            ? ((view[q + 4] & 0x7f) << 21) |
              ((view[q + 5] & 0x7f) << 14) |
              ((view[q + 6] & 0x7f) << 7) |
              (view[q + 7] & 0x7f)
            : dv.getUint32(q + 4, false);
      if (fsize <= 0 || q + hdrLen + fsize > end) break;
      let body = q + hdrLen;
      const fend = q + hdrLen + fsize;
      if (major === 4) {
        const f = view[q + 9];
        if (f & 0x01) body += 4;
        if (f & 0x02) {
          const g = view[body];
          body += 1;
          if (g & 0x01) body += 4;
          if (g & 0x02) body += 4;
        }
      } else if (major === 3) {
        const f = view[q + 9];
        if (f & 0x80) body += 4;
        if (f & 0x40) body += 4;
        if (f & 0x20) body += 4;
      }
      if (body >= fend) {
        q = fend;
        continue;
      }
      const enc = view[body];
      const skipDesc = (dp) => {
        if (enc === 1 || enc === 2) {
          while (dp + 1 < fend && !(view[dp] === 0 && view[dp + 1] === 0))
            dp += 2;
          return dp + 2;
        }
        while (dp < fend && view[dp] !== 0) dp++;
        return dp + 1;
      };
      if (id === "APIC" || id === "PIC") {
        try {
          const mp = body + 1;
          let me = mp;
          while (me < fend && view[me] !== 0) me++;
          const mime =
            id === "PIC"
              ? "image/" + ascii(view, mp, 3).toLowerCase()
              : decodeField(dv, mp, me - mp, 0);
          let dp = id === "PIC" ? mp + 3 : me + 1;
          const picType = view[dp];
          dp += 1;
          dp = skipDesc(dp);
          if (dp < fend)
            out.pictures.push({
              mime: /^image\//.test(mime) ? mime : "image/jpeg",
              type: picType,
              bytes: buffer.slice(dp, fend),
            });
        } catch (e) {
          /* malformed picture */
        }
      } else if (id === "TXXX" || id === "TXX") {
        try {
          let sep = body + 1;
          if (enc === 1 || enc === 2) {
            while (sep + 1 < fend && !(view[sep] === 0 && view[sep + 1] === 0))
              sep += 2;
            const desc = decodeField(dv, body + 1, sep - body - 1, enc);
            sep += 2;
            const val = decodeField(dv, sep, fend - sep, enc);
            if (val) out.tags["Custom: " + (desc || "value")] = val;
          } else {
            while (sep < fend && view[sep] !== 0) sep++;
            const desc = decodeField(dv, body + 1, sep - body - 1, enc);
            sep += 1;
            const val = decodeField(dv, sep, fend - sep, enc);
            if (val) out.tags["Custom: " + (desc || "value")] = val;
          }
        } catch (e) {
          /* malformed */
        }
      } else if (
        id === "COMM" ||
        id === "COM" ||
        id === "USLT" ||
        id === "ULT"
      ) {
        try {
          const lang = ascii(view, body + 1, 3).replace(/\0/g, "");
          const dp = skipDesc(body + 4);
          const val = decodeField(dv, dp, fend - dp, enc);
          if (val)
            out.tags[
              (id === "COMM" || id === "COM" ? "Comment" : "Lyrics") +
                (lang && lang !== "eng" ? " (" + lang + ")" : "")
            ] = val;
        } catch (e) {
          /* malformed */
        }
      } else if (id === "PCNT") {
        const v = String(dv.getUint32(body + 1, false) || 0);
        if (v !== "0") out.tags["Play Count"] = v;
      } else if (ID3_FRAME_LABELS[id]) {
        const label = ID3_FRAME_LABELS[id];
        const v = decodeField(dv, body + 1, fend - body - 1, enc);
        if (v)
          out.tags[label] =
            out.tags[label] && out.tags[label] !== v
              ? out.tags[label] + " / " + v
              : v;
      }
      q = fend;
    }
    p = end;
  }
  out.audioOffset = p;
  out.audio = parseMpegAudio(view, dv, p);
  if (n >= 128 && ascii(view, n - 128, 3) === "TAG") {
    // ID3v1
    const b = new Uint8Array(buffer, n - 128, 128);
    const take = (o, l) => decodeLatin1(b, o, l).replace(/\0+$/g, "").trim();
    const v1 = {};
    if (take(3, 30)) v1.Title = take(3, 30);
    if (take(33, 30)) v1.Artist = take(33, 30);
    if (take(63, 30)) v1.Album = take(63, 30);
    if (take(93, 4)) v1.Year = take(93, 4);
    if (take(97, 30)) v1.Comment = take(97, 30);
    const track = byteAt(b, 126);
    if (track) v1.Track = String(track);
    const genre = byteAt(b, 127);
    if (genre) v1.Genre = ID3V1_GENRES[genre] || "Genre #" + genre;
    out.v1 = v1;
  }
  return out;
}
/* ----------------------------- Ogg container ----------------------------- */
function parseOgg(buffer) {
  const out = {
    codec: "",
    codecVersion: "",
    channels: 0,
    sampleRate: 0,
    durationS: null,
    tags: {},
    serial: null,
    bitrateNominal: 0,
  };
  if (!buffer || buffer.byteLength < 27) return out;
  const dv = new DataView(buffer);
  const view = new Uint8Array(buffer);
  const limit = Math.min(view.length, 262144);
  const chunks = [];
  let p = 0,
    pages = 0;
  while (p + 27 <= limit && pages < 12) {
    if (
      !(
        view[p] === 0x4f &&
        view[p + 1] === 0x67 &&
        view[p + 2] === 0x67 &&
        view[p + 3] === 0x53
      )
    )
      break;
    if (pages === 0) out.serial = dv.getUint32(p + 14, true);
    const segs = view[p + 26];
    if (p + 27 + segs > limit) break;
    let total = 0;
    for (let i = 0; i < segs; i++) total += view[p + 27 + i];
    const payload = p + 27 + segs;
    if (payload + total > limit) {
      chunks.push(view.subarray(payload, limit));
      break;
    }
    chunks.push(view.subarray(payload, payload + total));
    p = payload + total;
    pages++;
  }
  const head = concatBytes(chunks);
  if (
    head.length > 7 &&
    head[0] === 0x01 &&
    indexOfBytes(head, bytesOf("vorbis"), 0) === 1
  ) {
    out.codec = "Vorbis";
    out.codecVersion = "Vorbis " + u32le(head, 7);
    out.channels = byteAt(head, 11);
    out.sampleRate = u32le(head, 12);
    out.bitrateNominal = u32le(head, 20);
  } else if (indexOfBytes(head, bytesOf("OpusHead"), 0) === 0) {
    out.codec = "Opus";
    out.codecVersion = "Opus " + byteAt(head, 8) + "." + byteAt(head, 9);
    out.channels = byteAt(head, 10);
    out.preSkip = u16le(head, 11);
    out.inputSampleRate = u32le(head, 13);
    out.sampleRate = 48000;
  } else if (indexOfBytes(head, bytesOf("Speex"), 0) >= 0) {
    out.codec = "Speex";
  } else if (indexOfBytes(head, bytesOf("theora"), 0) >= 0) {
    out.codec = "Theora";
  } else if (head[0] === 0x7f && ascii(head, 1, 4) === "FLAC") {
    out.codec = "FLAC (Ogg)";
    out.channels = byteAt(head, 14);
    out.sampleRate =
      (byteAt(head, 22) << 12) |
      (byteAt(head, 23) << 4) |
      (byteAt(head, 24) >> 4);
  } else {
    out.codec = "Unknown";
  }
  const cdv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  try {
    const vc = indexOfBytes(head, bytesOf("\x03vorbis"), 0);
    const ot = indexOfBytes(head, bytesOf("OpusTags"), 0);
    if (vc >= 0 && vc + 7 < head.length)
      parseVorbisComment(cdv, vc + 7, head.length, out.tags, true);
    else if (ot >= 0 && ot + 8 < head.length)
      parseVorbisComment(cdv, ot + 8, head.length, out.tags, true);
    else if (out.codec === "FLAC (Ogg)") {
      const vs = indexOfBytes(head, bytesOf("fLaC"), 0);
      if (vs >= 0) parseVorbisComment(cdv, vs + 8, head.length, out.tags, true);
    }
  } catch (e) {
    /* malformed comment header */
  }
  const tailStart = Math.max(0, view.length - 65536);
  let last = -1;
  for (let i = tailStart; i + 27 <= view.length; i++) {
    if (
      view[i] === 0x4f &&
      view[i + 1] === 0x67 &&
      view[i + 2] === 0x67 &&
      view[i + 3] === 0x53
    )
      last = i;
  }
  if (last >= 0 && last + 14 <= view.length) {
    const granule = u64le(dv, last + 6);
    const rate = out.sampleRate > 0 ? out.sampleRate : 48000;
    if (granule > 0 && granule < Number.MAX_SAFE_INTEGER) {
      out.durationS = granule / rate;
      state.mediaDuration = out.durationS;
    }
  }
  return out;
}
/* ----------------------------- AVI (RIFF video) ------------------------- */
const AVI_TAG_LABELS = {
  INAM: "Title",
  IART: "Artist",
  ICMT: "Comment",
  ICRD: "Creation Date",
  ISFT: "Software",
  IGNR: "Genre",
  ICOP: "Copyright",
  ITCH: "Technician",
  IENG: "Engineer",
  IKEY: "Keywords",
  ISBJ: "Subject",
  IEDT: "Edited By",
  IPRD: "Product",
  ISRC: "Source",
  IWRI: "Written By",
};

function parseAvi(buffer) {
  const out = {
    format: "AVI",
    width: 0,
    height: 0,
    fps: null,
    durationS: null,
    frames: null,
    streams: [],
    tags: {},
    codecs: [],
  };
  if (!buffer || buffer.byteLength < 16) return out;
  const dv = new DataView(buffer);
  const view = new Uint8Array(buffer);
  const n = view.length;
  const walkEnd = Math.min(n, 32 * 1024 * 1024);
  function walk(start, end, depth) {
    let off = start;
    while (off + 8 <= end && depth < 6) {
      const id = ascii(view, off, 4);
      const size = dv.getUint32(off + 4, true);
      const body = off + 8;
      if (body + size > end + 1) break;
      if (id === "LIST") {
        const type = ascii(view, body, 4);
        if (type === "INFO") {
          let q = body + 4;
          while (q + 8 <= body + size) {
            const sid = ascii(view, q, 4);
            const ssz = dv.getUint32(q + 4, true);
            q += 8;
            if (q + ssz > body + size + 1) break;
            const val = decodeUtf8(dv, q, Math.min(ssz, 512))
              .replace(/\0+$/g, "")
              .trim();
            if (val) out.tags[AVI_TAG_LABELS[sid] || sid] = val;
            q += ssz + (ssz % 2);
          }
        } else if (type !== "movi")
          walk(body + 4, Math.min(body + size, walkEnd), depth + 1);
      } else if (id === "avih" && body + 40 <= n) {
        const usPerFrame = dv.getUint32(body, true);
        out.frames = dv.getUint32(body + 16, true);
        out.width = dv.getUint32(body + 32, true);
        out.height = dv.getUint32(body + 36, true);
        if (usPerFrame > 0)
          out.fps = Math.round((1e6 / usPerFrame) * 100) / 100;
        if (usPerFrame > 0 && out.frames)
          out.durationS = (usPerFrame / 1e6) * out.frames;
      } else if (id === "strh" && body + 36 <= n) {
        const fccType = ascii(view, body, 4);
        const scale = dv.getUint32(body + 20, true),
          rate = dv.getUint32(body + 24, true);
        const stream = {
          type:
            fccType === "vids"
              ? "video"
              : fccType === "auds"
                ? "audio"
                : fccType.trim(),
          codec: ascii(view, body + 4, 4).trim(),
          samples: dv.getUint32(body + 32, true),
          fps: rate && scale ? Math.round((rate / scale) * 100) / 100 : null,
        };
        if (out.streams.length < 16) out.streams.push(stream);
        if (stream.codec) out.codecs.push(stream.codec);
      } else if (id === "strf" && body + 16 <= n) {
        const last = out.streams[out.streams.length - 1];
        if (last && last.type === "video")
          last.bitCount = dv.getUint16(body + 14, true);
        else if (last && last.type === "audio") {
          last.audioFormat = dv.getUint16(body, true);
          last.channels = dv.getUint16(body + 2, true);
          last.sampleRate = dv.getUint32(body + 4, true);
          last.bitsPerSample = dv.getUint16(body + 14, true);
        }
      }
      off = body + size + (size % 2);
    }
  }
  walk(12, walkEnd, 0);
  if (out.durationS) state.mediaDuration = out.durationS;
  if (out.width && out.height) {
    state.mediaWidth = out.width;
    state.mediaHeight = out.height;
  }
  return out;
}
/* ----------------------------- PDF parser ------------------------------- */
function parsePdf(buffer) {
  const out = {
    version: "",
    info: {},
    pages: null,
    encrypted: false,
    linearized: false,
    xmp: "",
    pdfVersionInXmp: "",
    producers: [],
    objects: null,
    javascript: false,
    forms: 0,
    pageSizes: [],
  };
  if (!buffer || buffer.byteLength < 8) return out;
  const dv = new DataView(buffer);
  const view = new Uint8Array(buffer);
  const n = view.length;
  const head = view.subarray(0, Math.min(n, 1024));
  const m = /%PDF-(\d\.\d)/.exec(LATIN1.decode(head));
  if (m) out.version = m[1];
  // scan a bounded window from the start for the document Info dictionary
  const scanLen = Math.min(n, 262144);
  const text = LATIN1.decode(view.subarray(0, scanLen));
  if (/%PDF-1\.\d/.test(text) && /\/Encrypt\b/.test(text)) out.encrypted = true;
  if (/\/Linearized\b/.test(text)) out.linearized = true;
  if (/\/(JavaScript|JS)\b/.test(text)) out.javascript = true;
  const infoIdx = text.lastIndexOf("/Info");
  let dictText = "";
  if (infoIdx >= 0 && text.slice(infoIdx, infoIdx + 200).includes("obj")) {
    const objStart = text.indexOf("obj", infoIdx);
    const endIdx = text.indexOf("endobj", objStart);
    if (objStart > 0 && endIdx > objStart)
      dictText = text.slice(objStart + 3, Math.min(endIdx, objStart + 20000));
  } else {
    const s = text.indexOf("<<");
    if (s >= 0) dictText = text.slice(s, Math.min(scanLen, s + 40000));
  }
  const readPdfString = (raw) => {
    if (!raw) return "";
    let s = raw.trim();
    if (s.startsWith("(")) {
      let body = s.slice(
        1,
        s.lastIndexOf(")") >= 0 ? s.lastIndexOf(")") : undefined,
      );
      body = body.replace(
        /\\([nrtbf()\\])/g,
        (all, c) => ({ n: "\n", r: "\r", t: "\t", b: "\b", f: "\f" })[c] || c,
      );
      let res = "",
        i = 0;
      while (i < body.length) {
        if (body[i] === "\\" && /[0-7]/.test(body[i + 1] || "")) {
          const oct = body.substr(i + 1, 3).match(/^[0-7]{1,3}/)[0];
          res += String.fromCharCode(parseInt(oct, 8));
          i += 1 + oct.length;
        } else res += body[i++];
      }
      if (res.charCodeAt(0) === 0xfe && res.charCodeAt(1) === 0xff) {
        try {
          return new TextDecoder("utf-16be").decode(
            new Uint8Array([...res].map((c) => c.charCodeAt(0) & 0xff)),
          );
        } catch (e) {
          return res;
        }
      }
      return res;
    }
    if (s.startsWith("<")) return safeDecodeHexString(s);
    return s;
  };
  function safeDecodeHexString(s) {
    const hex = s.replace(/[^0-9a-fA-F]/g, "");
    if (hex.length < 2) return "";
    const even = hex.slice(0, hex.length - (hex.length % 2));
    const bytes = new Uint8Array(even.length / 2);
    for (let i = 0; i < bytes.length; i++)
      bytes[i] = parseInt(even.substr(i * 2, 2), 16);
    if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
      try {
        return new TextDecoder("utf-16be").decode(bytes.subarray(2));
      } catch (e) {
        return "";
      }
    }
    return safeDecode(bytes, 3).replace(
      /[^\x09\x0a\x0d\x20-\x7e\u00a0-\uffff]/g,
      "",
    );
  }
  for (const key of [
    "Title",
    "Author",
    "Subject",
    "Keywords",
    "Creator",
    "Producer",
    "CreationDate",
    "ModDate",
    "Trapped",
  ]) {
    const re = new RegExp("/" + key + "\\s*(\\([^)]*\\)|<[0-9A-Fa-f\\s]+>)");
    const mm = re.exec(dictText);
    if (mm) {
      const v = readPdfString(mm[1]).replace(/\0/g, "").trim();
      if (v) out.info[key] = v;
    }
  }
  if (out.info.Producer) out.producers.push(out.info.Producer);
  // XMP metadata packet
  const xmpIdx = indexOfBytes(view, bytesOf("<?xpacket begin"), 0);
  if (xmpIdx >= 0)
    out.xmp = decodeUtf8(dv, xmpIdx, Math.min(n - xmpIdx, 262144));
  else {
    const x2 = indexOfBytes(
      view.subarray(0, scanLen),
      bytesOf("adobe:ns:meta/"),
      0,
    );
    if (x2 >= 0) out.xmp = decodeUtf8(dv, x2, Math.min(scanLen - x2, 262144));
  }
  const xmpVer = /pdf:PDFVersion[^>]*>([^<]+)</.exec(out.xmp);
  if (xmpVer) out.pdfVersionInXmp = xmpVer[1];
  const xPages = /<pdf:Pages>(\d+)</.exec(out.xmp);
  if (xPages) out.pages = parseInt(xPages[1], 10);
  const objCount = (text.match(/\b\d+\s+\d+\s+obj\b/g) || []).length;
  if (!objCount) {
    const o2 = (text.match(/\d+\s+\d+\s+obj/g) || []).length;
    out.objects = o2 || null;
  } else out.objects = objCount;
  // page count heuristic: count /Type /Page objects in the scanned window
  if (out.pages == null) {
    const nPages = (text.match(/\/Type\s*\/Page[^s]/g) || []).length;
    const nPagesAll = (text.match(/\/Type\s*\/Pages\b/g) || []).length;
    if (nPages > 0) out.pages = nPages;
    else if (nPagesAll > 0) out.pages = null;
    const mc = /\/Count\s+(\d+)/g;
    let cm,
      last = null;
    while ((cm = mc.exec(text))) last = parseInt(cm[1], 10);
    if (last != null && last > 0) out.pages = last;
  }
  const forms = (text.match(/\/AcroForm\b/g) || []).length;
  out.forms = forms;
  const sizes = [...text.matchAll(/\/MediaBox\s*\[([^\]]+)\]/g)]
    .slice(0, 2)
    .map((mm) => mm[1].trim().replace(/\s+/g, " "));
  out.pageSizes = sizes;
  if (out.info.CreationDate || out.info.ModDate) {
    const d = out.info.CreationDate || out.info.ModDate;
    state.mediaDate = parsePdfDate(d);
  }
  return out;
}
function parsePdfDate(s) {
  if (!s) return null;
  const m = /D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?/.exec(
    String(s).trim(),
  );
  if (!m) return null;
  const [, Y, Mo, D, H, Mi, S] = m;
  const dt = new Date(
    Date.UTC(+Y, (Mo || "01") - 1, D || "01", H || "00", Mi || "00", S || "00"),
  );
  return isNaN(dt) ? null : dt;
}
/* ------------------------- OLE / CFB (legacy Office) -------------------- */
const OLE_PROP_LABELS = {
  2: "Title",
  3: "Subject",
  4: "Author",
  5: "Keywords",
  6: "Comments",
  7: "Template",
  8: "Last Saved By",
  9: "Revision Number",
  10: "Total Editing Time",
  11: "Last Printed",
  12: "Create Time",
  13: "Last Saved Time",
  14: "Number of Pages",
  15: "Number of Words",
  16: "Number of Characters",
  18: "Creating Application",
  19: "Security",
};
const OLE_DOC_LABELS = { 2: "Company", 3: "Language", 4: "Document Version" };

/* ----------------------------- ZIP / OOXML container --------------------- */
function parseZip(buffer) {
  const out = {
    entries: [],
    count: 0,
    comment: "",
    encrypted: false,
    totalUncompressed: 0,
    totalCompressed: 0,
    zip64: false,
  };
  if (!buffer || buffer.byteLength < 22) return out;
  const dv = new DataView(buffer);
  const view = new Uint8Array(buffer);
  const n = view.length;
  // locate End Of Central Directory
  let eocd = -1;
  const scanFrom = Math.max(0, n - EOCD_SCAN);
  for (let i = n - 22; i >= scanFrom; i--) {
    if (
      view[i] === 0x50 &&
      view[i + 1] === 0x4b &&
      view[i + 2] === 0x05 &&
      view[i + 3] === 0x06
    ) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) {
    out.error = "End of central directory not found";
    return out;
  }
  out.diskNumber = dv.getUint16(eocd + 4, true);
  let entryCount = dv.getUint16(eocd + 10, true);
  let cdSize = dv.getUint32(eocd + 12, true);
  let cdOffset = dv.getUint32(eocd + 16, true);
  out.comment = decodeUtf8(
    dv,
    eocd + 22,
    Math.min(dv.getUint16(eocd + 20, true), 4096),
  );
  // ZIP64 end of central directory locator
  if (
    eocd >= 20 &&
    view[eocd - 20] === 0x50 &&
    view[eocd - 19] === 0x4b &&
    view[eocd - 18] === 0x06 &&
    view[eocd - 17] === 0x07
  ) {
    const z64Off = Number(u64le(dv, eocd - 12));
    if (
      z64Off > 0 &&
      z64Off + 56 <= n &&
      view[z64Off] === 0x50 &&
      view[z64Off + 1] === 0x4b &&
      view[z64Off + 2] === 0x06 &&
      view[z64Off + 3] === 0x06
    ) {
      out.zip64 = true;
      entryCount = Number(u64le(dv, z64Off + 32));
      cdSize = Number(u64le(dv, z64Off + 40));
      cdOffset = Number(u64le(dv, z64Off + 48));
    }
  }
  let p = cdOffset,
    guard = 0;
  while (
    p + 46 <= n &&
    guard++ < 20000 &&
    out.entries.length < Math.min(entryCount || 20000, 20000)
  ) {
    if (
      !(
        view[p] === 0x50 &&
        view[p + 1] === 0x4b &&
        view[p + 2] === 0x01 &&
        view[p + 3] === 0x02
      )
    )
      break;
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const dosTime = dv.getUint16(p + 12, true),
      dosDate = dv.getUint16(p + 14, true);
    const crc = dv.getUint32(p + 16, true);
    let cSize = dv.getUint32(p + 20, true),
      uSize = dv.getUint32(p + 24, true);
    const nameLen = dv.getUint16(p + 28, true),
      extraLen = dv.getUint16(p + 30, true),
      cmtLen = dv.getUint16(p + 32, true);
    let lho = dv.getUint32(p + 42, true);
    const name = decodeUtf8(dv, p + 46, Math.min(nameLen, 1024));
    let extra = p + 46 + nameLen;
    // ZIP64 extra field
    if (
      extra + extraLen <= n &&
      (uSize === 0xffffffff || cSize === 0xffffffff || lho === 0xffffffff)
    ) {
      let q = extra;
      while (q + 4 <= extra + extraLen) {
        const hid = dv.getUint16(q, true),
          hsz = dv.getUint16(q + 2, true);
        if (hid === 0x01) {
          let r = q + 4;
          if (uSize === 0xffffffff && r + 8 <= q + 4 + hsz) {
            uSize = Number(u64le(dv, r));
            r += 8;
          }
          if (cSize === 0xffffffff && r + 8 <= q + 4 + hsz) {
            cSize = Number(u64le(dv, r));
            r += 8;
          }
          if (lho === 0xffffffff && r + 8 <= q + 4 + hsz)
            lho = Number(u64le(dv, r));
        }
        q += 4 + hsz;
      }
    }
    const isDir = name.endsWith("/") || (uSize === 0 && name.endsWith("/"));
    out.entries.push({
      name,
      method,
      flags,
      crc,
      compressedSize: cSize,
      size: uSize,
      localHeaderOffset: lho,
      date: dosDateTime(dosDate, dosTime),
      comment: cmtLen
        ? decodeUtf8(dv, extra + extraLen, Math.min(cmtLen, 512))
        : "",
      isDirectory: isDir,
    });
    if (flags & 0x01) out.encrypted = true;
    if (!isDir) {
      out.totalUncompressed += uSize;
      out.totalCompressed += cSize;
    }
    p += 46 + nameLen + extraLen + cmtLen;
  }
  out.count = out.entries.filter((e) => !e.isDirectory).length;
  return out;
}

function zipEntryData(buffer, entry) {
  if (!buffer || !entry) return null;
  const dv = new DataView(buffer);
  const view = new Uint8Array(buffer);
  const n = view.length;
  let p = entry.localHeaderOffset;
  if (
    p + 30 > n ||
    !(
      view[p] === 0x50 &&
      view[p + 1] === 0x4b &&
      view[p + 2] === 0x03 &&
      view[p + 3] === 0x04
    )
  )
    return null;
  const nameLen = dv.getUint16(p + 26, true),
    extraLen = dv.getUint16(p + 28, true);
  const method = dv.getUint16(p + 8, true);
  let cSize = dv.getUint32(p + 18, true),
    uSize = dv.getUint32(p + 22, true);
  if (cSize === 0xffffffff || uSize === 0xffffffff) {
    cSize = entry.compressedSize;
    uSize = entry.size;
  }
  const start = p + 30 + nameLen + extraLen;
  if (start + cSize > n) return null;
  const raw = view.subarray(start, start + cSize);
  try {
    if (method === 0) return raw;
    if (method === 8) {
      if (typeof pako !== "undefined" && pako.inflateRaw)
        return pako.inflateRaw(raw);
      if (typeof DecompressionStream !== "undefined") return null; // handled by caller (async path)
    }
  } catch (e) {
    return null;
  }
  return null;
}
/* ----------------------------- XML helpers ------------------------------- */
function decodeXmlEntities(s) {
  return String(s)
    .replace(/&#(\d+);/g, (a, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-f]+);/gi, (a, h) =>
      String.fromCharCode(parseInt(h, 16)),
    )
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
function xmlTag(xml, tag) {
  if (!xml) return "";
  const m = new RegExp(
    "<(?:[\\w.]+:)?" +
      tag +
      "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.]+:)?" +
      tag +
      ">",
  ).exec(xml);
  if (!m) return "";
  return decodeXmlEntities(m[1].replace(/<[^>]+>/g, "")).trim();
}
function xmlAttr(xml, tag, attr) {
  if (!xml) return "";
  const m = new RegExp(
    "<(?:[\\w.]+:)?" + tag + "\\b[^>]*\\b" + attr + '="([^"]*)"',
  ).exec(xml);
  return m ? decodeXmlEntities(m[1]).trim() : "";
}
function xmlAll(xml, tag) {
  if (!xml) return [];
  return [
    ...xml.matchAll(
      new RegExp(
        "<(?:[\\w.]+:)?" +
          tag +
          "(?:\\s[^>]*)?>([\\s\\S]*?)</(?:[\\w.]+:)?" +
          tag +
          ">",
        "g",
      ),
    ),
  ].map((m) => decodeXmlEntities(m[1].replace(/<[^>]+>/g, "")).trim());
}
function readZipText(buffer, zip, name) {
  const e = zip.entries.find(
    (x) => x.name.toLowerCase() === name.toLowerCase(),
  );
  if (!e) return "";
  const data = zipEntryData(buffer, e);
  if (!data || !data.length) return "";
  return safeDecode(data, 3);
}

function parseOfficeXml(buffer, zip, subtype) {
  const out = {
    title: "",
    author: "",
    lastAuthor: "",
    subject: "",
    keywords: "",
    description: "",
    category: "",
    company: "",
    app: "",
    appVersion: "",
    created: "",
    modified: "",
    revision: "",
    template: "",
    pages: "",
    words: "",
    chars: "",
    lines: "",
    paragraphs: "",
    slides: "",
    sheets: [],
    images: 0,
    totalTime: "",
    contentStatus: "",
    ooxmlType: "",
  };
  const core = readZipText(buffer, zip, "docProps/core.xml");
  if (core) {
    out.title = xmlTag(core, "title");
    out.subject = xmlTag(core, "subject");
    out.author = xmlTag(core, "creator");
    out.lastAuthor = xmlTag(core, "lastModifiedBy");
    out.keywords = xmlTag(core, "keywords");
    out.description = xmlTag(core, "description");
    out.category = xmlTag(core, "category");
    out.created = xmlTag(core, "created");
    out.modified = xmlTag(core, "modified");
    out.revision = xmlTag(core, "revision");
    out.contentStatus = xmlTag(core, "contentStatus");
    out.docLanguage = xmlTag(core, "language");
    out.lastPrinted = xmlTag(core, "lastPrinted");
  }
  const app = readZipText(buffer, zip, "docProps/app.xml");
  if (app) {
    out.app = xmlTag(app, "Application");
    out.appVersion = xmlTag(app, "AppVersion");
    out.company = xmlTag(app, "Company");
    out.pages = xmlTag(app, "Pages");
    out.words = xmlTag(app, "Words");
    out.chars = xmlTag(app, "Characters");
    out.charsWithSpaces = xmlTag(app, "CharactersWithSpaces");
    out.lines = xmlTag(app, "Lines");
    out.paragraphs = xmlTag(app, "Paragraphs");
    out.slides = xmlTag(app, "Slides");
    out.notes = xmlTag(app, "Notes");
    out.hiddenSlides = xmlTag(app, "HiddenSlides");
    out.totalTime = xmlTag(app, "TotalTime");
    out.template = xmlTag(app, "Template");
    out.presentationFormat = xmlTag(app, "PresentationFormat");
    out.manager = xmlTag(app, "Manager");
    const titles = xmlTag(app, "TitlesOfParts");
    if (titles)
      out.sheets = titles
        .split(/[\r\n]+/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 40);
  }
  const custom = readZipText(buffer, zip, "docProps/custom.xml");
  if (custom) {
    const names = [...custom.matchAll(/<property\b[^>]*name="([^"]*)"/g)].map(
      (m) => decodeXmlEntities(m[1]),
    );
    if (names.length) out.customProperties = names.slice(0, 30).join(", ");
  }
  const ct = readZipText(buffer, zip, "[Content_Types].xml");
  if (ct) {
    const oo = /openxmlformats-officedocument\.([\w.\-]+?)\+xml/.exec(ct);
    if (oo) out.ooxmlType = oo[1];
    else if (/opendocument/.test(ct)) out.ooxmlType = "OpenDocument";
    else if (/application\/epub\+zip/.test(ct)) out.ooxmlType = "EPUB";
  }
  out.images = zip.entries.filter((e) =>
    /\.(png|jpe?g|gif|bmp|tiff?|emf|wmf|svg)$/i.test(e.name),
  ).length;
  out.mediaFiles = zip.entries.filter((e) =>
    /^(word|ppt|xl)\/media\//.test(e.name),
  ).length;
  if (out.ooxmlType === "EPUB") {
    const opf = zip.entries.find((e) => /\.opf$/i.test(e.name));
    if (opf) {
      const opfXml = safeDecode(
        zipEntryData(buffer, opf) || new Uint8Array(0),
        3,
      );
      out.title = xmlTag(opfXml, "title") || out.title;
      out.author = xmlAll(opfXml, "creator").join(", ") || out.author;
      out.epubUid = xmlTag(opfXml, "identifier");
      out.language = xmlTag(opfXml, "language") || out.docLanguage;
      out.publisher = xmlTag(opfXml, "publisher");
      out.epubDate = xmlTag(opfXml, "date");
      out.opfVersion = xmlAttr(opfXml, "package", "version");
      out.items = (opfXml.match(/<item\b/g) || []).length;
    }
  }
  if (subtype === "xlsx") {
    const wb = readZipText(buffer, zip, "xl/workbook.xml");
    if (wb) {
      const names = [...wb.matchAll(/<sheet\b[^>]*name="([^"]*)"/g)].map((m) =>
        decodeXmlEntities(m[1]),
      );
      if (names.length) out.sheets = names;
    }
    const shared = readZipText(buffer, zip, "xl/sharedStrings.xml");
    if (shared) out.sharedStrings = (shared.match(/<si>/g) || []).length;
  }
  if (subtype === "pptx") {
    const pres = readZipText(buffer, zip, "ppt/presentation.xml");
    if (pres && (!out.slides || out.slides === "0"))
      out.slides = String((pres.match(/<p:sldId\b/g) || []).length);
  }
  if (subtype === "docx") {
    const doc = readZipText(buffer, zip, "word/document.xml");
    if (doc) {
      const textOnly = doc
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      out.characters = String(textOnly.length);
      out.wordCount = String(textOnly.split(" ").filter(Boolean).length);
    }
  }
  if (out.created) {
    const d = new Date(out.created);
    if (!isNaN(d) && d.getFullYear() > 1900) state.mediaDate = d;
  }
  return out;
}

/* ------------------------- OLE / CFB implementation ---------------------- */
function oleFiletimeToDate(lo, hi) {
  if (!hi && !lo) return null;
  const v = hi * 4294967296 + lo;
  const ms = v / 10000 - 11644473600000;
  const d = new Date(ms);
  return isNaN(d) || d.getFullYear() < 1900 || d.getFullYear() > 2300
    ? null
    : d;
}
function olePropertySet(data, labels) {
  const res = {};
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 48) return res;
  const numSections = dv.getUint16(30, true);
  for (let s = 0; s < Math.min(numSections, 4); s++) {
    const secOff = dv.getUint32(48 + s * 8, true);
    if (secOff + 8 > data.length) continue;
    const count = dv.getUint32(secOff + 4, true);
    for (let i = 0; i < Math.min(count, 40); i++) {
      const id = dv.getUint32(secOff + 8 + i * 8, true);
      const off = secOff + dv.getUint32(secOff + 12 + i * 8, true);
      if (off + 4 > data.length) continue;
      const type = dv.getUint16(off, true);
      const label = labels[id] || "Property #" + id;
      try {
        if (type === 2) res[label] = String(dv.getInt16(off + 4, true));
        else if (type === 3 || type === 19)
          res[label] = String(dv.getInt32(off + 4, true));
        else if (type === 4) res[label] = String(dv.getFloat32(off + 4, true));
        else if (type === 5) res[label] = String(dv.getFloat64(off + 4, true));
        else if (type === 7 || type === 64) {
          const d = oleFiletimeToDate(
            dv.getUint32(off + 4, true),
            dv.getUint32(off + 8, true),
          );
          if (d) res[label] = formatDate(+d);
        } else if (type === 30 || type === 31) {
          const len = dv.getUint32(off + 4, true);
          if (len > 0 && off + 8 + len <= data.length + 2) {
            const str = safeDecode(
              data.subarray(off + 8, off + 8 + Math.min(len, 4096)),
              1,
            )
              .replace(/\0+$/g, "")
              .trim();
            if (str) res[label] = str;
          }
        } else if (type === 11)
          res[label] = dv.getUint8(off + 4) ? "Yes" : "No";
      } catch (e) {
        /* skip malformed property */
      }
    }
  }
  return res;
}

function parseOle(buffer) {
  const out = {
    format: "OLE2 Compound File",
    streams: [],
    summary: {},
    docSummary: {},
    version: "",
    sectorSize: 0,
    streamCount: 0,
    ole: true,
  };
  if (!buffer || buffer.byteLength < 512) {
    out.error = "File too small";
    return out;
  }
  const dv = new DataView(buffer);
  const view = new Uint8Array(buffer);
  if (
    !(
      view[0] === 0xd0 &&
      view[1] === 0xcf &&
      view[2] === 0x11 &&
      view[3] === 0xe0 &&
      view[4] === 0xa1 &&
      view[5] === 0xb1
    )
  ) {
    out.error = "Not an OLE2 compound file";
    out.ole = false;
    return out;
  }
  const sectorSize = 1 << dv.getUint16(30, true);
  const miniSize = 1 << dv.getUint16(32, true);
  const firstDirSector = dv.getUint32(48, true);
  const miniStreamCutoff = dv.getUint32(56, true);
  const firstMiniFatSector = dv.getUint32(60, true);
  const numDifatSectors = dv.getUint32(72, true);
  out.sectorSize = sectorSize;
  out.version =
    dv.getUint16(26, true) === 4
      ? "Version 4 (4096-byte sectors)"
      : "Version 3 (512-byte sectors)";
  if (sectorSize < 512 || sectorSize > 65536) {
    out.error = "Unsupported sector size";
    return out;
  }
  const readSector = (s) => {
    const o = 512 + s * sectorSize;
    return s >= 0 && o + sectorSize <= view.length
      ? view.subarray(o, o + sectorSize)
      : null;
  };
  const fat = [];
  for (let i = 0; i < 109; i++) {
    const s = dv.getUint32(76 + i * 4, true);
    if (s >= 0xfffffffa) break;
    fat.push(s);
  }
  let difat = dv.getUint32(68, true);
  for (let i = 0; i < numDifatSectors && difat < 0xfffffffa && i < 2048; i++) {
    const sec = readSector(difat);
    if (!sec) break;
    const sdv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    for (let j = 0; j < sectorSize / 4 - 1; j++) {
      const s = sdv.getUint32(j * 4, true);
      if (s < 0xfffffffa) fat.push(s);
    }
    difat = sdv.getUint32(sectorSize - 4, true);
  }
  const fatEntries = [];
  for (const fsec of fat.slice(0, 4000)) {
    const sec = readSector(fsec);
    if (!sec) break;
    const sdv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    for (let j = 0; j < sectorSize / 4; j++)
      fatEntries.push(sdv.getUint32(j * 4, true));
  }
  /*_OLE_CHAIN_*/
  const chainOf = (start) => {
    const chain = [];
    let s = start,
      guard = 0;
    while (s < 0xfffffffa && guard++ < 100000) {
      chain.push(s);
      const nxt = fatEntries[s];
      if (nxt === undefined) break;
      s = nxt;
    }
    return chain;
  };
  const readChain = (start, size) => {
    const parts = [];
    let remaining = size > 0 ? size : Infinity;
    for (const s of chainOf(start)) {
      const sec = readSector(s);
      if (!sec) break;
      const take = Math.min(remaining, sec.length);
      parts.push(sec.subarray(0, take));
      remaining -= take;
      if (remaining <= 0) break;
    }
    return concatBytes(parts.filter(Boolean));
  };
  const dirData = readChain(firstDirSector, 0);
  if (dirData.length < 128) return out;
  const ddir = new DataView(
    dirData.buffer,
    dirData.byteOffset,
    dirData.byteLength,
  );
  const entries = [];
  for (let o = 0; o + 128 <= dirData.length; o += 128) {
    const nameLen = ddir.getUint16(o + 64, true);
    if (nameLen < 2 || nameLen > 64) {
      entries.push(null);
      continue;
    }
    const name = safeDecode(dirData.subarray(o, o + nameLen - 2), 1).replace(
      /\0/g,
      "",
    );
    const type = ddir.getUint8(o + 66);
    const startSector = ddir.getUint32(o + 116, true);
    const size =
      ddir.getUint32(o + 120, true) +
      ddir.getUint32(o + 124, true) * 4294967296;
    if (!name) {
      entries.push(null);
      continue;
    }
    entries.push({ name, type, startSector, size });
    if (type === 2) out.streams.push({ name, size });
  }
  out.streamCount = out.streams.length;
  out.rootEntryName = (entries.find((e) => e && e.type === 5) || {}).name || "";
  const root = entries.find((e) => e && e.type === 5);
  const miniData =
    root && root.size > 0 ? readChain(root.startSector, root.size) : null;
  const miniFat = [];
  for (const s of chainOf(firstMiniFatSector).slice(0, 1000)) {
    const sec = readSector(s);
    if (!sec) break;
    const sdv = new DataView(sec.buffer, sec.byteOffset, sec.byteLength);
    for (let j = 0; j < sectorSize / 4; j++)
      miniFat.push(sdv.getUint32(j * 4, true));
  }
  const readMiniChain = (start, size) => {
    if (!miniData || !miniData.length) return new Uint8Array(0);
    const parts = [];
    let s = start,
      guard = 0,
      remaining = size;
    while (s < 0xfffffffa && guard++ < 100000) {
      const off = s * miniSize;
      if (off + miniSize > miniData.length) break;
      const take = Math.min(remaining, miniSize);
      parts.push(miniData.subarray(off, off + take));
      remaining -= take;
      const nxt = miniFat[s];
      if (remaining <= 0 || nxt === undefined) break;
      s = nxt;
    }
    return concatBytes(parts);
  };
  const streamData = (name) => {
    const e = entries.find((x) => x && x.name === name && x.type === 2);
    if (!e || e.size === 0) return null;
    return e.size < miniStreamCutoff
      ? readMiniChain(e.startSector, e.size)
      : readChain(e.startSector, e.size);
  };
  try {
    const si = streamData("\u0005SummaryInformation");
    if (si && si.length > 48) out.summary = olePropertySet(si, OLE_PROP_LABELS);
    const ds = streamData("\u0005DocumentSummaryInformation");
    if (ds && ds.length > 48)
      out.docSummary = olePropertySet(ds, OLE_DOC_LABELS);
  } catch (e) {
    out.summaryError = String((e && e.message) || e);
  }
  const createTime = out.summary["Create Time"];
  if (createTime) {
    const d = new Date(createTime);
    if (!isNaN(d)) state.mediaDate = d;
  }
  return out;
}

/* --------------------- GZIP / TAR / RAR / 7z / ISO ----------------------- */
function parseGzip(buffer) {
  const out = {
    format: "GZIP",
    originalName: "",
    originalSize: null,
    compressedSize: buffer ? buffer.byteLength : 0,
    mtime: null,
    os: "",
    comment: "",
    ratio: null,
  };
  if (!buffer || buffer.byteLength < 18) {
    out.error = "File too small";
    return out;
  }
  const view = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  if (view[0] !== 0x1f || view[1] !== 0x8b) {
    out.error = "Not a GZIP stream";
    return out;
  }
  const flg = view[3];
  out.compressionMethod = view[2] === 8 ? "Deflate" : "method " + view[2];
  out.mtime = dv.getUint32(4, true)
    ? new Date(dv.getUint32(4, true) * 1000)
    : null;
  out.os =
    [
      "FAT filesystem",
      "Amiga",
      "VMS",
      "Unix",
      "VM/CMS",
      "Atari",
      "HPFS",
      "Macintosh",
      "Z-System",
      "CP/M",
      "TOPS-20",
      "NTFS",
      "QDOS",
      "Acorn RISC OS",
      "unknown",
    ][view[9]] || "code " + view[9];
  out.xfl = view[8];
  let p = 10;
  try {
    if (flg & 0x04) {
      const xlen = dv.getUint16(p, true);
      out.extraField = xlen + " bytes";
      p += 2 + xlen;
    }
    if (flg & 0x08) {
      let e = p;
      while (e < view.length && view[e] !== 0) e++;
      out.originalName = LATIN1.decode(view.subarray(p, e));
      p = e + 1;
    }
    if (flg & 0x10) {
      let e = p;
      while (e < view.length && view[e] !== 0) e++;
      out.comment = LATIN1.decode(view.subarray(p, e));
      p = e + 1;
    }
    if (flg & 0x02) out.headerCrc = "0x" + dv.getUint16(p, true).toString(16);
  } catch (e) {
    /* truncated header */
  }
  if (view.length >= 4) {
    out.originalSize = dv.getUint32(view.length - 4, true);
    out.crc32 = dv.getUint32(view.length - 8, true);
    if (out.originalSize > 0)
      out.ratio =
        Math.round((1 - out.compressedSize / out.originalSize) * 1000) / 10 +
        "%";
  }
  if (out.mtime) state.mediaDate = out.mtime;
  return out;
}

function parseTar(buffer) {
  const out = {
    format: "TAR",
    entries: [],
    entryCount: 0,
    totalSize: 0,
    version: "",
    paxHeaders: 0,
  };
  if (!buffer || buffer.byteLength < 512) {
    out.error = "File too small";
    return out;
  }
  const view = new Uint8Array(buffer);
  const n = view.length;
  if (ascii(view, 257, 5) !== "ustar") {
    out.error = "ustar magic missing (may be a bare V7 tar)";
    return out;
  }
  out.version = ascii(view, 263, 2).replace(/\0.*$/s, "").trim() || "posix";
  if (ascii(view, 257, 8).startsWith("ustar  ")) out.version = "GNU";
  let p = 0,
    guard = 0;
  while (p + 512 <= n && guard++ < 6000) {
    const name = ascii(view, p, 100).replace(/\0.*$/s, "");
    if (!name) break;
    const prefix = ascii(view, p + 345, 155).replace(/\0.*$/s, "");
    const size = octalOf(view, p + 124, 12);
    const mtime = octalOf(view, p + 136, 12);
    const typeFlag = String.fromCharCode(byteAt(view, p + 156) || 0x30);
    const mode = octalOf(view, p + 100, 8).toString(8);
    const uname = ascii(view, p + 265, 32).replace(/\0.*$/s, "");
    const linkName = ascii(view, p + 157, 100).replace(/\0.*$/s, "");
    const full = prefix ? prefix + "/" + name : name;
    if (typeFlag === "x" || typeFlag === "g") out.paxHeaders++;
    out.entries.push({
      name: full,
      size,
      mode,
      mtime: mtime ? new Date(mtime * 1000) : null,
      type: typeFlag,
      uname,
      linkName,
    });
    out.totalSize += size;
    p += 512 + Math.ceil(size / 512) * 512;
  }
  out.entryCount = out.entries.length;
  const files = out.entries.filter(
    (e) => e.type === "0" || e.type === "\u0000",
  );
  out.fileCount = files.length;
  out.dirCount = out.entries.filter((e) => e.type === "5").length;
  if (out.entries.length) {
    const dates = out.entries
      .map((e) => e.mtime)
      .filter(Boolean)
      .sort((a, b) => a - b);
    if (dates.length) {
      out.oldestEntry = formatDate(+dates[0]);
      out.newestEntry = formatDate(+dates[dates.length - 1]);
    }
  }
  return out;
}

function parseRar(buffer) {
  const out = {
    format: "RAR",
    version: "",
    isRar5: false,
    entries: [],
    count: 0,
    encrypted: false,
    totalUnpacked: 0,
    solid: false,
  };
  if (!buffer || buffer.byteLength < 14) {
    out.error = "File too small";
    return out;
  }
  const view = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const n = view.length;
  if (
    !(
      view[0] === 0x52 &&
      view[1] === 0x61 &&
      view[2] === 0x72 &&
      view[3] === 0x21 &&
      view[4] === 0x1a &&
      view[5] === 0x07
    )
  ) {
    out.error = "Not a RAR archive";
    return out;
  }
  if (view[6] === 0x01 && view[7] === 0x00) {
    // RAR 5
    out.isRar5 = true;
    out.version = "RAR 5.0";
    const readVint = (o) => {
      let v = 0,
        shift = 0,
        q = o;
      while (q < n && shift < 56) {
        const b = view[q++];
        v += (b & 0x7f) * Math.pow(2, shift);
        if (!(b & 0x80)) break;
        shift += 7;
      }
      return { value: v, len: q - o };
    };
    let p = 8,
      guard = 0;
    while (p + 7 <= n && guard++ < 4000) {
      const crc = u32le(view, p);
      const hs = readVint(p + 4); // header size vint
      const ht = readVint(p + 4 + hs.len); // header type vint
      const hf = readVint(p + 4 + hs.len + ht.len); // header flags vint
      const body = p + 4 + hs.len + ht.len + hf.len;
      if (hs.value < 3 || p + 4 + hs.len + hs.value > n) break;
      if (ht.value === 1) {
        // main archive header
        const ma = readVint(body);
        if (body + ma.len + 2 <= p + 4 + hs.len + hs.value)
          out.solid = !!(view[body + ma.len] & 0x01);
      } else if (ht.value === 2) {
        // file header
        const bodyEnd = p + 4 + hs.len + hs.value;
        let q = body;
        if (hf.value & 0x0001) {
          const ea = readVint(q);
          q += ea.len + ea.value;
        } // skip extra area
        const f0 = readVint(q);
        q += f0.len; // file flags
        const f1 = readVint(q);
        q += f1.len; // unpacked size
        const f2 = readVint(q);
        q += f2.len; // attributes
        if (hf.value & 0x0002) q += 4; // mtime (file time)
        if (hf.value & 0x0004) q += 4; // data CRC32
        if (hf.value & 0x0008) {
          const ci = readVint(q);
          q += ci.len;
        } // compression info
        q += readVint(q).len; // host OS vint
        const nameLenV = readVint(q);
        const nameStart = q + nameLenV.len;
        const nameLen = Math.min(
          nameLenV.value,
          Math.max(0, bodyEnd - nameStart),
        );
        const name =
          nameLen > 0
            ? safeDecode(view.subarray(nameStart, nameStart + nameLen), 3)
            : "";
        const isDir = !!(f0.value & 0x0001);
        if (name)
          out.entries.push({
            name,
            size: f1.value,
            isDirectory: isDir,
            encrypted: !!(f0.value & 0x0004),
          });
        if (f0.value & 0x0004) out.encrypted = true;
        if (!isDir) out.totalUnpacked += f1.value;
      } else if (ht.value === 5) break; // end of archive
      p = p + 4 + hs.len + hs.value;
    }
  } else {
    // RAR 4
    out.version = "RAR 4.x";
    let p = 7,
      guard = 0;
    while (p + 7 <= n && guard++ < 6000) {
      const type = view[p + 2];
      const flags = u16le(view, p + 3);
      let size = u16le(view, p + 5);
      if (flags & 0x8000) size += u32le(view, p + 7) * 65536;
      const body = p + 7;
      if (type === 0x73) {
        if (flags & 0x0080) out.encrypted = true;
        if (flags & 0x0008) out.solid = true;
      } else if (type === 0x74 && body + 32 <= n) {
        let q = body;
        const packSize = u32le(view, q);
        q += 4;
        const unpSize = u32le(view, q);
        q += 4;
        q += 8;
        const ftime = u32le(view, q);
        q += 4;
        q += 2;
        const nameLen = u16le(view, q);
        q += 2;
        q += 4;
        if (flags & 0x0100) q += 4;
        const name = nameLen
          ? safeDecode(
              view.subarray(q, Math.min(q + nameLen, n)),
              flags & 0x0200 ? 3 : 1,
            )
          : "";
        const isDir = !!(u32le(view, body + 28) & 0x10);
        if (name)
          out.entries.push({
            name,
            size: unpSize,
            packedSize: packSize,
            isDirectory: isDir,
            date: ftime
              ? dosDateTime((ftime >> 16) & 0xffff, ftime & 0xffff)
              : null,
            encrypted: !!(flags & 0x0004),
          });
        if (flags & 0x0004) out.encrypted = true;
        if (!isDir) out.totalUnpacked += unpSize;
      }
      if (size <= 0) break;
      p = body + size;
    }
  }
  out.count = out.entries.filter((e) => !e.isDirectory).length;
  return out;
}

function parseSevenZip(buffer) {
  const out = {
    format: "7-Zip",
    signatureVersion: "",
    entries: [],
    count: 0,
    encrypted: false,
    nextHeaderSize: 0,
  };
  if (!buffer || buffer.byteLength < 32) {
    out.error = "File too small";
    return out;
  }
  const view = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  if (
    !(
      view[0] === 0x37 &&
      view[1] === 0x7a &&
      view[2] === 0xbc &&
      view[3] === 0xaf &&
      view[4] === 0x27 &&
      view[5] === 0x1c
    )
  ) {
    out.error = "Not a 7z archive";
    return out;
  }
  out.signatureVersion = view[6] + "." + view[7];
  out.nextHeaderOffset = Number(u64le(dv, 12));
  out.nextHeaderSize = Number(u64le(dv, 20));
  out.nextHeaderCrc = "0x" + dv.getUint32(28, true).toString(16);
  const start = 32 + out.nextHeaderOffset;
  if (
    start > 0 &&
    start + out.nextHeaderSize <= view.length &&
    out.nextHeaderSize > 0 &&
    out.nextHeaderSize < 1 << 22
  ) {
    const region = view.subarray(start, start + out.nextHeaderSize);
    const names = [];
    for (let i = 0; i + 4 < region.length && names.length < 500; i++) {
      if (
        region[i] === 0x11 &&
        region[i + 1] === 0 &&
        region[i + 2] === 0 &&
        region[i + 3] === 0
      ) {
        const len = u16le(region, i + 4);
        if (len > 0 && len < 512 && i + 6 + len * 2 <= region.length) {
          const sName = safeDecode(region.subarray(i + 6, i + 6 + len * 2), 1);
          if (sName && !/[\x00-\x08\x0e-\x1f]/.test(sName)) {
            names.push(sName.replace(/\\/g, "/"));
            i += 6 + len * 2 - 1;
          }
        }
      }
    }
    out.entries = names.map((nm) => ({
      name: nm,
      isDirectory: nm.endsWith("/"),
    }));
    out.count = out.entries.filter((e) => !e.isDirectory).length;
  }
  return out;
}

function parseIso(buffer) {
  const out = {
    format: "ISO 9660",
    volumeLabel: "",
    systemId: "",
    volumeSize: null,
    blockSize: null,
    blockCount: null,
    created: null,
    modified: null,
    publisher: "",
    preparer: "",
    application: "",
    udf: false,
    bootable: false,
    joliet: false,
  };
  if (!buffer || buffer.byteLength < 32768 + 2048) {
    out.error = "File too small for ISO image";
    return out;
  }
  const dv = new DataView(buffer);
  const view = new Uint8Array(buffer);
  const s = 32768;
  if (!(view[s] === 0x01 && ascii(view, s + 1, 5) === "CD001")) {
    out.error = "ISO9660 primary volume descriptor not found";
    return out;
  }
  out.systemId = ascii(view, s + 8, 32)
    .replace(/\0.*$/s, "")
    .trim();
  out.volumeLabel = ascii(view, s + 40, 32)
    .replace(/\0.*$/s, "")
    .trim();
  out.blockSize = dv.getUint16(s + 128, true);
  out.blockCount = dv.getUint32(s + 80, true);
  out.volumeSize = (out.blockSize || 2048) * (out.blockCount || 0);
  const isoDate = (o) => {
    const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/.exec(
      ascii(view, o, 17),
    );
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
    return isNaN(d) || d.getFullYear() < 1900 || d.getFullYear() > 2300
      ? null
      : d;
  };
  out.created = isoDate(s + 813);
  out.modified = isoDate(s + 830);
  out.publisher = ascii(view, s + 318, 128)
    .replace(/\0.*$/s, "")
    .trim();
  out.preparer = ascii(view, s + 446, 128)
    .replace(/\0.*$/s, "")
    .trim();
  out.application = ascii(view, s + 574, 128)
    .replace(/\0.*$/s, "")
    .trim();
  for (let v = 1; v < 32; v++) {
    const off = 32768 + v * 2048;
    if (off + 8 > view.length) break;
    const type = view[off];
    if (ascii(view, off + 1, 5) !== "CD001") break;
    if (type === 0) out.bootable = true;
    if (type === 2) out.joliet = true;
    if (type === 255) break;
  }
  if (
    indexOfBytes(
      view.subarray(32768, Math.min(view.length, 36864)),
      bytesOf("BEA01"),
      0,
    ) >= 0
  )
    out.udf = true;
  if (out.created) state.mediaDate = out.created;
  return out;
}

/* --------------------- Fonts / executables / binary --------------------- */
function parseFont(buffer, ext) {
  const out = {
    format: (ext || "font").toUpperCase(),
    names: {},
    tables: [],
    glyphCount: null,
    unitsPerEm: null,
    isVariable: false,
  };
  if (!buffer || buffer.byteLength < 12) {
    out.error = "File too small";
    return out;
  }
  const view = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  const tag = ascii(view, 0, 4);
  if (tag === "OTTO") out.format = "OTF (CFF outlines)";
  else if (tag === "true" || (view[0] === 0x00 && view[1] === 0x01))
    out.format = "TTF (TrueType)";
  else if (tag === "wOFF") {
    out.format = "WOFF";
    out.woffFlavor = ascii(view, 4, 4).trim() || "unknown";
    out.tableCount = dv.getUint16(12, false);
    out.compressed = dv.getUint32(40, false) === 0 ? "no" : "yes";
    return out;
  } else if (tag === "wOF2") {
    out.format = "WOFF2";
    out.woffFlavor = ascii(view, 4, 4).trim() || "unknown";
    out.compressed = "yes (brotli)";
    return out;
  } else if (view[0] !== 0x00) {
    out.error = "Unknown font container";
    return out;
  }
  const numTables = dv.getUint16(4, false);
  out.tableCount = numTables;
  let nameOff = 0,
    headOff = 0,
    maxpOff = 0,
    fvarOff = 0;
  for (let i = 0; i < numTables && 12 + i * 16 + 16 <= view.length; i++) {
    const t = 12 + i * 16;
    const tTag = ascii(view, t, 4);
    const tOff = dv.getUint32(t + 8, false);
    out.tables.push(tTag);
    if (tTag === "name") nameOff = tOff;
    else if (tTag === "head") headOff = tOff;
    else if (tTag === "maxp") maxpOff = tOff;
    else if (tTag === "fvar") fvarOff = tOff;
  }
  if (headOff + 20 <= view.length)
    out.unitsPerEm = dv.getUint16(headOff + 18, false);
  if (maxpOff + 6 <= view.length)
    out.glyphCount = dv.getUint16(maxpOff + 4, false);
  if (fvarOff) out.isVariable = true;
  if (nameOff + 6 <= view.length) {
    const count = dv.getUint16(nameOff + 2, false);
    const strOff = nameOff + dv.getUint16(nameOff + 4, false);
    const wanted = {
      1: "Font Family",
      2: "Font Subfamily",
      4: "Full Name",
      5: "Version",
      6: "PostScript Name",
      7: "Trademark",
      8: "Manufacturer",
      9: "Designer",
      10: "Description",
      11: "Vendor URL",
      12: "Designer URL",
      13: "License",
      14: "License URL",
      16: "Preferred Family",
      17: "Preferred Subfamily",
    };
    for (let i = 0; i < Math.min(count, 60); i++) {
      const r = nameOff + 6 + i * 12;
      if (r + 12 > view.length) break;
      const platform = dv.getUint16(r, false);
      const nameId = dv.getUint16(r + 6, false);
      const length = dv.getUint16(r + 8, false);
      const offset = dv.getUint16(r + 10, false);
      const label = wanted[nameId];
      if (!label || out.names[label]) continue;
      const start = strOff + offset;
      if (start + length > view.length || length === 0) continue;
      const chunk = view.subarray(start, start + length);
      const val =
        platform === 0 || platform === 3
          ? safeDecode(chunk, 1)
          : safeDecode(chunk, 0);
      if (val && val.trim()) out.names[label] = val.trim();
    }
  }
  return out;
}

function parseElfPe(buffer) {
  const out = {
    format: "",
    machine: "",
    bits: null,
    endian: "",
    entryPoint: null,
    created: null,
    sections: [],
    sectionCount: 0,
    subsystem: "",
    type: "",
  };
  if (!buffer || buffer.byteLength < 64) {
    out.error = "File too small";
    return out;
  }
  const view = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  if (view[0] === 0x7f && ascii(view, 1, 3) === "ELF") {
    out.format = "ELF (Unix/Linux executable)";
    const is64 = view[4] === 2;
    out.bits = is64 ? 64 : 32;
    const le = view[5] === 1;
    out.endian = le ? "Little endian" : "Big endian";
    out.type =
      {
        1: "Relocatable",
        2: "Executable",
        3: "Shared library / DLL",
        4: "Core dump",
      }[dv.getUint16(16, le)] || "type " + dv.getUint16(16, le);
    const machines = {
      2: "SPARC",
      3: "x86",
      8: "MIPS",
      20: "PowerPC",
      21: "PowerPC64",
      40: "ARM",
      42: "SuperH",
      50: "IA-64",
      62: "x86-64",
      183: "AArch64",
      243: "RISC-V",
    };
    out.machine =
      machines[dv.getUint16(18, le)] || "machine " + dv.getUint16(18, le);
    out.entryPoint =
      "0x" +
      (is64
        ? Number(u64le(dv, 24)).toString(16)
        : dv.getUint32(24, le).toString(16));
    const shoff = is64 ? Number(u64le(dv, 40)) : dv.getUint32(32, le);
    const shentsize = dv.getUint16(58, le);
    const shnum = dv.getUint16(60, le);
    out.sectionCount = shnum;
    if (shoff && shentsize && shoff + shnum * shentsize <= view.length) {
      const shstrIdx = dv.getUint16(is64 ? 62 : 50, le);
      let strOff = 0,
        strLen = 0;
      if (shstrIdx && shstrIdx < shnum) {
        const st = shoff + shstrIdx * shentsize;
        strOff = is64 ? Number(u64le(dv, st + 24)) : dv.getUint32(st + 16, le);
        strLen = is64 ? Number(u64le(dv, st + 32)) : dv.getUint32(st + 20, le);
      }
      for (let i = 0; i < Math.min(shnum, 64); i++) {
        const so = shoff + i * shentsize;
        const sType = dv.getUint32(so + 4, le);
        const sec = {
          index: i,
          type: sType,
          size: is64 ? Number(u64le(dv, so + 32)) : dv.getUint32(so + 20, le),
        };
        if (
          strOff &&
          strLen &&
          (is64 ? Number(u64le(dv, so)) : dv.getUint32(so, le)) < strLen
        ) {
          sec.name = ascii(
            view,
            strOff + (is64 ? Number(u64le(dv, so)) : dv.getUint32(so, le)),
            32,
          ).replace(/\0.*$/s, "");
        }
        out.sections.push(sec);
      }
    }
    return out;
  }
  if (view[0] === 0x4d && view[1] === 0x5a) {
    out.format = "PE / Windows executable";
    const peOff = dv.getUint32(0x3c, true);
    if (
      peOff + 24 > view.length ||
      ascii(view, peOff, 4) !== "PE\u0000\u0000"
    ) {
      out.error = "PE signature missing (DOS-only stub)";
      return out;
    }
    const coff = peOff + 4;
    const machine = dv.getUint16(coff, true);
    const machines = {
      0x014c: "x86 (i386)",
      0x8664: "x86-64 (amd64)",
      0x01c0: "ARM",
      0xaa64: "AArch64",
      0x0200: "IA-64",
    };
    out.machine = machines[machine] || "machine 0x" + machine.toString(16);
    const numSections = dv.getUint16(coff + 2, true);
    out.sectionCount = numSections;
    const ts = dv.getUint32(coff + 8, true);
    if (ts > 0) {
      const d = new Date(ts * 1000);
      if (!isNaN(d)) {
        out.created = d;
        state.mediaDate = d;
      }
    }
    const optSize = dv.getUint16(coff + 16, true);
    const magic = dv.getUint16(coff + 20, true);
    out.bits = magic === 0x20b ? 64 : 32;
    const optBase = coff + 20;
    const subOff = magic === 0x20b ? 68 : 68;
    const subsystemId =
      optBase + subOff + 2 <= view.length
        ? dv.getUint16(optBase + subOff, true)
        : 0;
    out.subsystem =
      {
        1: "Native",
        2: "Windows GUI",
        3: "Windows console",
        5: "OS/2 console",
        7: "POSIX",
        9: "Windows CE",
        10: "EFI application",
        12: "EFI driver",
        14: "EFI ROM",
        16: "Windows boot application",
      }[subsystemId] || "subsystem " + subsystemId;
    out.type = "Executable / DLL";
    const secStart = coff + 20 + optSize;
    for (let i = 0; i < Math.min(numSections, 48); i++) {
      const so = secStart + i * 40;
      if (so + 40 > view.length) break;
      out.sections.push({
        name: ascii(view, so, 8).replace(/\0.*$/s, ""),
        size: dv.getUint32(so + 8, true),
      });
    }
    return out;
  }
  out.error = "Neither ELF nor PE";
  return out;
}

function parseWasm(buffer) {
  const out = {
    format: "WebAssembly",
    version: null,
    sections: [],
    memoryPages: null,
    customNames: [],
  };
  if (!buffer || buffer.byteLength < 8) {
    out.error = "File too small";
    return out;
  }
  const view = new Uint8Array(buffer);
  const dv = new DataView(buffer);
  if (ascii(view, 0, 4) !== "\u0000asm") {
    out.error = "Not a WebAssembly module";
    return out;
  }
  out.version = dv.getUint32(4, true);
  let p = 8;
  const secNames = {
    0: "Custom",
    1: "Type",
    2: "Import",
    3: "Function",
    4: "Table",
    5: "Memory",
    6: "Global",
    7: "Export",
    8: "Start",
    9: "Element",
    10: "Code",
    11: "Data",
    12: "DataCount",
  };
  let guard = 0;
  while (p + 2 <= view.length && guard++ < 1000) {
    const id = view[p];
    let size = 0,
      shift = 0,
      q = p + 1;
    while (q < view.length) {
      const b = view[q];
      size |= (b & 0x7f) << shift;
      q++;
      if (!(b & 0x80)) break;
      shift += 7;
    }
    out.sections.push({ id, name: secNames[id] || "id " + id, size });
    if (id === 5 && q + 1 < view.length) out.memoryPages = 1 << view[q];
    if (id === 0 && size > 6 && q + size <= view.length) {
      const sec = view.subarray(q, q + size);
      const nm = ascii(sec, 1, Math.min(64, size - 1)).split("\0")[0];
      if (nm && /^[A-Za-z0-9_.\- ]+$/.test(nm)) out.customNames.push(nm);
    }
    p = q + size;
    if (size <= 0) break;
  }
  return out;
}

function parseClass(buffer) {
  const out = {
    format: "Java class",
    version: "",
    thisClass: "",
    superClass: "",
    constantPoolCount: 0,
    interfaces: 0,
    fields: 0,
    methods: 0,
    accessFlags: "",
  };
  if (!buffer || buffer.byteLength < 16) {
    out.error = "File too small";
    return out;
  }
  const dv = new DataView(buffer);
  if (dv.getUint32(0, false) !== 0xcafebabe) {
    out.error = "Not a Java class file";
    return out;
  }
  const minor = dv.getUint16(4, false),
    major = dv.getUint16(6, false);
  out.version = major + "." + minor;
  out.compiledFor = major > 45 ? "Java " + (major - 44) : "Java 1.0";
  const cpCount = dv.getUint16(8, false);
  out.constantPoolCount = cpCount;
  let p = 10;
  const strings = {};
  for (let i = 1; i < cpCount && p + 3 <= dv.byteLength; i++) {
    const tag = dv.getUint8(p);
    p += 1;
    if (tag === 1) {
      const len = dv.getUint16(p, false);
      p += 2;
      if (p + len <= dv.byteLength)
        strings[i] = safeDecode(
          new Uint8Array(dv.buffer, dv.byteOffset + p, Math.min(len, 2048)),
          3,
        );
      p += len;
    } else if (tag === 5 || tag === 6) {
      p += 8;
      i++;
    } else if (tag === 7 || tag === 8 || tag === 16 || tag === 19 || tag === 20)
      p += 2;
    else if (tag === 15) p += 3;
    else p += 4;
  }
  const flags = p + 2 <= dv.byteLength ? dv.getUint16(p, false) : 0;
  p += 2;
  out.accessFlags =
    [
      flags & 0x0001 && "public",
      flags & 0x0010 && "final",
      flags & 0x0020 && "super",
      flags & 0x0200 && "interface",
      flags & 0x0400 && "abstract",
      flags & 0x1000 && "synthetic",
      flags & 0x2000 && "annotation",
      flags & 0x4000 && "enum",
    ]
      .filter(Boolean)
      .join(", ") || "-";
  const u16at = (o) => (o + 2 <= dv.byteLength ? dv.getUint16(o, false) : 0);
  const thisIdx = u16at(p);
  p += 2;
  const superIdx = u16at(p);
  p += 2;
  out.thisClass =
    (strings[thisIdx] || "").replace(/^L|;$/g, "").replace(/\//g, ".") ||
    "class #" + thisIdx;
  out.superClass =
    (strings[superIdx] || "").replace(/^L|;$/g, "").replace(/\//g, ".") || "-";
  out.interfaces = u16at(p);
  p += 2 + (out.interfaces || 0) * 2;
  if (out.interfaces > 1000) out.interfaces = 1000;
  out.fields = u16at(p);
  p += 2;
  out.methods = u16at(p);
  p += 2;
  return out;
}

/* --------------------- Handlers: tag helpers ----------------------------- */
const PRETTY_KEYS = {
  TITLE: "Title",
  ARTIST: "Artist",
  ALBUM: "Album",
  ALBUMARTIST: "Album Artist",
  DATE: "Date",
  YEAR: "Year",
  GENRE: "Genre",
  TRACKNUMBER: "Track Number",
  TRACKTOTAL: "Track Total",
  DISCNUMBER: "Disc Number",
  COMPOSER: "Composer",
  COMMENT: "Comment",
  DESCRIPTION: "Description",
  ENCODER: "Encoder",
  ENCODEDBY: "Encoded By",
  VENDOR: "Vendor",
  LYRICS: "Lyrics",
  LANGUAGE: "Language",
  PUBLISHER: "Publisher",
  COPYRIGHT: "Copyright",
  BPM: "BPM",
  ISRC: "ISRC",
  ORGANIZATION: "Organization",
  LOCATION: "Location",
  VERSION: "Version",
};
function prettyTagKey(k) {
  if (k === "vendor") return "Vendor";
  if (PRETTY_KEYS[k]) return PRETTY_KEYS[k];
  const s = String(k).replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function addTags(cat, tags, group) {
  let n = 0;
  for (const [k, v] of Object.entries(tags || {})) {
    if (v == null || v === "" || typeof v === "object") continue;
    addItem(cat, prettyTagKey(k), String(v));
    addRaw(group, prettyTagKey(k), String(v));
    n++;
  }
  return n;
}
function extractXmpCore(xmp) {
  const res = [];
  if (!xmp) return res;
  try {
    const pairs = [
      ["dc:title", "Title"],
      ["dc:creator", "Creator / Artist"],
      ["dc:description", "Description"],
      ["dc:subject", "Subject / Keywords"],
      ["photoshop:Credit", "Credit"],
      ["xmp:CreateDate", "Create Date"],
      ["xmp:ModifyDate", "Modify Date"],
      ["xmp:CreatorTool", "Creator Tool"],
      ["xmpDM:videoFrameRate", "Frame Rate"],
      ["xmpDM:audioChannelType", "Audio Channels"],
      ["tiff:Make", "Camera Make"],
      ["tiff:Model", "Camera Model"],
      ["exif:GPSLatitude", "GPS Latitude"],
      ["exif:GPSLongitude", "GPS Longitude"],
      ["xmpRights:Copyright", "Copyright"],
    ];
    for (const [tag, label] of pairs) {
      const re = new RegExp(
        "<" +
          tag.replace(/:/g, "\\:") +
          "(?:\\s[^>]*)?>([\\s\\S]*?)</" +
          tag.replace(/:/g, "\\:") +
          ">",
      );
      const m = re.exec(xmp);
      if (m) {
        const v = decodeXmlEntities(
          m[1]
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
        );
        if (v) res.push([label, v]);
      }
    }
  } catch (e) {
    /* malformed XMP */
  }
  return res;
}

async function handleVideo(file, buffer, fmt) {
  const media = makeCategory("Media Overview", "🎬");
  const details = makeCategory("Video & Audio Details", "🎞️");
  const tagsCat = makeCategory("Tags & Metadata", "🏷️");
  showMediaPreview(trackUrl(URL.createObjectURL(file)), "video");
  let parsed = null,
    parserName = "";
  try {
    if (
      buffer &&
      (fmt.subtype === "mp4" ||
        ["mp4", "mov", "m4v", "3gp", "mts", "m2ts", "ts"].includes(fmt.ext))
    ) {
      parsed = parseMp4(buffer);
      parserName = "MP4/QuickTime";
    } else if (
      buffer &&
      (fmt.subtype === "ebml" || ["mkv", "webm"].includes(fmt.ext))
    ) {
      parsed = parseEBML(buffer);
      parserName = "Matroska/WebM";
    } else if (buffer && (fmt.label === "AVI" || fmt.ext === "avi")) {
      parsed = parseAvi(buffer);
      parserName = "AVI (RIFF)";
    } else if (buffer && ["wmv", "asf"].includes(fmt.ext)) {
      parsed = parseAsf(buffer);
      parserName = "ASF/WMV";
    }
  } catch (e) {
    console.warn("Video parser warning:", e);
  }
  if (parsed && !parsed.error) {
    if (parserName) addItem(media, "Parser", parserName);
    if (parsed.creationDate) {
      const v = formatDate(+parsed.creationDate);
      addItem(media, "Created", v);
      addRaw("Timeline", "Created", v);
    }
    if (parsed.modificationDate) {
      const v = formatDate(+parsed.modificationDate);
      addItem(media, "Modified", v);
      addRaw("Timeline", "Modified", v);
    }
    if (parsed.durationS) {
      state.mediaDuration = parsed.durationS;
      setDetail("duration", formatDuration(parsed.durationS));
      showDetailRow("rowDuration");
      addItem(media, "Duration", formatDuration(parsed.durationS));
    }
    if (parsed.brand) addItem(media, "Major Brand", parsed.brand);
    if (parsed.brands && parsed.brands.length)
      addItem(media, "Compatible Brands", parsed.brands.slice(0, 8).join(", "));
    const vt = (parsed.tracks || []).find(
      (t) => t.type === "vide" || t.type === "video",
    );
    const at = (parsed.tracks || []).find(
      (t) => t.type === "soun" || t.type === "audio",
    );
    if (vt) {
      if (vt.width && vt.height) {
        state.mediaWidth = vt.width;
        state.mediaHeight = vt.height;
        setDetail("dimensions", vt.width + " × " + vt.height + " px");
        showDetailRow("rowDimensions");
        addItem(details, "Resolution", vt.width + " × " + vt.height + " px");
        addRaw("Video", "Resolution", vt.width + " × " + vt.height);
      }
      if (vt.fps) {
        addItem(details, "Frame Rate", vt.fps + " fps");
        addRaw("Video", "Frame Rate", vt.fps + " fps");
      }
      if (vt.codec) {
        addItem(details, "Video Codec", vt.codec);
        addRaw("Video", "Codec", vt.codec);
      }
    }
    if (at) {
      if (at.sampleRate) {
        addItem(details, "Audio Sample Rate", at.sampleRate + " Hz");
        addRaw("Audio", "Sample Rate", at.sampleRate + " Hz");
      }
      if (at.channels) {
        addItem(
          details,
          "Audio Channels",
          at.channels === 1
            ? "1 (mono)"
            : at.channels === 2
              ? "2 (stereo)"
              : String(at.channels),
        );
        addRaw("Audio", "Channels", String(at.channels));
      }
      if (at.codec) {
        addItem(details, "Audio Codec", at.codec);
        addRaw("Audio", "Codec", at.codec);
      }
    }
    if ((parsed.tracks || []).length > 1)
      addItem(media, "Tracks", parsed.tracks.map((t) => t.type).join(" + "));
    if (parsed.tags && Object.keys(parsed.tags).length)
      addTags(tagsCat, parsed.tags, "Container tags");
    for (const tk of [
      "GPS Location",
      "GPS Coordinates (ISO6709)",
      "Location (°)",
    ]) {
      const raw = parsed.tags && parsed.tags[tk];
      if (raw) {
        const g = parseIso6709(raw);
        if (g && g.latitude != null) {
          showGpsCard(g, "Container GPS tag");
          break;
        }
      }
    }
    if (parsed.gps && parsed.gps.latitude != null)
      showGpsCard(parsed.gps, "MP4 quicktime");
    if (parsed.xmp && parsed.xmp.length > 40) {
      for (const [label, v] of extractXmpCore(parsed.xmp)) {
        addItem(tagsCat, label, v);
        addRaw("XMP", label, v);
      }
      addBlock(tagsCat, { type: "text", text: parsed.xmp.slice(0, 4000) });
    }
  } else {
    addItem(
      media,
      "Note",
      parsed && parsed.error
        ? "Deep parse unavailable: " + parsed.error
        : "No format-specific metadata found for this container.",
    );
  }
  if (state.mediaDate) {
    const v = formatDate(+state.mediaDate);
    addItem(media, "Media Date", v);
  }
  if (!state.rawItems.length) {
    const c = makeCategory("No Metadata", "ℹ️");
    addItem(c, "Info", "No embedded metadata found in this video.");
  }
}

async function handleAudio(file, buffer, fmt) {
  const media = makeCategory("Media Overview", "🎵");
  const tagsCat = makeCategory("Tags & Metadata", "🏷️");
  const tech = makeCategory("Audio Properties", "🎛️");
  showMediaPreview(trackUrl(URL.createObjectURL(file)), "audio");
  let parsed = null,
    parserName = "";
  try {
    if (
      buffer &&
      (fmt.subtype === "mp3" ||
        fmt.subtype === "aac" ||
        ["mp3", "aac"].includes(fmt.ext))
    ) {
      parsed = parseId3(buffer);
      parserName = parsed.versions.length
        ? parsed.versions.join(" + ")
        : "MPEG audio";
    } else if (buffer && fmt.subtype === "flac") {
      parsed = parseFlac(buffer);
      parserName = "FLAC";
    } else if (buffer && fmt.subtype === "wav") {
      parsed = parseWav(buffer);
      parserName = "WAV (RIFF)";
    } else if (buffer && fmt.subtype === "ogg") {
      parsed = parseOgg(buffer);
      parserName = "Ogg";
    } else if (
      buffer &&
      (fmt.subtype === "m4a" || ["m4a", "m4b", "m4r", "m4p"].includes(fmt.ext))
    ) {
      parsed = parseMp4(buffer);
      parserName = "MP4 audio";
    } else if (buffer && ["wma", "asf"].includes(fmt.ext)) {
      parsed = parseAsf(buffer);
      parserName = "ASF/WMA";
    }
  } catch (e) {
    console.warn("Audio parser warning:", e);
  }
  if (parsed && !parsed.error) {
    if (parserName) addItem(media, "Parser", parserName);
    const a = parsed.audio;
    if (parsed.durationS || (a && a.durationS)) {
      const d = parsed.durationS || a.durationS;
      state.mediaDuration = d;
      setDetail("duration", formatDuration(d));
      showDetailRow("rowDuration");
      addItem(
        media,
        "Duration",
        formatDuration(d) + (a && a.estimated ? " (estimated)" : ""),
      );
    }
    if (a) {
      if (a.version)
        addItem(tech, "Stream Format", a.version + " " + (a.layer || ""));
      if (a.bitrate)
        addItem(
          tech,
          "Bitrate",
          (a.vbr ? "~" : "") + a.bitrate + " kbps" + (a.vbr ? " (VBR)" : ""),
        );
      if (a.sampleRate) addItem(tech, "Sample Rate", a.sampleRate + " Hz");
      if (a.channels)
        addItem(
          tech,
          "Channels",
          a.mode ? a.channels + " (" + a.mode + ")" : String(a.channels),
        );
      if (a.frames) addItem(tech, "Frames", String(a.frames));
    }
    if (parsed.sampleRate && !a)
      addItem(tech, "Sample Rate", parsed.sampleRate + " Hz");
    if (parsed.channels && !a)
      addItem(tech, "Channels", String(parsed.channels));
    if (parsed.bitsPerSample)
      addItem(tech, "Bits Per Sample", String(parsed.bitsPerSample));
    if (parsed.codec) addItem(tech, "Codec", parsed.codec);
    if (parsed.audioFormat != null)
      addItem(tech, "Wave Format", "0x" + parsed.audioFormat.toString(16));
    const tags = Object.assign({}, parsed.v1 || {}, parsed.tags || {});
    if (Object.keys(tags).length) addTags(tagsCat, tags, "Audio tags");
    if (parsed.pictures && parsed.pictures.length) {
      const pic =
        parsed.pictures.find((x) => x.type === 3) || parsed.pictures[0];
      try {
        const coverUrl = trackUrl(
          URL.createObjectURL(
            new Blob([pic.bytes], { type: pic.mime || "image/jpeg" }),
          ),
        );
        addBlock(tagsCat, { type: "image", src: coverUrl, alt: "Cover art" });
        addRaw(
          "Artwork",
          "Cover art",
          pic.mime + " (" + pic.bytes.byteLength + " bytes)",
        );
      } catch (e) {
        /* ignore bad image */
      }
    }
    if (parsed.xmp && parsed.xmp.length > 40) {
      for (const [label, v] of extractXmpCore(parsed.xmp)) {
        addItem(tagsCat, label, v);
        addRaw("XMP", label, v);
      }
    }
  } else {
    addItem(
      media,
      "Note",
      parsed && parsed.error
        ? "Deep parse unavailable: " + parsed.error
        : "No format-specific metadata found for this audio file.",
    );
  }
  if (state.mediaDate) {
    const v = formatDate(+state.mediaDate);
    addItem(media, "Media Date", v);
  }
  if (!state.rawItems.length) {
    const c = makeCategory("No Metadata", "ℹ️");
    addItem(c, "Info", "No embedded tags found in this audio file.");
  }
}

/* --------------------- ASF / WMV / WMA header ---------------------------- */
function parseAsf(buffer) {
  const out = {
    format: "ASF (Advanced Systems Format)",
    title: "",
    author: "",
    copyright: "",
    description: "",
    rating: "",
    durationS: null,
    tags: {},
  };
  if (!buffer || buffer.byteLength < 30) return out;
  const dv = new DataView(buffer);
  const view = new Uint8Array(buffer);
  if (
    !(
      view[0] === 0x30 &&
      view[1] === 0x26 &&
      view[2] === 0xb2 &&
      view[3] === 0x75
    )
  ) {
    out.error = "Not an ASF/WMV/WMA file";
    return out;
  }
  const guidAt = (o) => {
    const h = (b) => (view[o + b] < 16 ? "0" : "") + view[o + b].toString(16);
    const h2 = (b) => h(b + 1) + h(b);
    const h4 = (b) => h(b + 3) + h(b + 2) + h(b + 1) + h(b);
    return (
      h4(0) +
      "-" +
      h2(4) +
      "-" +
      h2(6) +
      "-" +
      h(8) +
      h(9) +
      "-" +
      h(10) +
      h(11) +
      h(12) +
      h(13) +
      h(14) +
      h(15)
    );
  };
  const ASF = {
    PROPERTIES: "8cabdca1-a947-11cf-8ee4-00c00c205365",
    CONTENT_DESC: "75b22633-668e-11cf-a6d9-00aa0062ce6c",
    EXT_DESC: "40a52d8d-7e17-114b-a022-130973e0ffed",
  };
  let p = 30,
    guard = 0;
  while (p + 24 <= Math.min(view.length, 4 * 1024 * 1024) && guard++ < 200) {
    const g = guidAt(p);
    const size = Number(u64le(dv, p + 8));
    if (size < 24 || p + size > view.length) break;
    if (g === ASF.PROPERTIES && p + 88 <= view.length) {
      const created = oleFiletimeToDate(
        dv.getUint32(p + 48, true),
        dv.getUint32(p + 52, true),
      );
      if (created) {
        out.creationDate = created;
        out.tags["Creation Date"] = formatDate(+created);
        state.mediaDate = created;
      }
      const playDur = Number(u64le(dv, p + 64));
      if (playDur > 0) out.durationS = playDur / 10000000;
    } else if (g === ASF.CONTENT_DESC) {
      try {
        const tl = u16le(view, p + 24),
          al = u16le(view, p + 26),
          cl = u16le(view, p + 28),
          dl = u16le(view, p + 30),
          rl = u16le(view, p + 32);
        let q = p + 34;
        const take = (len) => {
          const s = safeDecode(view.subarray(q, q + len * 2), 1).replace(
            /\0+$/g,
            "",
          );
          q += len * 2;
          return s;
        };
        out.title = take(tl);
        out.author = take(al);
        out.copyright = take(cl);
        out.description = take(dl);
        out.rating = take(rl);
      } catch (e) {
        /* malformed */
      }
    } else if (g === ASF.EXT_DESC) {
      try {
        const count = dv.getUint16(p + 42, true);
        let q = p + 44;
        for (let i = 0; i < Math.min(count, 40) && q + 18 <= p + size; i++) {
          const nameLen = u16le(view, q);
          const vType = u16le(view, q + 2);
          const vLen = u16le(view, q + 4);
          q += 6;
          const nameStart = q;
          q += nameLen * 2;
          const name = safeDecode(
            view.subarray(nameStart, nameStart + nameLen * 2),
            1,
          ).replace(/\0+$/g, "");
          let val = "";
          if (vType === 0 || vType === 1)
            val = safeDecode(view.subarray(q, q + vLen), 1).replace(
              /\0+$/g,
              "",
            );
          else if (vType === 2 && vLen === 4)
            val = String(dv.getUint32(q, true));
          else if (vType === 4 && vLen === 8) {
            const d = oleFiletimeToDate(
              dv.getUint32(q, true),
              dv.getUint32(q + 4, true),
            );
            val = d ? formatDate(+d) : "";
          } else if (vType === 5 && vLen === 8)
            val = String(dv.getUint32(q, true));
          q += vLen;
          if (name && val) out.tags[name] = val;
        }
      } catch (e) {
        /* malformed */
      }
    }
    p += size;
  }
  if (out.title) out.tags.Title = out.title;
  if (out.author) out.tags.Author = out.author;
  if (out.copyright) out.tags.Copyright = out.copyright;
  if (out.description) out.tags.Description = out.description;
  if (out.durationS) state.mediaDuration = out.durationS;
  return out;
}

async function handleDocument(file, buffer, fmt) {
  const info = makeCategory("Document Information", "📄");
  const meta = makeCategory("Document Metadata", "🏷️");
  const stats = makeCategory("Document Statistics", "📊");
  const blobCat = makeCategory("Structure", "🧱");
  const url = trackUrl(URL.createObjectURL(file));
  if (fmt.subtype === "pdf") {
    showMediaPreview(url, "pdf");
    const pdf = parsePdf(buffer);
    if (pdf.version) {
      addItem(info, "PDF Version", pdf.version);
      addRaw("PDF", "Version", pdf.version);
    }
    const map = {
      Title: "Title",
      Author: "Author",
      Subject: "Subject",
      Keywords: "Keywords",
      Creator: "Creating Application",
      Producer: "Producer",
      Trapped: "Trapped",
    };
    for (const [k, label] of Object.entries(map))
      if (pdf.info[k]) {
        addItem(meta, label, pdf.info[k]);
        addRaw("PDF Info", label, pdf.info[k]);
      }
    if (pdf.info.CreationDate) {
      const d = parsePdfDate(pdf.info.CreationDate);
      if (d) {
        addItem(meta, "Created", formatDate(+d));
        addRaw("PDF Dates", "Created", formatDate(+d));
      }
    }
    if (pdf.info.ModDate) {
      const d = parsePdfDate(pdf.info.ModDate);
      if (d) {
        addItem(meta, "Modified", formatDate(+d));
        addRaw("PDF Dates", "Modified", formatDate(+d));
      }
    }
    if (pdf.pages) {
      addItem(stats, "Pages", String(pdf.pages));
      addRaw("PDF Structure", "Pages", String(pdf.pages));
    }
    if (pdf.objects) addItem(stats, "Objects", String(pdf.objects));
    if (pdf.forms) addItem(stats, "AcroForm References", String(pdf.forms));
    if (pdf.encrypted) addItem(info, "Encryption", "Yes (password protected)");
    if (pdf.linearized) addItem(info, "Linearized", "Yes (fast web view)");
    if (pdf.javascript) addItem(info, "Embedded JavaScript", "Yes");
    if (pdf.pageSizes.length)
      addItem(stats, "Page Size (pts)", pdf.pageSizes[0]);
    if (pdf.xmp) {
      for (const [label, v] of extractXmpCore(pdf.xmp)) {
        addItem(meta, label, v);
        addRaw("XMP", label, v);
      }
      addBlock(blobCat, { type: "text", text: pdf.xmp.slice(0, 4000) });
    }
  } else if (fmt.subtype === "ole") {
    showPlaceholder(
      "📄",
      "OLE compound document",
      "Preview not available — metadata shown below.",
    );
    const ole = parseOle(buffer);
    if (!ole.error) {
      addItem(info, "Container", ole.format);
      addItem(info, "Version", ole.version);
      addItem(blobCat, "Streams", String(ole.streamCount));
      for (const [label, v] of Object.entries(
        Object.assign({}, ole.docSummary, ole.summary),
      )) {
        addItem(meta, label, String(v));
        addRaw("OLE Summary", label, String(v));
      }
      if (ole.streams.length)
        addBlock(blobCat, {
          type: "list",
          items: ole.streams
            .map((s) => s.name + " (" + s.size + " B)")
            .slice(0, 60),
        });
    } else addItem(info, "Error", ole.error);
  } else if (["docx", "xlsx", "pptx", "epub"].includes(fmt.subtype) && buffer) {
    showPlaceholder(
      "📘",
      fmt.label,
      "Preview not available — metadata shown below.",
    );
    const zip = parseZip(buffer);
    if (!zip.error) {
      const ox = parseOfficeXml(buffer, zip, fmt.subtype);
      const pairs = {
        Title: "Title",
        Subject: "Subject",
        Author: "Author",
        lastAuthor: "Last Modified By",
        Keywords: "Keywords",
        Description: "Description",
        Category: "Category",
        Company: "Company",
        Manager: "Manager",
        App: "Application",
        appVersion: "Application Version",
        Revision: "Revision",
        Template: "Template",
        created: "Created",
        modified: "Modified",
        lastPrinted: "Last Printed",
        contentStatus: "Content Status",
        docLanguage: "Language",
        publisher: "Publisher",
      };
      for (const [k, label] of Object.entries(pairs))
        if (ox[k]) {
          addItem(meta, label, String(ox[k]));
          addRaw("OOXML", label, String(ox[k]));
        }
      const statPairs = {
        pages: "Pages",
        words: "Words",
        wordCount: "Words (computed)",
        chars: "Characters",
        characters: "Characters (computed)",
        charsWithSpaces: "Characters (with spaces)",
        lines: "Lines",
        paragraphs: "Paragraphs",
        slides: "Slides",
        notes: "Notes",
        hiddenSlides: "Hidden Slides",
        totalTime: "Editing Time (min)",
      };
      for (const [k, label] of Object.entries(statPairs))
        if (ox[k] && ox[k] !== "0") {
          addItem(stats, label, String(ox[k]));
          addRaw("OOXML Stats", label, String(ox[k]));
        }
      if (ox.sheets && ox.sheets.length)
        addBlock(stats, { type: "list", items: ox.sheets.slice(0, 30) });
      if (ox.customProperties)
        addItem(meta, "Custom Properties", ox.customProperties);
      if (ox.images) addItem(stats, "Embedded Images", String(ox.images));
      if (ox.mediaFiles) addItem(stats, "Media Files", String(ox.mediaFiles));
      if (ox.epubUid) {
        addItem(meta, "EPUB Identifier", ox.epubUid);
        addItem(meta, "OPF Version", ox.opfVersion || "-");
        if (ox.items) addItem(stats, "Manifest Items", String(ox.items));
      }
      addItem(blobCat, "Zip Entries", String(zip.entries.length));
      if (zip.comment) addItem(blobCat, "Archive Comment", zip.comment);
    } else
      addItem(
        info,
        "Error",
        "Not a readable ZIP/OOXML container: " + zip.error,
      );
  } else if (fmt.ext === "rtf" && buffer) {
    showPlaceholder("📝", "Rich Text Document", "Metadata shown below.");
    const text = safeDecode(
      new Uint8Array(buffer).subarray(0, Math.min(buffer.byteLength, 262144)),
      3,
    );
    for (const [k, label] of [
      ["title", "Title"],
      ["author", "Author"],
      ["company", "Company"],
      ["operator", "Last Modified By"],
      ["creatim", "Created"],
      ["revtim", "Modified"],
      ["keywords", "Keywords"],
      ["doccomm", "Comments"],
      ["subject", "Subject"],
      ["manager", "Manager"],
      ["category", "Category"],
    ]) {
      const re = new RegExp(
        "\\\\" + k + "\\s*(?:\\{([^{}]*)\\}|([^;\\\\\\r\\n]+))",
      );
      const m = re.exec(text);
      if (m) {
        const v = (m[1] || m[2] || "").trim();
        if (v) {
          addItem(meta, label, v);
          addRaw("RTF", label, v);
        }
      }
    }
  } else {
    showPlaceholder("📄", fmt.label, "Preview not available.");
    addItem(
      info,
      "Note",
      "No dedicated metadata parser for this document type; generic properties are shown.",
    );
  }
  if (state.mediaDate) {
    const v = formatDate(+state.mediaDate);
    addItem(info, "Document Date", v);
  }
  if (!state.rawItems.length) {
    const c = makeCategory("No Metadata", "ℹ️");
    addItem(c, "Info", "No document metadata found.");
  }
}

async function handleArchive(file, buffer, fmt) {
  const info = makeCategory("Archive Information", "🗜️");
  const contents = makeCategory("Contents & Structure", "🗂️");
  const dates = makeCategory("Timestamps", "🕐");
  showPlaceholder("🗜️", fmt.label, "Archive contents analyzed below.");
  let parsed = null,
    parserName = "";
  try {
    if (
      buffer &&
      (fmt.subtype === "zip" ||
        fmt.ext === "zip" ||
        fmt.ext === "jar" ||
        fmt.ext === "apk" ||
        fmt.ext === "ipa")
    ) {
      parsed = parseZip(buffer);
      parserName = "ZIP";
    } else if (buffer && ["gz", "tgz"].includes(fmt.ext)) {
      parsed = parseGzip(buffer);
      parserName = "GZIP";
    } else if (buffer && (fmt.subtype === "tar" || fmt.ext === "tar")) {
      parsed = parseTar(buffer);
      parserName = "TAR";
    } else if (buffer && fmt.ext === "rar") {
      parsed = parseRar(buffer);
      parserName = "RAR";
    } else if (buffer && fmt.ext === "7z") {
      parsed = parseSevenZip(buffer);
      parserName = "7-Zip";
    } else if (buffer && fmt.ext === "iso") {
      parsed = parseIso(buffer);
      parserName = "ISO 9660";
    }
  } catch (e) {
    console.warn("Archive parser warning:", e);
  }
  if (parsed && !parsed.error) {
    addItem(info, "Parser", parserName);
    if (parsed.entries) {
      const files = parsed.entries.filter((e) => !e.isDirectory);
      const dirs = parsed.entries.filter((e) => e.isDirectory);
      addItem(contents, "Entries", String(parsed.entries.length));
      if (files.length) addItem(contents, "Files", String(files.length));
      if (dirs.length) addItem(contents, "Directories", String(dirs.length));
      if (parsed.totalUncompressed) {
        addItem(
          contents,
          "Uncompressed Size",
          formatBytes(parsed.totalUncompressed),
        );
        const ratio = parsed.totalCompressed
          ? Math.round(
              (1 - parsed.totalCompressed / parsed.totalUncompressed) * 1000,
            ) / 10
          : null;
        if (ratio != null && ratio > 0)
          addItem(contents, "Compression Saved", ratio + "%");
      }
      if (parsed.totalSize)
        addItem(contents, "Total Content Size", formatBytes(parsed.totalSize));
      if (parsed.totalUnpacked)
        addItem(contents, "Unpacked Size", formatBytes(parsed.totalUnpacked));
      if (parsed.count) addItem(contents, "File Count", String(parsed.count));
      const names = parsed.entries.map(
        (e) =>
          e.name +
          (e.isDirectory ? "/" : "") +
          (e.size ? " — " + formatBytes(e.size) : ""),
      );
      if (names.length)
        addBlock(contents, { type: "list", items: names.slice(0, 80) });
      const mtimes = parsed.entries
        .map((e) => e.date || e.mtime)
        .filter(Boolean)
        .sort((a, b) => a - b);
      if (mtimes.length) {
        addItem(dates, "Oldest Entry", formatDate(+mtimes[0]));
        addItem(dates, "Newest Entry", formatDate(+mtimes[mtimes.length - 1]));
      }
      if (parsed.oldestEntry)
        addItem(dates, "Oldest Entry", parsed.oldestEntry);
      if (parsed.newestEntry)
        addItem(dates, "Newest Entry", parsed.newestEntry);
    }
    if (parsed.comment) addItem(info, "Archive Comment", parsed.comment);
    if (parsed.encrypted)
      addItem(info, "Encryption", "Yes (password protected)");
    if (parsed.solid) addItem(info, "Solid Archive", "Yes");
    if (parsed.zip64) addItem(info, "ZIP64", "Yes (large archive format)");
    if (parsed.signatureVersion)
      addItem(info, "Signature Version", parsed.signatureVersion);
    if (parsed.volumeLabel) {
      addItem(info, "Volume Label", parsed.volumeLabel);
      addItem(info, "System ID", parsed.systemId || "-");
    }
    if (parsed.blockSize)
      addItem(info, "Block Size", parsed.blockSize + " bytes");
    if (parsed.volumeSize)
      addItem(info, "Volume Size", formatBytes(parsed.volumeSize));
    if (parsed.publisher) addItem(info, "Publisher", parsed.publisher);
    if (parsed.preparer) addItem(info, "Preparer", parsed.preparer);
    if (parsed.application) addItem(info, "Application", parsed.application);
    if (parsed.joliet) addItem(info, "Joliet Extensions", "Present");
    if (parsed.udf) addItem(info, "UDF", "Present");
    if (parsed.bootable) addItem(info, "Bootable", "Yes (El Torito)");
    if (parsed.originalName) {
      addItem(info, "Original Filename", parsed.originalName);
      addItem(info, "Original Size", formatBytes(parsed.originalSize || 0));
    }
    if (parsed.ratio) addItem(info, "Compression Ratio", parsed.ratio);
    if (parsed.compressionMethod)
      addItem(info, "Compression Method", parsed.compressionMethod);
    if (parsed.os) addItem(info, "Created On", parsed.os);
    if (parsed.version) addItem(info, "Format Version", parsed.version);
    if (parsed.isRar5) addItem(info, "RAR Version", "5.0");
    if (parsed.paxHeaders)
      addItem(contents, "PAX Headers", String(parsed.paxHeaders));
    if (parsed.mtime) addItem(dates, "Archive Date", formatDate(+parsed.mtime));
    if (parsed.created) addItem(dates, "Created", formatDate(+parsed.created));
    if (parsed.modified)
      addItem(dates, "Modified", formatDate(+parsed.modified));
  } else {
    addItem(
      info,
      "Note",
      parsed && parsed.error
        ? "Deep parse unavailable: " + parsed.error
        : "Unsupported archive format.",
    );
    if (buffer && fmt.ext === "bz2")
      addItem(
        info,
        "Format",
        "BZip2 (block-compressed stream; per-file metadata not exposed)",
      );
    if (buffer && ["xz", "zst", "lzma", "lz"].includes(fmt.ext))
      addItem(
        info,
        "Format",
        fmt.ext.toUpperCase() + " stream compression (no container metadata)",
      );
  }
  if (state.mediaDate)
    addItem(dates, "Archive Date", formatDate(+state.mediaDate));
  if (!state.rawItems.length) {
    const c = makeCategory("No Metadata", "ℹ️");
    addItem(c, "Info", "No readable metadata found in this archive.");
  }
}

async function handleText(file, buffer, fmt) {
  const info = makeCategory("Text Information", "📝");
  const stats = makeCategory("Text Statistics", "🔢");
  const previewCat = makeCategory("Preview", "👁️");
  let text = "";
  if (buffer) {
    const view = new Uint8Array(buffer).subarray(
      0,
      Math.min(buffer.byteLength, 2 * 1024 * 1024),
    );
    if (view[0] === 0xff && view[1] === 0xfe) {
      text = new TextDecoder("utf-16le").decode(view.subarray(2));
      addItem(info, "Encoding", "UTF-16 LE (BOM)");
    } else if (view[0] === 0xfe && view[1] === 0xff) {
      text = new TextDecoder("utf-16be").decode(view.subarray(2));
      addItem(info, "Encoding", "UTF-16 BE (BOM)");
    } else if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) {
      text = UTF8.decode(view.subarray(3));
      addItem(info, "Encoding", "UTF-8 (BOM)");
    } else {
      let asciiLike = true;
      for (let i = 0; i < Math.min(view.length, 4096); i++)
        if (
          view[i] === 0 ||
          view[i] < 0x09 ||
          (view[i] > 0x0d && view[i] < 0x20)
        ) {
          asciiLike = false;
          break;
        }
      text = asciiLike ? UTF8.decode(view) : LATIN1.decode(view);
      addItem(
        info,
        "Encoding",
        asciiLike ? "UTF-8 / ASCII" : "Latin-1 (guessed)",
      );
    }
  }
  const lines = text.split(/\r\n|\r|\n/);
  const words = text.split(/\s+/).filter(Boolean);
  addItem(stats, "Lines", String(lines.length));
  addItem(stats, "Words", String(words.length));
  addItem(stats, "Characters", String(text.length));
  addItem(
    stats,
    "Characters (no spaces)",
    String(text.replace(/\s/g, "").length),
  );
  let longLine = "";
  for (const l of lines) if (l.length > longLine.length) longLine = l;
  addItem(stats, "Longest Line", longLine.length + " chars");
  if (buffer && buffer.byteLength > 2 * 1024 * 1024)
    addItem(info, "Analyzed", "First 2 MB for preview");
  const ext = fmt.ext;
  if (ext === "json") {
    try {
      const j = JSON.parse(text);
      const keys = j && typeof j === "object" ? Object.keys(j) : [];
      addItem(info, "Valid JSON", "Yes");
      if (Array.isArray(j))
        addItem(info, "Top-level Type", "Array (" + j.length + " items)");
      else if (keys.length) {
        addItem(info, "Top-level Type", "Object");
        addBlock(info, { type: "list", items: keys.slice(0, 40) });
      }
      addBlock(previewCat, {
        type: "text",
        text: JSON.stringify(j, null, 2).slice(0, 3000),
      });
    } catch (e) {
      addItem(info, "Valid JSON", "No — " + e.message);
    }
  } else if (ext === "csv") {
    const rows = lines.filter((l) => l.trim()).length;
    const cols = lines[0] ? lines[0].split(",").length : 0;
    addItem(info, "Rows (approx)", String(rows));
    addItem(info, "Columns (first row)", String(cols));
  } else if (ext === "html" || ext === "htm" || ext === "xml") {
    const titleM = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
    if (titleM && titleM[1].trim()) {
      addItem(info, "Title", titleM[1].trim());
      addRaw("HTML", "Title", titleM[1].trim());
    }
    const metaM = [...text.matchAll(/<meta\s+[^>]*>/gi)];
    if (metaM.length) {
      addItem(info, "Meta Tags", String(metaM.length));
      addBlock(info, {
        type: "list",
        items: metaM.slice(0, 30).map((m) => m[0].slice(0, 200)),
      });
    }
    const declM = /<(\?xml[^>]*|!DOCTYPE[^>]*)>/i.exec(text);
    if (declM) addItem(info, "Declaration", declM[1].trim().slice(0, 120));
  } else if (ext === "srt" || ext === "vtt") {
    const cues = (text.match(/-->|\d{2}:\d{2}:\d{2}/g) || []).length;
    addItem(info, "Subtitle Cues (approx)", String(cues));
  }
  if (text.trim())
    addBlock(previewCat, { type: "text", text: text.slice(0, 5000) });
  else addItem(info, "Note", "File appears to be empty.");
  showMediaPreview(text.slice(0, 20000), "text");
  if (!state.rawItems.length) {
    const c = makeCategory("No Metadata", "ℹ️");
    addItem(c, "Info", "Text file analyzed — statistics shown above.");
  }
}

async function handleOther(file, buffer, fmt) {
  const info = makeCategory("Binary File Information", "🧩");
  const details = makeCategory("Technical Details", "🔬");
  showPlaceholder(
    "📦",
    fmt.label || "Unknown file",
    "Signature-based analysis below.",
  );
  let parsed = null,
    parserName = "";
  try {
    if (buffer && (fmt.subtype === "exe" || fmt.subtype === "elf")) {
      parsed = parseElfPe(buffer);
      parserName = "ELF/PE";
    } else if (buffer && fmt.ext === "wasm") {
      parsed = parseWasm(buffer);
      parserName = "WebAssembly";
    } else if (buffer && fmt.ext === "class") {
      parsed = parseClass(buffer);
      parserName = "Java class";
    } else if (buffer && ["ttf", "otf", "woff", "woff2"].includes(fmt.ext)) {
      parsed = parseFont(buffer, fmt.ext);
      parserName = "Font";
    } else if (buffer && (fmt.subtype === "heic" || fmt.subtype === "avif")) {
      parsed = parseMp4(buffer);
      parserName = "ISOBMFF (HEIF)";
    }
  } catch (e) {
    console.warn("Binary parser warning:", e);
  }
  if (parsed && !parsed.error) {
    addItem(info, "Parser", parserName);
    if (parsed.format) addItem(info, "Format", parsed.format);
    if (parsed.machine)
      addItem(details, "Machine / Architecture", parsed.machine);
    if (parsed.bits) addItem(details, "Architecture Bits", String(parsed.bits));
    if (parsed.endian) addItem(details, "Endianness", parsed.endian);
    if (parsed.type) addItem(details, "File Type", parsed.type);
    if (parsed.entryPoint) addItem(details, "Entry Point", parsed.entryPoint);
    if (parsed.subsystem) addItem(details, "Subsystem", parsed.subsystem);
    if (parsed.sectionCount) {
      addItem(details, "Sections", String(parsed.sectionCount));
      const names = (parsed.sections || []).map(
        (s) =>
          (s.name || (s.id != null ? "section " + s.id : "section")) +
          (s.size ? " — " + formatBytes(s.size) : ""),
      );
      if (names.length)
        addBlock(details, { type: "list", items: names.slice(0, 40) });
    }
    if (parsed.created) {
      addItem(details, "Build Timestamp", formatDate(+parsed.created));
      state.mediaDate = parsed.created;
    }
    if (parsed.version) addItem(details, "Version", parsed.version);
    if (parsed.compiledFor)
      addItem(details, "Compiled For", parsed.compiledFor);
    if (parsed.thisClass) addItem(details, "Class", parsed.thisClass);
    if (parsed.superClass && parsed.superClass !== "-")
      addItem(details, "Superclass", parsed.superClass);
    if (parsed.methods) addItem(details, "Methods", String(parsed.methods));
    if (parsed.fields) addItem(details, "Fields", String(parsed.fields));
    if (parsed.constantPoolCount)
      addItem(details, "Constant Pool", String(parsed.constantPoolCount));
    if (parsed.accessFlags && parsed.accessFlags !== "-")
      addItem(details, "Access Flags", parsed.accessFlags);
    if (parsed.customNames && parsed.customNames.length)
      addBlock(details, {
        type: "list",
        items: parsed.customNames.slice(0, 30),
      });
    if (parsed.memoryPages)
      addItem(
        details,
        "Memory Pages",
        parsed.memoryPages + " (" + parsed.memoryPages * 64 + " KB)",
      );
    for (const [label, v] of Object.entries(parsed.names || {})) {
      addItem(details, label, v);
      addRaw("Font", label, v);
    }
    if (parsed.glyphCount)
      addItem(details, "Glyph Count", String(parsed.glyphCount));
    if (parsed.unitsPerEm)
      addItem(details, "Units Per Em", String(parsed.unitsPerEm));
    if (parsed.isVariable) addItem(details, "Variable Font", "Yes");
    if (parsed.tableCount)
      addItem(details, "Table Count", String(parsed.tableCount));
    if (parsed.tables && parsed.tables.length)
      addItem(details, "Tables", parsed.tables.join(", ").slice(0, 300));
    if (parsed.compressed) addItem(details, "Compressed", parsed.compressed);
    if (parsed.woffFlavor) addItem(details, "Flavor", parsed.woffFlavor);
    if (parsed.brand) addItem(info, "Major Brand", parsed.brand);
    if (parsed.brands && parsed.brands.length)
      addItem(info, "Compatible Brands", parsed.brands.slice(0, 8).join(", "));
    if (parsed.width && parsed.height) {
      state.mediaWidth = parsed.width;
      state.mediaHeight = parsed.height;
      setDetail("dimensions", parsed.width + " × " + parsed.height + " px");
      showDetailRow("rowDimensions");
    }
    if (parsed.durationS) {
      state.mediaDuration = parsed.durationS;
      setDetail("duration", formatDuration(parsed.durationS));
      showDetailRow("rowDuration");
    }
  } else {
    addItem(
      info,
      "Detection",
      fmt.label +
        " (by " +
        (fmt.mime && fmt.mime !== "application/octet-stream"
          ? "MIME type"
          : "extension") +
        ")",
    );
    addItem(
      info,
      "Note",
      parsed && parsed.error
        ? "Deep parse unavailable: " + parsed.error
        : "No dedicated parser for this binary format.",
    );
  }
  if (state.mediaDate)
    addItem(info, "Embedded Date", formatDate(+state.mediaDate));
  if (!state.rawItems.length) {
    const c = makeCategory("No Metadata", "ℹ️");
    addItem(c, "Info", "No structured metadata found in this file.");
  }
}

/* ----------------------------- Hashes ------------------------------------ */
async function computeHashes(buffer) {
  try {
    if (!window.crypto || !window.crypto.subtle)
      throw new Error("Web Crypto unavailable (requires secure context)");
    const [s256, s1] = await Promise.all([
      window.crypto.subtle.digest("SHA-256", buffer),
      window.crypto.subtle.digest("SHA-1", buffer),
    ]);
    det.sha256.textContent = hexFromBytes(new Uint8Array(s256));
    det.sha1.textContent = hexFromBytes(new Uint8Array(s1));
  } catch (e) {
    console.warn("Hashing failed:", e);
    det.sha256.textContent = det.sha1.textContent = "unavailable";
  }
}
