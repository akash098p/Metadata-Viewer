// Global variables
let currentFile = null;
let startTime = null;

// DOM Elements
const uploadArea = document.getElementById("uploadArea");
const fileInput = document.getElementById("fileInput");
const uploadSection = document.getElementById("uploadSection");
const contentArea = document.getElementById("contentArea");
const loadingOverlay = document.getElementById("loadingOverlay");
const previewImage = document.getElementById("previewImage");
const processingTime = document.getElementById("processingTime");
const fileName = document.getElementById("fileName");
const fileSize = document.getElementById("fileSize");
const dimensions = document.getElementById("dimensions");
const fileType = document.getElementById("fileType");
const cameraInfo = document.getElementById("cameraInfo");
const cameraCount = document.getElementById("cameraCount");
const dateInfo = document.getElementById("dateInfo");
const dateCount = document.getElementById("dateCount");
const allMetadata = document.getElementById("allMetadata");
const totalCount = document.getElementById("totalCount");
const gpsCard = document.getElementById("gpsCard");
const gpsContent = document.getElementById("gpsContent");
const newImageBtn = document.getElementById("newImageBtn");
const downloadOriginalBtn = document.getElementById("downloadOriginalBtn");
const removeMetadataBtn = document.getElementById("removeMetadataBtn");

// Event Listeners
uploadArea.addEventListener("click", () => fileInput.click());
uploadArea.addEventListener("dragover", handleDragOver);
uploadArea.addEventListener("dragleave", handleDragLeave);
uploadArea.addEventListener("drop", handleDrop);
fileInput.addEventListener("change", handleFileSelect);
newImageBtn.addEventListener("click", resetApp);
downloadOriginalBtn.addEventListener("click", downloadOriginal);
removeMetadataBtn.addEventListener("click", removeAndDownload);

// Drag & Drop Handlers
function handleDragOver(e) {
  e.preventDefault();
  uploadArea.classList.add("dragover");
}

function handleDragLeave(e) {
  e.preventDefault();
  uploadArea.classList.remove("dragover");
}

function handleDrop(e) {
  e.preventDefault();
  uploadArea.classList.remove("dragover");
  const files = e.dataTransfer.files;
  if (files.length > 0) processFile(files[0]);
}

function handleFileSelect(e) {
  const files = e.target.files;
  if (files.length > 0) processFile(files[0]);
}

// Main Processing Function
async function processFile(file) {
  if (!file.type.startsWith("image/")) {
    alert("Please select a valid image file");
    return;
  }

  currentFile = file;
  startTime = performance.now();
  loadingOverlay.classList.remove("hidden");

  try {
    // Read file as ArrayBuffer for EXIF
    const arrayBuffer = await file.arrayBuffer();

    // Read file as DataURL for preview
    const reader = new FileReader();
    reader.onload = (e) => {
      previewImage.src = e.target.result;
      previewImage.onload = () => {
        dimensions.textContent = `${previewImage.naturalWidth} × ${previewImage.naturalHeight} px`;
      };
    };
    reader.readAsDataURL(file);

    // Basic file info
    fileName.textContent = file.name;
    fileSize.textContent = formatBytes(file.size);
    fileType.textContent = file.type || "Unknown";

    // Extract EXIF using ExifReader
    let tags = {};
    try {
      tags = ExifReader.load(arrayBuffer);
    } catch (error) {
      console.log("EXIF extraction error:", error);
      tags = {};
    }

    // Process metadata
    processMetadata(tags);

    // Show content area
    uploadSection.style.display = "none";
    contentArea.classList.remove("hidden");

    // Calculate processing time
    const endTime = performance.now();
    const timeTaken = ((endTime - startTime) / 1000).toFixed(2);
    processingTime.textContent = `Processed in ${timeTaken}s`;
  } catch (error) {
    console.error("Error processing file:", error);
    alert("Error processing file. Please try again.");
  } finally {
    loadingOverlay.classList.add("hidden");
  }
}

