// ============================================================
// Images to PDF
// Turns JPG/JPEG/PNG images into a PDF, one image per page.
// Each image is fitted onto an A4 page while keeping its
// aspect ratio. Everything happens in the browser.
// ============================================================

// Grab the PDFDocument class from the pdf-lib library (loaded via CDN).
const { PDFDocument } = PDFLib;

// A4 page size in PDF points (1 point = 1/72 inch).
const A4_WIDTH = 595.28;
const A4_HEIGHT = 841.89;
const MARGIN = 20; // small margin around each image

// Grab the page elements we need to work with.
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const convertBtn = document.getElementById("convertBtn");
const status = document.getElementById("status");

// This array keeps the images the user has chosen, in order.
let files = [];

// Show a message under the button. "type" can be "", "error", or "success".
function setStatus(message, type) {
  status.textContent = message || "";
  status.className = "status" + (type ? " " + type : "");
}

// Draw the list of chosen images on the page.
function renderList() {
  fileList.innerHTML = "";

  files.forEach((file, index) => {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.textContent = file.name;

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "✕";
    remove.title = "Remove";
    remove.addEventListener("click", () => {
      files.splice(index, 1);
      renderList();
    });

    li.append(name, remove);
    fileList.appendChild(li);
  });

  // Need at least one image to make a PDF.
  convertBtn.disabled = files.length === 0;
}

// Add newly selected files (only keep JPG/JPEG/PNG images).
function addFiles(selected) {
  let added = 0;
  let rejected = 0;

  for (const file of selected) {
    if (file.type === "image/png" || file.type === "image/jpeg") {
      files.push(file);
      added++;
    } else {
      rejected++;
    }
  }

  // Let the user know if some files were skipped.
  if (rejected > 0 && added === 0) {
    setStatus("Please choose JPG, JPEG, or PNG images only.", "error");
  } else if (rejected > 0) {
    setStatus(rejected + " unsupported file(s) were skipped.", "error");
  } else {
    setStatus("");
  }

  renderList();
}

// When the user picks files with the file dialog.
fileInput.addEventListener("change", (e) => addFiles(e.target.files));

// Allow drag & drop onto the dropzone.
dropzone.addEventListener("dragover", (e) => {
  e.preventDefault();
  dropzone.classList.add("dragover");
});
dropzone.addEventListener("dragleave", () => {
  dropzone.classList.remove("dragover");
});
dropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  dropzone.classList.remove("dragover");
  addFiles(e.dataTransfer.files);
});

// The main action: build a PDF with one image per A4 page.
convertBtn.addEventListener("click", async () => {
  // Friendly check for empty input.
  if (files.length === 0) {
    setStatus("Please add at least one image first.", "error");
    return;
  }

  // Show the loading state on the button while we work.
  convertBtn.disabled = true;
  convertBtn.classList.add("is-loading");
  setStatus("Processing locally in your browser...");

  try {
    // Create a brand new empty PDF.
    const pdf = await PDFDocument.create();

    // Go through each chosen image in order.
    for (const file of files) {
      // Read the image into memory (stays in the browser).
      const bytes = await file.arrayBuffer();

      // Embed the image into the PDF (PNG or JPG).
      const image =
        file.type === "image/png"
          ? await pdf.embedPng(bytes)
          : await pdf.embedJpg(bytes);

      // Add an A4 page.
      const page = pdf.addPage([A4_WIDTH, A4_HEIGHT]);

      // Figure out the largest size the image can be while
      // fitting inside the page margins and keeping its shape.
      const maxWidth = A4_WIDTH - MARGIN * 2;
      const maxHeight = A4_HEIGHT - MARGIN * 2;
      const scale = Math.min(
        maxWidth / image.width,
        maxHeight / image.height
      );
      const drawWidth = image.width * scale;
      const drawHeight = image.height * scale;

      // Center the image on the page.
      const x = (A4_WIDTH - drawWidth) / 2;
      const y = (A4_HEIGHT - drawHeight) / 2;

      page.drawImage(image, {
        x: x,
        y: y,
        width: drawWidth,
        height: drawHeight,
      });
    }

    // Save the PDF to raw bytes and offer it as a download.
    const pdfBytes = await pdf.save();
    downloadPdf(pdfBytes, "images.pdf");

    setStatus("Done. Your file was never uploaded.", "success");
  } catch (err) {
    console.error(err);
    setStatus(
      "Something went wrong. Please use valid JPG or PNG images.",
      "error"
    );
  } finally {
    // Always remove the loading state when finished.
    convertBtn.classList.remove("is-loading");
    convertBtn.disabled = files.length === 0;
  }
});

// Turn raw PDF bytes into a file the browser downloads.
// Uses a Blob + object URL so nothing is ever sent to a server.
function downloadPdf(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();

  URL.revokeObjectURL(url);
}
