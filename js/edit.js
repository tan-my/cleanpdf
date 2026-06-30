// ============================================================
// Edit PDF (annotation-based)
// Text annotations are rich, editable text boxes (draggable + resizable via
// interact.js) with font family, size, color, bold/italic/underline,
// alignment, opacity, and rotation. Highlights, rectangles, and pen strokes
// are drawn on an overlay canvas. Export uses pdf-lib on the ORIGINAL bytes:
// text stays REAL, selectable PDF text using StandardFonts (no embedded font
// files, never flattened to an image). Everything runs in the browser.
// ============================================================

(function () {
  "use strict";

  if (
    typeof window.PDFLib === "undefined" ||
    typeof window.pdfjsLib === "undefined" ||
    typeof window.interact === "undefined"
  ) {
    const el = document.getElementById("pickStatus");
    if (el) {
      el.textContent =
        "Required libraries failed to load. Check your internet connection and refresh.";
      el.className = "status tiny error";
    }
    return;
  }

  const { PDFDocument, rgb, StandardFonts, degrees } = window.PDFLib;
  const pdfjsLib = window.pdfjsLib;
  const interact = window.interact;
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

  // ------------------------------------------------------------
  // Coordinate systems & preview quality (see notes in earlier versions)
  // ------------------------------------------------------------
  const DISPLAY_SCALE = 1.5;
  const BASELINE_RATIO = 0.8;
  const TEXT_PADDING = 3; // logical px, matches .text-box-content CSS padding

  function getQualityFactor() {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(Math.max(dpr, 1) * 2, 3);
  }

  const HIGHLIGHT_RGB = rgb(1, 0.92, 0.23);
  const HIGHLIGHT_CANVAS = "rgba(255, 235, 59, 0.4)";
  const PEN_WIDTH = 2;
  const RECT_WIDTH = 2;

  // Map a font family + bold/italic to the matching pdf-lib StandardFont.
  const FONT_MAP = {
    Helvetica: {
      n: StandardFonts.Helvetica,
      b: StandardFonts.HelveticaBold,
      i: StandardFonts.HelveticaOblique,
      bi: StandardFonts.HelveticaBoldOblique,
    },
    Times: {
      n: StandardFonts.TimesRoman,
      b: StandardFonts.TimesRomanBold,
      i: StandardFonts.TimesRomanItalic,
      bi: StandardFonts.TimesRomanBoldItalic,
    },
    Courier: {
      n: StandardFonts.Courier,
      b: StandardFonts.CourierBold,
      i: StandardFonts.CourierOblique,
      bi: StandardFonts.CourierBoldOblique,
    },
  };

  function resolveStandardFont(family, bold, italic) {
    const m = FONT_MAP[family] || FONT_MAP.Helvetica;
    const key = bold && italic ? "bi" : bold ? "b" : italic ? "i" : "n";
    return m[key];
  }

  function cssFontFamily(family) {
    if (family === "Times") return "'Times New Roman', Times, serif";
    if (family === "Courier") return "'Courier New', Courier, monospace";
    return "Helvetica, Arial, sans-serif";
  }

  function hexToRgb(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
    if (!m) return rgb(0, 0, 0);
    const n = parseInt(m[1], 16);
    return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
  }

  // ---- Elements ----
  const fileInput = document.getElementById("fileInput");
  const dropzone = document.getElementById("dropzone");
  const uploadLabel = document.getElementById("uploadLabel");
  const pickStatus = document.getElementById("pickStatus");

  const emptyState = document.getElementById("emptyState");
  const pdfEditorArea = document.getElementById("pdfEditorArea");

  const toolbar = document.getElementById("toolbar");
  const undoBtn = document.getElementById("undoBtn");
  const clearBtn = document.getElementById("clearBtn");
  const toolHint = document.getElementById("toolHint");

  // Text Properties panel controls
  const fontFamilySel = document.getElementById("fontFamily");
  const fontSizeInput = document.getElementById("fontSizeInput");
  const colorPreset = document.getElementById("colorPreset");
  const colorPicker = document.getElementById("colorPicker");
  const boldBtn = document.getElementById("boldBtn");
  const italicBtn = document.getElementById("italicBtn");
  const underlineBtn = document.getElementById("underlineBtn");
  const alignLeftBtn = document.getElementById("alignLeft");
  const alignCenterBtn = document.getElementById("alignCenter");
  const alignRightBtn = document.getElementById("alignRight");
  const opacityInput = document.getElementById("opacity");
  const rotationInput = document.getElementById("rotation");
  const bringForwardBtn = document.getElementById("bringForward");
  const sendBackwardBtn = document.getElementById("sendBackward");
  const deleteBoxBtn = document.getElementById("deleteBox");
  const propsHint = document.getElementById("propsHint");

  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const pageIndicator = document.getElementById("pageIndicator");
  const annoCount = document.getElementById("annoCount");

  const pdfCanvas = document.getElementById("pdfCanvas");
  const overlay = document.getElementById("overlayCanvas");
  const annotationLayer = document.getElementById("annotationLayer");
  const pctx = pdfCanvas.getContext("2d");
  const octx = overlay.getContext("2d");

  const exportBtn = document.getElementById("exportBtn");
  const status = document.getElementById("status");

  // ---- State ----
  let pdfBytes = null;
  let pdfjsDoc = null;
  let currentPage = 1;
  let totalPages = 0;
  let isPdfLoaded = false;
  let activeTool = null;

  let rendering = false;
  let exporting = false;
  let lastObjectUrl = null;
  let overlayScale = 1;
  let idCounter = 0;

  const annotationsByPage = {};

  let selectedBoxId = null;
  let editingBoxId = null;

  let dragging = false;
  let dragStart = null;
  let activeStroke = null;

  // Default style applied to new text boxes / shape color. Updated whenever the
  // user changes a control (so the next box inherits the latest choices).
  const textDefaults = {
    fontFamily: "Helvetica",
    fontSize: 18,
    color: "#000000",
    bold: false,
    italic: false,
    underline: false,
    align: "left",
    opacity: 1,
    rotation: 0,
  };

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  function setStatus(message, type) {
    status.textContent = message || "";
    status.className = "status tiny" + (type ? " " + type : "");
  }
  function setPickStatus(message, type) {
    pickStatus.textContent = message || "";
    pickStatus.className = "status tiny" + (type ? " " + type : "");
  }
  function nextId() {
    idCounter += 1;
    return "tb" + idCounter;
  }

  function pageAnnotations() {
    if (!annotationsByPage[currentPage]) annotationsByPage[currentPage] = [];
    return annotationsByPage[currentPage];
  }
  function addAnnotation(pageNumber, annotation) {
    if (!annotationsByPage[pageNumber]) annotationsByPage[pageNumber] = [];
    annotationsByPage[pageNumber].push(annotation);
  }
  function annById(id) {
    return pageAnnotations().find((a) => a.id === id);
  }
  function removeAnnotation(id) {
    const list = pageAnnotations();
    const i = list.findIndex((a) => a.id === id);
    if (i >= 0) list.splice(i, 1);
  }

  function getPos(e) {
    const rect = annotationLayer.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  function layerWidth() {
    return parseFloat(annotationLayer.style.width) || annotationLayer.clientWidth;
  }
  function layerHeight() {
    return parseFloat(annotationLayer.style.height) || annotationLayer.clientHeight;
  }
  function normalizeBox(a, b) {
    return {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x),
      h: Math.abs(a.y - b.y),
    };
  }
  function currentColor() {
    return textDefaults.color;
  }

  function updateLoadedView() {
    if (isPdfLoaded) {
      emptyState.style.display = "none";
      pdfEditorArea.style.display = "block";
    } else {
      emptyState.style.display = "flex";
      pdfEditorArea.style.display = "none";
    }
  }

  // ------------------------------------------------------------
  // Loading a PDF
  // ------------------------------------------------------------
  fileInput.addEventListener("change", (e) => {
    if (e.target.files.length) loadPdf(e.target.files[0]);
  });
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () =>
    dropzone.classList.remove("dragover")
  );
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    if (e.dataTransfer.files.length) loadPdf(e.dataTransfer.files[0]);
  });

  async function loadPdf(file) {
    if (!file || file.type !== "application/pdf") {
      setPickStatus("That doesn't look like a PDF. Please choose a .pdf file.", "error");
      return;
    }

    finishEditing();
    setPickStatus("Loading PDF...");

    try {
      const buffer = await file.arrayBuffer();
      pdfBytes = new Uint8Array(buffer);

      pdfjsDoc = await pdfjsLib.getDocument({ data: pdfBytes.slice(0) }).promise;
      if (pdfjsDoc.numPages < 1) throw new Error("PDF has no pages");

      totalPages = pdfjsDoc.numPages;
      currentPage = 1;
      activeTool = null;
      isPdfLoaded = true;
      selectedBoxId = null;
      editingBoxId = null;

      for (const key in annotationsByPage) delete annotationsByPage[key];
      toolbar
        .querySelectorAll(".tool-button[data-tool]")
        .forEach((b) => b.classList.remove("active"));
      annotationLayer.classList.remove("draw-mode");
      toolHint.textContent = "Pick a tool from the left, then work on the page.";

      uploadLabel.textContent =
        file.name.length > 22 ? "PDF loaded ✓" : file.name;

      updateLoadedView();
      setStatus("");

      await renderPage(currentPage);
      updatePanel();
      setPickStatus("PDF loaded.", "success");
    } catch (err) {
      console.error(err);
      isPdfLoaded = false;
      updateLoadedView();
      setPickStatus(
        "Sorry, this PDF could not be opened. It may be damaged or password-protected.",
        "error"
      );
    } finally {
      fileInput.value = "";
    }
  }

  // ------------------------------------------------------------
  // Rendering a page (high-DPI preview)
  // ------------------------------------------------------------
  async function renderPage(num) {
    if (!pdfjsDoc) return;
    rendering = true;
    updateNavButtons();

    try {
      const page = await pdfjsDoc.getPage(num);
      const layoutViewport = page.getViewport({ scale: DISPLAY_SCALE });
      const quality = getQualityFactor();
      const renderViewport = page.getViewport({ scale: DISPLAY_SCALE * quality });

      const cssW = Math.floor(layoutViewport.width);
      const cssH = Math.floor(layoutViewport.height);
      const pxW = Math.floor(renderViewport.width);
      const pxH = Math.floor(renderViewport.height);

      pdfCanvas.width = pxW;
      pdfCanvas.height = pxH;
      pdfCanvas.style.width = cssW + "px";
      pdfCanvas.style.height = cssH + "px";

      overlay.width = pxW;
      overlay.height = pxH;
      overlay.style.width = cssW + "px";
      overlay.style.height = cssH + "px";

      annotationLayer.style.width = cssW + "px";
      annotationLayer.style.height = cssH + "px";

      overlayScale = pxW / cssW;

      pctx.setTransform(1, 0, 0, 1, 0, 0);
      await page.render({ canvasContext: pctx, viewport: renderViewport }).promise;

      refreshPage();
    } catch (err) {
      console.error(err);
      setStatus("Could not render this page.", "error");
    } finally {
      rendering = false;
      updatePageIndicator();
      updateNavButtons();
    }
  }

  function updatePageIndicator() {
    pageIndicator.textContent = "Page " + currentPage + " / " + totalPages;
  }
  function updateNavButtons() {
    prevBtn.disabled = rendering || exporting || currentPage <= 1;
    nextBtn.disabled = rendering || exporting || currentPage >= totalPages;
  }

  async function goToPage(target) {
    if (rendering || exporting) return;
    if (target < 1 || target > totalPages) return;
    finishEditing();
    deselectAll();
    currentPage = target;
    await renderPage(currentPage);
    updatePanel();
  }
  prevBtn.addEventListener("click", () => goToPage(currentPage - 1));
  nextBtn.addEventListener("click", () => goToPage(currentPage + 1));

  // ------------------------------------------------------------
  // Tool selection
  // ------------------------------------------------------------
  function setActiveTool(tool) {
    finishEditing();
    activeTool = tool;
    toolbar.querySelectorAll(".tool-button[data-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });

    const drawMode = tool === "highlight" || tool === "rect" || tool === "pen";
    annotationLayer.classList.toggle("draw-mode", drawMode);
    if (drawMode) deselectAll();

    const hints = {
      text: "Click on the page to add a text box, then type.",
      highlight: "Drag on the page to highlight an area.",
      pen: "Drag on the page to draw freehand.",
      rect: "Drag on the page to draw a rectangle.",
      stamp: "Click on the page to add a signature / stamp box.",
    };
    toolHint.textContent = hints[tool] || "";
    setStatus(hints[tool] || "");
  }
  toolbar.querySelectorAll(".tool-button[data-tool]").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTool(btn.dataset.tool));
  });

  undoBtn.addEventListener("click", () => {
    finishEditing();
    const list = pageAnnotations();
    if (list.length) {
      list.pop();
      deselectAll();
      refreshPage();
    }
  });
  clearBtn.addEventListener("click", () => {
    editingBoxId = null;
    annotationsByPage[currentPage] = [];
    deselectAll();
    refreshPage();
  });

  // ------------------------------------------------------------
  // Full page refresh: canvas shapes + text boxes + count
  // ------------------------------------------------------------
  function refreshPage() {
    renderCanvasAnnotations();
    syncTextBoxes();
    updateAnnoCount();
  }
  function updateAnnoCount() {
    const n = pageAnnotations().length;
    annoCount.textContent =
      n === 0
        ? "No annotations on this page yet."
        : n + (n === 1 ? " annotation" : " annotations") + " on this page.";
  }

  // ---- Canvas shapes ----
  function renderCanvasAnnotations() {
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.setTransform(overlayScale, 0, 0, overlayScale, 0, 0);
    for (const a of pageAnnotations()) drawShape(a);
  }
  function drawShape(a) {
    if (a.type === "highlight") {
      octx.fillStyle = HIGHLIGHT_CANVAS;
      octx.fillRect(a.x, a.y, a.w, a.h);
    } else if (a.type === "rect") {
      octx.strokeStyle = a.color;
      octx.lineWidth = RECT_WIDTH;
      octx.strokeRect(a.x, a.y, a.w, a.h);
    } else if (a.type === "pen") {
      octx.strokeStyle = a.color;
      octx.lineWidth = PEN_WIDTH;
      octx.lineJoin = "round";
      octx.lineCap = "round";
      octx.beginPath();
      a.points.forEach((p, i) => {
        if (i === 0) octx.moveTo(p.x, p.y);
        else octx.lineTo(p.x, p.y);
      });
      octx.stroke();
    }
  }

  // ------------------------------------------------------------
  // Text boxes (type "text") — interact.js powered
  // ------------------------------------------------------------
  function boxElById(id) {
    return annotationLayer.querySelector('.text-box[data-id="' + id + '"]');
  }

  function syncTextBoxes() {
    annotationLayer.querySelectorAll(".text-box").forEach((el) => {
      interact(el).unset();
      el.remove();
    });
    for (const a of pageAnnotations()) {
      if (a.type === "text") createTextBoxElement(a);
    }
    if (selectedBoxId) {
      const el = boxElById(selectedBoxId);
      if (el) el.classList.add("selected");
    }
  }

  function applyBoxRect(el, a) {
    el.style.left = a.x + "px";
    el.style.top = a.y + "px";
    el.style.width = a.width + "px";
    el.style.height = a.height + "px";
  }

  // Apply every typographic property to the DOM box (live WYSIWYG).
  function applyBoxVisualStyle(el, a) {
    const content = el.querySelector(".text-box-content");
    content.style.fontFamily = cssFontFamily(a.fontFamily);
    content.style.fontSize = a.fontSize + "px";
    content.style.color = a.color;
    content.style.fontWeight = a.bold ? "700" : "400";
    content.style.fontStyle = a.italic ? "italic" : "normal";
    content.style.textDecoration = a.underline ? "underline" : "none";
    content.style.textAlign = a.align || "left";
    el.style.opacity = a.opacity == null ? 1 : a.opacity;
    el.style.transformOrigin = "top left";
    el.style.transform = a.rotation ? "rotate(" + a.rotation + "deg)" : "";
  }

  function createTextBoxElement(a) {
    const box = document.createElement("div");
    box.className = "text-box";
    box.dataset.id = a.id;
    applyBoxRect(box, a);

    const content = document.createElement("div");
    content.className = "text-box-content";
    content.textContent = a.text;
    box.appendChild(content);

    ["nw", "ne", "sw", "se"].forEach((c) => {
      const h = document.createElement("div");
      h.className = "tb-handle tb-" + c;
      box.appendChild(h);
    });

    annotationLayer.appendChild(box);
    applyBoxVisualStyle(box, a);

    interact(box)
      .draggable({
        listeners: {
          move(event) {
            const ann = annById(event.target.dataset.id);
            if (!ann) return;
            ann.x += event.dx;
            ann.y += event.dy;
            applyBoxRect(event.target, ann);
          },
        },
        modifiers: [interact.modifiers.restrictRect({ restriction: "parent" })],
      })
      .resizable({
        edges: { top: true, left: true, bottom: true, right: true },
        margin: 10,
        listeners: {
          move(event) {
            const ann = annById(event.target.dataset.id);
            if (!ann) return;
            ann.width = event.rect.width;
            ann.height = event.rect.height;
            ann.x += event.deltaRect.left;
            ann.y += event.deltaRect.top;
            applyBoxRect(event.target, ann);
          },
        },
        modifiers: [
          interact.modifiers.restrictEdges({ outer: "parent" }),
          interact.modifiers.restrictSize({ min: { width: 40, height: 24 } }),
        ],
      })
      .on("tap", () => {
        if (editingBoxId && editingBoxId !== a.id) finishEditing();
        selectBox(a.id);
        updatePanel();
      })
      .on("doubletap", () => {
        enterEdit(a.id);
        updatePanel();
      });

    return box;
  }

  function selectBox(id) {
    selectedBoxId = id;
    annotationLayer.querySelectorAll(".text-box").forEach((el) => {
      el.classList.toggle("selected", el.dataset.id === id);
    });
  }
  function deselectAll() {
    if (editingBoxId) finishEditing();
    selectedBoxId = null;
    annotationLayer
      .querySelectorAll(".text-box.selected")
      .forEach((el) => el.classList.remove("selected"));
    updatePanel();
  }

  function enterEdit(id) {
    if (editingBoxId && editingBoxId !== id) finishEditing();
    const box = boxElById(id);
    const ann = annById(id);
    if (!box || !ann) return;

    editingBoxId = id;
    selectBox(id);
    box.classList.add("editing");
    interact(box).draggable(false);

    const content = box.querySelector(".text-box-content");
    content.contentEditable = "true";
    content.focus();
    placeCaretEnd(content);
    setStatus("Editing text. Click outside to finish.");
  }

  function finishEditing() {
    if (!editingBoxId) return;
    const id = editingBoxId;
    editingBoxId = null;

    const box = boxElById(id);
    const ann = annById(id);
    if (box) {
      const content = box.querySelector(".text-box-content");
      content.contentEditable = "false";
      box.classList.remove("editing");
      interact(box).draggable(true);
      if (ann) ann.text = (content.innerText || "").replace(/\n+$/, "");
    }
    if (ann && !ann.text.trim()) {
      removeAnnotation(id);
      if (selectedBoxId === id) selectedBoxId = null;
      syncTextBoxes();
    }
    updateAnnoCount();
  }

  function placeCaretEnd(el) {
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }

  function createTextBoxAt(pos, tool) {
    const a = {
      id: nextId(),
      page: currentPage,
      type: "text",
      x: 0,
      y: 0,
      width: 180,
      height: Math.max(40, Math.round(textDefaults.fontSize * 1.8)),
      text: "",
      fontFamily: textDefaults.fontFamily,
      fontStyle: "normal",
      fontSize: textDefaults.fontSize,
      color: textDefaults.color,
      bold: textDefaults.bold,
      italic: textDefaults.italic,
      underline: textDefaults.underline,
      align: textDefaults.align,
      opacity: 1,
      rotation: 0,
    };
    // Stamp tool preset: italic serif signature look.
    if (tool === "stamp") {
      a.italic = true;
      a.fontFamily = "Times";
    }

    const maxX = layerWidth() - a.width;
    const maxY = layerHeight() - a.height;
    a.x = Math.max(0, Math.min(pos.x, maxX));
    a.y = Math.max(0, Math.min(pos.y, maxY));

    addAnnotation(currentPage, a);
    syncTextBoxes();
    selectBox(a.id);
    enterEdit(a.id);
    updatePanel();
    updateAnnoCount();
  }

  // ------------------------------------------------------------
  // Text Properties panel
  // ------------------------------------------------------------
  // The active style target is the selected box, or the shared defaults when
  // nothing is selected (so users can set style BEFORE creating a box).
  function activeStyleTarget() {
    return selectedBoxId ? annById(selectedBoxId) : textDefaults;
  }

  // Write a property to the selected box (live) and remember it as the default
  // for new boxes. Some props (opacity/rotation) are per-box only.
  function setProp(prop, value, perBoxOnly) {
    const ann = selectedBoxId ? annById(selectedBoxId) : null;
    if (ann) {
      ann[prop] = value;
      const el = boxElById(ann.id);
      if (el) applyBoxVisualStyle(el, ann);
    }
    if (!perBoxOnly) textDefaults[prop] = value;
  }

  function reflectToggles() {
    const st = activeStyleTarget();
    boldBtn.classList.toggle("active", !!st.bold);
    italicBtn.classList.toggle("active", !!st.italic);
    underlineBtn.classList.toggle("active", !!st.underline);
    alignLeftBtn.classList.toggle("active", (st.align || "left") === "left");
    alignCenterBtn.classList.toggle("active", st.align === "center");
    alignRightBtn.classList.toggle("active", st.align === "right");
  }

  // Sync all panel controls from the active target (called on selection change).
  function updatePanel() {
    const st = activeStyleTarget();
    const hasBox = !!selectedBoxId;

    fontFamilySel.value = st.fontFamily || "Helvetica";
    fontSizeInput.value = st.fontSize || 18;
    colorPicker.value = /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : "#000000";
    // Match a preset name, else show "Custom…".
    let matched = "custom";
    for (const opt of colorPreset.options) {
      if (opt.value.toLowerCase() === (st.color || "").toLowerCase()) {
        matched = opt.value;
        break;
      }
    }
    colorPreset.value = matched;

    opacityInput.value = Math.round((st.opacity == null ? 1 : st.opacity) * 100);
    rotationInput.value = st.rotation || 0;

    reflectToggles();

    // Per-box-only controls are disabled with no selection.
    [opacityInput, rotationInput, bringForwardBtn, sendBackwardBtn, deleteBoxBtn].forEach(
      (el) => (el.disabled = !hasBox)
    );
    propsHint.textContent = hasBox
      ? "Editing the selected text box."
      : "These settings apply to the next text box you add.";
  }

  // ---- Panel event wiring ----
  fontFamilySel.addEventListener("change", () =>
    setProp("fontFamily", fontFamilySel.value)
  );
  fontSizeInput.addEventListener("input", () => {
    let v = parseInt(fontSizeInput.value, 10);
    if (isNaN(v)) return;
    v = Math.max(4, Math.min(300, v));
    setProp("fontSize", v);
  });
  colorPreset.addEventListener("change", () => {
    if (colorPreset.value === "custom") {
      colorPicker.click && colorPicker.click();
      return;
    }
    colorPicker.value = colorPreset.value;
    setProp("color", colorPreset.value);
  });
  colorPicker.addEventListener("input", () => {
    setProp("color", colorPicker.value);
    // Reflect whether it matches a named preset.
    let matched = "custom";
    for (const opt of colorPreset.options) {
      if (opt.value.toLowerCase() === colorPicker.value.toLowerCase()) {
        matched = opt.value;
        break;
      }
    }
    colorPreset.value = matched;
  });

  boldBtn.addEventListener("click", () => {
    setProp("bold", !activeStyleTarget().bold);
    reflectToggles();
  });
  italicBtn.addEventListener("click", () => {
    setProp("italic", !activeStyleTarget().italic);
    reflectToggles();
  });
  underlineBtn.addEventListener("click", () => {
    setProp("underline", !activeStyleTarget().underline);
    reflectToggles();
  });
  alignLeftBtn.addEventListener("click", () => {
    setProp("align", "left");
    reflectToggles();
  });
  alignCenterBtn.addEventListener("click", () => {
    setProp("align", "center");
    reflectToggles();
  });
  alignRightBtn.addEventListener("click", () => {
    setProp("align", "right");
    reflectToggles();
  });

  opacityInput.addEventListener("input", () =>
    setProp("opacity", parseInt(opacityInput.value, 10) / 100, true)
  );
  rotationInput.addEventListener("input", () => {
    let v = parseInt(rotationInput.value, 10);
    if (isNaN(v)) v = 0;
    setProp("rotation", v, true);
  });

  bringForwardBtn.addEventListener("click", () => reorderSelected(1));
  sendBackwardBtn.addEventListener("click", () => reorderSelected(-1));
  deleteBoxBtn.addEventListener("click", () => {
    if (!selectedBoxId) return;
    editingBoxId = null;
    removeAnnotation(selectedBoxId);
    selectedBoxId = null;
    refreshPage();
    updatePanel();
  });

  // Move the selected annotation up/down the page's z-order (array order).
  function reorderSelected(dir) {
    if (!selectedBoxId) return;
    const list = pageAnnotations();
    const i = list.findIndex((a) => a.id === selectedBoxId);
    if (i < 0) return;
    const j = i + dir;
    if (j < 0 || j >= list.length) return;
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    refreshPage();
  }

  // ------------------------------------------------------------
  // Pointer interaction on the layer (shapes + empty clicks)
  // ------------------------------------------------------------
  annotationLayer.addEventListener("pointerdown", (e) => {
    if (!isPdfLoaded || rendering || exporting) return;
    if (e.target !== annotationLayer && e.target !== overlay) return;
    if (activeTool !== "highlight" && activeTool !== "rect" && activeTool !== "pen") {
      return;
    }
    const pos = getPos(e);
    dragging = true;
    dragStart = pos;
    annotationLayer.setPointerCapture(e.pointerId);
    if (activeTool === "pen") {
      activeStroke = { type: "pen", id: nextId(), color: currentColor(), points: [pos] };
    }
  });

  annotationLayer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const pos = getPos(e);
    if (activeTool === "pen") {
      activeStroke.points.push(pos);
      renderCanvasAnnotations();
      drawShape(activeStroke);
    } else {
      const box = normalizeBox(dragStart, pos);
      renderCanvasAnnotations();
      if (activeTool === "highlight") {
        octx.fillStyle = HIGHLIGHT_CANVAS;
        octx.fillRect(box.x, box.y, box.w, box.h);
      } else {
        octx.strokeStyle = currentColor();
        octx.lineWidth = RECT_WIDTH;
        octx.strokeRect(box.x, box.y, box.w, box.h);
      }
    }
  });

  function finishDrag(e) {
    if (!dragging) return;
    dragging = false;
    const pos = getPos(e);
    if (activeTool === "pen") {
      if (activeStroke && activeStroke.points.length > 1) {
        addAnnotation(currentPage, activeStroke);
        setStatus("Annotation added.", "success");
      }
      activeStroke = null;
    } else {
      const box = normalizeBox(dragStart, pos);
      if (box.w > 3 && box.h > 3) {
        if (activeTool === "highlight") {
          addAnnotation(currentPage, { type: "highlight", id: nextId(), ...box });
        } else {
          addAnnotation(currentPage, {
            type: "rect",
            id: nextId(),
            color: currentColor(),
            ...box,
          });
        }
        setStatus("Annotation added.", "success");
      }
    }
    renderCanvasAnnotations();
    updateAnnoCount();
  }
  annotationLayer.addEventListener("pointerup", finishDrag);
  annotationLayer.addEventListener("pointercancel", finishDrag);

  annotationLayer.addEventListener("click", (e) => {
    if (e.target !== annotationLayer && e.target !== overlay) return;
    if (!isPdfLoaded) return;

    const wasEditing = editingBoxId !== null;
    finishEditing();
    if (wasEditing) return;

    if (activeTool === "text" || activeTool === "stamp") {
      createTextBoxAt(getPos(e), activeTool);
    } else {
      deselectAll();
    }
  });

  // ------------------------------------------------------------
  // Export with pdf-lib
  // ------------------------------------------------------------
  exportBtn.addEventListener("click", async () => {
    finishEditing();
    if (!isPdfLoaded || !pdfBytes) {
      setStatus("Please load a PDF first.", "error");
      return;
    }
    if (exporting) return;

    exporting = true;
    setBusy(true);
    setStatus("Exporting locally...");

    try {
      const pdfDoc = await PDFDocument.load(pdfBytes);

      // Embed only the StandardFonts actually used by text annotations.
      const fontByName = {};
      for (const key in annotationsByPage) {
        for (const a of annotationsByPage[key]) {
          if (a.type === "text") {
            const name = resolveStandardFont(a.fontFamily, a.bold, a.italic);
            if (!fontByName[name]) fontByName[name] = await pdfDoc.embedFont(name);
          }
        }
      }

      const pages = pdfDoc.getPages();
      for (const pageNumStr in annotationsByPage) {
        const pageNum = parseInt(pageNumStr, 10);
        const page = pages[pageNum - 1];
        if (!page) continue;

        const pageWidth = page.getWidth();
        const pageHeight = page.getHeight();
        const canvasWidth = pageWidth * DISPLAY_SCALE;
        const canvasHeight = pageHeight * DISPLAY_SCALE;
        const dims = { pageWidth, pageHeight, canvasWidth, canvasHeight };

        for (const a of annotationsByPage[pageNum]) {
          applyAnnotation(page, a, dims, fontByName);
        }
      }

      const editedBytes = await pdfDoc.save();
      downloadPdf(editedBytes, "edited.pdf");
      setStatus("Done. Your PDF was never uploaded.", "success");
    } catch (err) {
      console.error(err);
      setStatus("Export failed. The PDF may be protected or unsupported.", "error");
    } finally {
      exporting = false;
      setBusy(false);
    }
  });

  function applyAnnotation(page, a, dims, fontByName) {
    const { pageWidth, pageHeight, canvasWidth, canvasHeight } = dims;
    const toX = (cx) => (cx / canvasWidth) * pageWidth;
    const toY = (cy) => pageHeight - (cy / canvasHeight) * pageHeight;

    if (a.type === "text") {
      const font = fontByName[resolveStandardFont(a.fontFamily, a.bold, a.italic)];
      drawWrappedText(page, a, dims, font);
    } else if (a.type === "highlight") {
      page.drawRectangle({
        x: toX(a.x),
        y: toY(a.y + a.h),
        width: (a.w / canvasWidth) * pageWidth,
        height: (a.h / canvasHeight) * pageHeight,
        color: HIGHLIGHT_RGB,
        opacity: 0.4,
      });
    } else if (a.type === "rect") {
      page.drawRectangle({
        x: toX(a.x),
        y: toY(a.y + a.h),
        width: (a.w / canvasWidth) * pageWidth,
        height: (a.h / canvasHeight) * pageHeight,
        borderColor: hexToRgb(a.color),
        borderWidth: RECT_WIDTH / DISPLAY_SCALE,
      });
    } else if (a.type === "pen") {
      for (let i = 1; i < a.points.length; i++) {
        const p0 = a.points[i - 1];
        const p1 = a.points[i];
        page.drawLine({
          start: { x: toX(p0.x), y: toY(p0.y) },
          end: { x: toX(p1.x), y: toY(p1.y) },
          thickness: PEN_WIDTH / DISPLAY_SCALE,
          color: hexToRgb(a.color),
        });
      }
    }
  }

  function sanitizeForFont(str) {
    let out = "";
    for (const ch of str) out += ch.charCodeAt(0) <= 255 ? ch : "";
    return out;
  }

  // Word-wrap to the box width and draw real PDF text. Honors alignment,
  // color, opacity, underline, and rotation (about the box's top-left).
  function drawWrappedText(page, a, dims, font) {
    const { pageHeight } = dims;
    const s = DISPLAY_SCALE;

    const fontSize = a.fontSize / s;
    const lineHeight = fontSize * 1.2;
    const pad = TEXT_PADDING / s;
    const maxWidth = a.width / s - pad * 2;
    const color = hexToRgb(a.color);
    const opacity = a.opacity == null ? 1 : a.opacity;
    const align = a.align || "left";

    // PDF anchor = box top-left. We lay lines out relative to it, then rotate.
    const anchorX = a.x / s;
    const anchorY = pageHeight - a.y / s;
    const phi = (-(a.rotation || 0) * Math.PI) / 180; // CSS clockwise -> PDF CCW
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const boxBottomOffset = a.height / s; // downward extent for the box

    const text = sanitizeForFont(a.text);
    if (!text.trim()) return;

    // Wrap each paragraph to the box width.
    const lines = [];
    for (const para of text.split("\n")) {
      const words = para.split(/\s+/).filter((w) => w.length);
      if (!words.length) {
        lines.push("");
        continue;
      }
      let line = "";
      for (const word of words) {
        const test = line ? line + " " + word : word;
        if (font.widthOfTextAtSize(test, fontSize) > maxWidth && line) {
          lines.push(line);
          line = word;
        } else {
          line = test;
        }
      }
      if (line) lines.push(line);
    }

    // Map a point given by (rightOffset, downOffset) from the anchor into a
    // rotated PDF coordinate.
    const place = (right, down) => {
      const rx = right;
      const ry = -down; // down in screen space = negative Y in PDF
      return {
        x: anchorX + (rx * cos - ry * sin),
        y: anchorY + (rx * sin + ry * cos),
      };
    };

    let down = pad + fontSize * BASELINE_RATIO; // first baseline
    for (const line of lines) {
      if (down - fontSize * BASELINE_RATIO > boxBottomOffset) break; // past bottom
      if (line) {
        const lineWidth = font.widthOfTextAtSize(line, fontSize);
        let right = pad;
        if (align === "center") right = pad + (maxWidth - lineWidth) / 2;
        else if (align === "right") right = pad + (maxWidth - lineWidth);

        const pos = place(right, down);
        page.drawText(line, {
          x: pos.x,
          y: pos.y,
          size: fontSize,
          font: font,
          color: color,
          opacity: opacity,
          rotate: degrees(-(a.rotation || 0)),
        });

        if (a.underline) {
          const u1 = place(right, down + fontSize * 0.12);
          const u2 = place(right + lineWidth, down + fontSize * 0.12);
          page.drawLine({
            start: u1,
            end: u2,
            thickness: Math.max(0.5, fontSize * 0.06),
            color: color,
            opacity: opacity,
          });
        }
      }
      down += lineHeight;
    }
  }

  function setBusy(busy) {
    exportBtn.disabled = busy;
    exportBtn.classList.toggle("is-loading", busy);
    toolbar.querySelectorAll("button").forEach((b) => (b.disabled = busy));
    undoBtn.disabled = busy;
    clearBtn.disabled = busy;
    updateNavButtons();
  }

  function downloadPdf(bytes, filename) {
    if (lastObjectUrl) {
      URL.revokeObjectURL(lastObjectUrl);
      lastObjectUrl = null;
    }
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    lastObjectUrl = url;

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  window.addEventListener("beforeunload", () => {
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  });

  updateLoadedView();
  updatePanel();
})();