// Process and Display Metadata
function processMetadata(tags) {
  if (!tags || Object.keys(tags).length === 0) {
    showNoMetadata();
    return;
  }

  // Display camera info
  displayCameraInfo(tags);

  // Display date info
  displayDateInfo(tags);

  // Display GPS info
  displayGPSInfo(tags);

  // Display all metadata
  displayAllMetadata(tags);
}

function displayCameraInfo(tags) {
  const cameraFields = [
    { key: "Make", label: "Camera Make" },
    { key: "Model", label: "Camera Model" },
    { key: "LensModel", label: "Lens" },
    { key: "LensMake", label: "Lens Make" },
    { key: "ISOSpeedRatings", label: "ISO" },
    {
      key: "FNumber",
      label: "Aperture",
      format: (v) => `f/${v.description || v.value}`,
    },
    {
      key: "ExposureTime",
      label: "Shutter Speed",
      format: (v) => `${v.description || v.value}s`,
    },
    {
      key: "FocalLength",
      label: "Focal Length",
      format: (v) => `${v.description || v.value}mm`,
    },
    { key: "ExposureProgram", label: "Exposure Mode" },
    { key: "MeteringMode", label: "Metering Mode" },
    { key: "Flash", label: "Flash" },
    { key: "WhiteBalance", label: "White Balance" },
    {
      key: "ExposureBiasValue",
      label: "Exposure Comp",
      format: (v) => `${v.description || v.value} EV`,
    },
  ];

  let html = "";
  let count = 0;

  cameraFields.forEach((field) => {
    const tag = tags[field.key];
    if (tag && tag.description !== undefined) {
      count++;
      const value = field.format
        ? field.format(tag)
        : tag.description || tag.value;
      html += createMetadataItem(field.label, value);
    }
  });

  if (count === 0) {
    cameraInfo.innerHTML =
      '<div class="no-data">No camera information available</div>';
    cameraCount.textContent = "0";
  } else {
    cameraInfo.innerHTML = html;
    cameraCount.textContent = count.toString();
  }
}

function displayDateInfo(tags) {
  const dateFields = [
    { key: "DateTimeOriginal", label: "Date Taken" },
    { key: "DateTime", label: "Date Modified" },
    { key: "DateTimeDigitized", label: "Date Digitized" },
    { key: "CreateDate", label: "Create Date" },
    { key: "ModifyDate", label: "Modify Date" },
    { key: "OffsetTime", label: "Timezone Offset" },
    { key: "SubSecTime", label: "Subseconds" },
  ];

  let html = "";
  let count = 0;

  dateFields.forEach((field) => {
    const tag = tags[field.key];
    if (tag && tag.description !== undefined) {
      count++;
      html += createMetadataItem(field.label, tag.description || tag.value);
    }
  });

  if (count === 0) {
    dateInfo.innerHTML =
      '<div class="no-data">No date information available</div>';
    dateCount.textContent = "0";
  } else {
    dateInfo.innerHTML = html;
    dateCount.textContent = count.toString();
  }
}

function displayGPSInfo(tags) {
  const lat = tags.GPSLatitude;
  const lon = tags.GPSLongitude;
  const latRef = tags.GPSLatitudeRef;
  const lonRef = tags.GPSLongitudeRef;

  if (lat && lon && latRef && lonRef) {
    const latitude = parseFloat(lat.description);
    const longitude = parseFloat(lon.description);

    let html = '<div class="gps-grid">';

    html += `
            <div class="gps-item">
                <span class="gps-label">Latitude</span>
                <span class="gps-value">${latitude.toFixed(6)}° ${latRef.value}</span>
            </div>
            <div class="gps-item">
                <span class="gps-label">Longitude</span>
                <span class="gps-value">${longitude.toFixed(6)}° ${lonRef.value}</span>
            </div>
        `;

    if (tags.GPSAltitude) {
      html += `
                <div class="gps-item">
                    <span class="gps-label">Altitude</span>
                    <span class="gps-value">${tags.GPSAltitude.description}</span>
                </div>
            `;
    }

    if (tags.GPSDateStamp) {
      html += `
                <div class="gps-item">
                    <span class="gps-label">GPS Date</span>
                    <span class="gps-value">${tags.GPSDateStamp.description}</span>
                </div>
            `;
    }

    html += `</div>
            <div style="text-align: center; padding: 0 24px 20px;">
                <a href="https://www.google.com/maps?q=${latitude},${longitude}" 
                   target="_blank" 
                   class="map-link">
                    🗺️ View on Google Maps
                </a>
            </div>
        `;

    gpsContent.innerHTML = html;
    gpsCard.classList.remove("hidden");
  } else {
    gpsCard.classList.add("hidden");
  }
}

