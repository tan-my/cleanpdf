// ============================================================
// Rotate PDF
// Rotates every page of a single PDF: left 90°, right 90°,
// or 180°. Everything happens in the browser using pdf-lib.
// ============================================================

// Grab what we need from the pdf-lib library (loaded via CDN).
const { PDFDocument, degrees } = PDFLib;

// Grab the page elements we need to work with.
const dropzone = document.getElementById("dropzone");
const fileInput = document.getElementById("fileInput");
const fileList = document.getElementById("fileList");
const angleSelect = document.getElementById("angle");
const rotateBtn = document.getElementById("rotateBtn");
const status = document.getElementById("status");

// This tool works on a single PDF file.
let file = null;

// Show a message under the button. "type" can be "", "error", or "success".
function setStatus(message, type) {
  status.textContent = message || "";
  status.className = "status" + (type ? " " + type : "");
}

// Draw the chosen file on the page (or nothing if none).
function renderList() {
  fileList.innerHTML = "";

  if (file) {
    const li = document.createElement("li");

    const name = document.createElement("span");
    name.textContent = file.name;

    const remove = document.createElement("button");
    remove.className = "remove";
    remove.textContent = "✕";
    remove.title = "Remove";
    remove.addEventListener("click", () => {
      file = null;
      renderList();
    });

    li.append(name, remove);
    fileList.appendChild(li);
  }

  // Need a file before we can rotate.
  rotateBtn.disabled = !file;
}

// Keep the first PDF the user selected.
function setFile(selected) {
  let found = false;

  for (const f of selected) {
    if (f.type === "application/pdf") {
      file = f;
      found = true;
      break;
    }
  }

  // If they dropped something that wasn't a PDF, let them know.
  if (!found && selected.length > 0) {
    setStatus("That file isn't a PDF. Please choose a PDF file.", "error");
  } else {
    setStatus("");
  }

  renderList();
}

// When the user picks a file with the file dialog.
fileInput.addEventListener("change", (e) => setFile(e.target.files));

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
  setFile(e.dataTransfer.files);
});

// Convert the dropdown choice into a number of degrees to turn.
function getTurnDegrees(choice) {
  if (choice === "left") return 270; // left 90° is the same as 270° clockwise
  if (choice === "right") return 90;
  return 180;
}

// The main action: rotate every page and download the result.
rotateBtn.addEventListener("click", async () => {
  // Friendly check for empty input.
  if (!file) {
    setStatus("Please add a PDF file first.", "error");
    return;
  }

  // Show the loading state on the button while we work.
  rotateBtn.disabled = true;
  rotateBtn.classList.add("is-loading");
  setStatus("Processing locally in your browser...");

  try {
    const turn = getTurnDegrees(angleSelect.value);

    // Read the file into memory (stays in the browser).
    const bytes = await file.arrayBuffer();

    // Load it as a PDF.
    const pdf = await PDFDocument.load(bytes);

    // Rotate each page, adding to whatever rotation it already had.
    pdf.getPages().forEach((page) => {
      const current = page.getRotation().angle;
      page.setRotation(degrees((current + turn) % 360));
    });

    // Save the rotated PDF and offer it as a download.
    const rotatedBytes = await pdf.save();
    downloadPdf(rotatedBytes, "rotated.pdf");

    setStatus("Done. Your file was never uploaded.", "success");
  } catch (err) {
    console.error(err);
    setStatus(
      "Something went wrong. Make sure the file is a valid, unprotected PDF.",
      "error"
    );
  } finally {
    // Always remove the loading state when finished.
    rotateBtn.classList.remove("is-loading");
    rotateBtn.disabled = !file;
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
