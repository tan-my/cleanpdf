// ============================================================
// Merge PDF
// Combines several PDF files into one. Everything happens in
// the browser using pdf-lib. No file ever leaves your device.
// ============================================================

// Grab the PDFDocument class from the pdf-lib library (loaded via CDN).
const { PDFDocument } = PDFLib;

// Grab the page elements we need to work with.
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const mergeBtn = document.getElementById("mergeBtn");
const status = document.getElementById("status");

// This array keeps the PDF files the user has chosen, in order.
let files = [];

// Show a message under the button. "type" can be "", "error", or "success".
function setStatus(message, type) {
  status.textContent = message || "";
  status.className = "status" + (type ? " " + type : "");
}

// Draw the list of chosen files on the page.
function renderList() {
  fileList.innerHTML = "";

  files.forEach((file, index) => {
    const li = document.createElement("li");

    // The file name.
    const name = document.createElement("span");
    name.textContent = file.name;

    // A small button to remove this file from the list.
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "✕";
    remove.title = "Remove";
    remove.addEventListener("click", () => {
      files.splice(index, 1); // remove this file
      renderList(); // redraw the list
    });

    li.append(name, remove);
    fileList.appendChild(li);
  });

  // You need at least 2 PDFs to merge.
  mergeBtn.disabled = files.length < 2;
}

// Add newly selected files (only keep real PDFs).
function addFiles(selected) {
  let added = 0;
  let rejected = 0;

  for (const file of selected) {
    if (file.type === "application/pdf") {
      files.push(file);
      added++;
    } else {
      rejected++;
    }
  }

  // Let the user know if some files were skipped.
  if (rejected > 0 && added === 0) {
    setStatus("Those files aren't PDFs. Please choose PDF files only.", "error");
  } else if (rejected > 0) {
    setStatus(rejected + " non-PDF file(s) were skipped.", "error");
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

// The main action: merge all PDFs into one.
mergeBtn.addEventListener("click", async () => {
  // Friendly check for empty / not-enough input.
  if (files.length < 2) {
    setStatus("Please add at least two PDF files to merge.", "error");
    return;
  }

  // Show the loading state on the button while we work.
  mergeBtn.disabled = true;
  mergeBtn.classList.add("is-loading");
  setStatus("Processing locally in your browser...");

  try {
    // Create a brand new empty PDF that will hold every page.
    const mergedPdf = await PDFDocument.create();

    // Go through each chosen file in order.
    for (const file of files) {
      // Read the file into memory (stays in the browser).
      const bytes = await file.arrayBuffer();

      // Load it as a PDF.
      const pdf = await PDFDocument.load(bytes);

      // Copy all of its pages into our merged PDF.
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach((page) => mergedPdf.addPage(page));
    }

    // Save the merged PDF to raw bytes and offer it as a download.
    const mergedBytes = await mergedPdf.save();
    downloadPdf(mergedBytes, "merged.pdf");

    setStatus("Done. Your file was never uploaded.", "success");
  } catch (err) {
    // If anything goes wrong, tell the user kindly.
    console.error(err);
    setStatus(
      "Something went wrong. Make sure all files are valid, unprotected PDFs.",
      "error"
    );
  } finally {
    // Always remove the loading state when finished.
    mergeBtn.classList.remove("is-loading");
    mergeBtn.disabled = files.length < 2;
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

  // Clean up the temporary URL.
  URL.revokeObjectURL(url);
}