function displayAllMetadata(tags) {
  let html = "";
  let count = 0;

  // Sort tags alphabetically
  const sortedKeys = Object.keys(tags).sort();

  sortedKeys.forEach((key) => {
    const tag = tags[key];
    if (tag && tag.description !== undefined) {
      count++;
      let value = tag.description || tag.value;

      // Truncate very long values
      if (typeof value === "string" && value.length > 200) {
        value = value.substring(0, 200) + "...";
      }

      html += createMetadataItem(key, value);
    }
  });

  if (count === 0) {
    allMetadata.innerHTML = '<div class="no-data">No metadata available</div>';
    totalCount.textContent = "0";
  } else {
    allMetadata.innerHTML = html;
    totalCount.textContent = count.toString();
  }
}

function createMetadataItem(label, value) {
  return `
        <div class="metadata-item">
            <div class="metadata-label">${escapeHtml(label)}</div>
            <div class="metadata-value">${escapeHtml(String(value))}</div>
        </div>
    `;
}

function showNoMetadata() {
  cameraInfo.innerHTML = '<div class="no-data">No camera information</div>';
  dateInfo.innerHTML = '<div class="no-data">No date information</div>';
  allMetadata.innerHTML = '<div class="no-data">No EXIF metadata found</div>';
  cameraCount.textContent = "0";
  dateCount.textContent = "0";
  totalCount.textContent = "0";
  gpsCard.classList.add("hidden");
}

// Utility Functions
function formatBytes(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Download Functions
function downloadOriginal() {
  if (!currentFile) return;

  const link = document.createElement("a");
  link.href = URL.createObjectURL(currentFile);
  link.download = currentFile.name;
  link.click();
  URL.revokeObjectURL(link.href);
}

function removeAndDownload() {
  if (!previewImage.src) return;

  loadingOverlay.classList.remove("hidden");

  setTimeout(() => {
    try {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");

      canvas.width = previewImage.naturalWidth;
      canvas.height = previewImage.naturalHeight;

      // Draw image (this removes EXIF)
      ctx.drawImage(previewImage, 0, 0);

      // Convert to blob
      canvas.toBlob(
        (blob) => {
          const link = document.createElement("a");
          const url = URL.createObjectURL(blob);

          const originalName = currentFile.name;
          const nameWithoutExt = originalName.substring(
            0,
            originalName.lastIndexOf("."),
          );
          const ext = originalName.substring(originalName.lastIndexOf("."));
          const newName = `${nameWithoutExt}_no_metadata${ext}`;

          link.href = url;
          link.download = newName;
          link.click();

          URL.revokeObjectURL(url);
          loadingOverlay.classList.add("hidden");
        },
        currentFile.type || "image/jpeg",
        0.95,
      );
    } catch (error) {
      console.error("Error removing metadata:", error);
      alert("Error removing metadata. Please try again.");
      loadingOverlay.classList.add("hidden");
    }
  }, 100);
}

function resetApp() {
  currentFile = null;
  fileInput.value = "";
  uploadSection.style.display = "block";
  contentArea.classList.add("hidden");
  previewImage.src = "";
  fileName.textContent = "-";
  fileSize.textContent = "-";
  dimensions.textContent = "-";
  fileType.textContent = "-";
  processingTime.textContent = "-";
}

// Initialize
console.log("Image Metadata Viewer loaded successfully");
console.log("Using ExifReader library for fast EXIF extraction");
