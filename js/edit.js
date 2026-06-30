// ============================================================
// Edit PDF (annotation-based)
// Tools: Select, Text (rich editable boxes), Pen, Highlight, Shapes
// (vector SVG: rectangle, rounded rect, circle, ellipse, triangle,
// diamond, arrow, line, star), and Signature. Text + Shapes are
// editable DOM elements (interact.js drag/resize); Pen/Highlight are
// drawn on a canvas. Export uses pdf-lib on the ORIGINAL bytes so text
// stays real and shapes stay vector (never rasterized). Undo/Redo,
// copy/paste, and Delete are supported. Everything runs in the browser.
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
  const SVGNS = "http://www.w3.org/2000/svg";
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";

  const DISPLAY_SCALE = 1.5;
  const BASELINE_RATIO = 0.8;
  const TEXT_PADDING = 3;

  function getQualityFactor() {
    const dpr = window.devicePixelRatio || 1;
    return Math.min(Math.max(dpr, 1) * 2, 3);
  }

  const HIGHLIGHT_RGB = rgb(1, 0.92, 0.23);
  const HIGHLIGHT_CANVAS = "rgba(255, 235, 59, 0.4)";
  const PEN_WIDTH = 2;

  // Shared color presets (used by both text and shape pickers).
  const COLOR_PRESETS = [
    { name: "Black", hex: "#000000" },
    { name: "White", hex: "#ffffff" },
    { name: "Gray", hex: "#808080" },
    { name: "Blue", hex: "#1d4ed8" },
    { name: "Red", hex: "#dc2626" },
    { name: "Green", hex: "#16a34a" },
    { name: "Orange", hex: "#ea580c" },
    { name: "Purple", hex: "#7c3aed" },
    { name: "Yellow", hex: "#eab308" },
    { name: "Pink", hex: "#ec4899" },
    { name: "Brown", hex: "#92400e" },
  ];

  // ---- Fonts (text) ----
  const FONT_MAP = {
    Helvetica: {
      n: StandardFonts.Helvetica, b: StandardFonts.HelveticaBold,
      i: StandardFonts.HelveticaOblique, bi: StandardFonts.HelveticaBoldOblique,
    },
    Times: {
      n: StandardFonts.TimesRoman, b: StandardFonts.TimesRomanBold,
      i: StandardFonts.TimesRomanItalic, bi: StandardFonts.TimesRomanBoldItalic,
    },
    Courier: {
      n: StandardFonts.Courier, b: StandardFonts.CourierBold,
      i: StandardFonts.CourierOblique, bi: StandardFonts.CourierBoldOblique,
    },
  };
  function resolveStandardFont(family, bold, italic) {
    const m = FONT_MAP[family] || FONT_MAP.Helvetica;
    return m[bold && italic ? "bi" : bold ? "b" : italic ? "i" : "n"];
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
  const shapesBtn = document.getElementById("shapesBtn");
  const shapeGrid = document.getElementById("shapeGrid");
  const shapesCaret = document.getElementById("shapesCaret");
  const toolHint = document.getElementById("toolHint");

  // Text panel
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

  // Shape panel
  const fillPreset = document.getElementById("fillPreset");
  const fillPicker = document.getElementById("fillPicker");
  const strokePreset = document.getElementById("strokePreset");
  const strokePicker = document.getElementById("strokePicker");
  const borderWidthSel = document.getElementById("borderWidth");
  const shapeOpacityInput = document.getElementById("shapeOpacity");
  const cornerRadiusRow = document.getElementById("cornerRadiusRow");
  const cornerRadiusInput = document.getElementById("cornerRadius");
  const shapeRotationInput = document.getElementById("shapeRotation");
  const sBringForward = document.getElementById("sBringForward");
  const sSendBackward = document.getElementById("sSendBackward");
  const sToFront = document.getElementById("sToFront");
  const sToBack = document.getElementById("sToBack");
  const sDuplicate = document.getElementById("sDuplicate");
  const sDelete = document.getElementById("sDelete");
  const shapeHint = document.getElementById("shapeHint");

  const prevBtn = document.getElementById("prevBtn");
  const nextBtn = document.getElementById("nextBtn");
  const pageIndicator = document.getElementById("pageIndicator");
  const annoCount = document.getElementById("annoCount");

  const pdfCanvas = document.getElementById("pdfCanvas");
  const overlay = document.getElementById("overlayCanvas");
  const annotationLayer = document.getElementById("annotationLayer");
  const pctx = pdfCanvas.getContext("2d");
  const octx = overlay.getContext("2d");

  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  const exportBtn = document.getElementById("exportBtn");
  const status = document.getElementById("status");

  // ---- State ----
  let pdfBytes = null;
  let pdfjsDoc = null;
  let currentPage = 1;
  let totalPages = 0;
  let isPdfLoaded = false;
  let activeTool = "select";
  let currentShape = "rect";

  let rendering = false;
  let exporting = false;
  let lastObjectUrl = null;
  let overlayScale = 1;
  let idCounter = 0;

  const annotationsByPage = {};

  let selectedId = null;
  let editingBoxId = null;

  let dragging = false;
  let dragStart = null;
  let activeStroke = null;

  // History (snapshot-per-commit with an index) + clipboard
  let history = [];
  let histIndex = -1;
  let clipboard = null;

  const textDefaults = {
    fontFamily: "Helvetica", fontSize: 18, color: "#000000",
    bold: false, italic: false, underline: false, align: "left",
    opacity: 1, rotation: 0,
  };
  const shapeDefaults = {
    fillColor: "#1d4ed8", strokeColor: "#000000", strokeWidth: 2,
    opacity: 1, cornerRadius: 12, rotation: 0,
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
    return "an" + idCounter;
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
  function selectedAnn() {
    return selectedId ? annById(selectedId) : null;
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
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y),
    };
  }
  function updateLoadedView() {
    emptyState.style.display = isPdfLoaded ? "none" : "flex";
    pdfEditorArea.style.display = isPdfLoaded ? "block" : "none";
  }

  // ------------------------------------------------------------
  // History (Undo / Redo)
  // ------------------------------------------------------------
  function snapshot() {
    return JSON.stringify(annotationsByPage);
  }
  function restore(s) {
    const obj = JSON.parse(s);
    for (const k in annotationsByPage) delete annotationsByPage[k];
    Object.assign(annotationsByPage, obj);
  }
  function resetHistory() {
    history = [snapshot()];
    histIndex = 0;
    updateUndoRedo();
  }
  // Record the current state as a new history step (call AFTER a change).
  function commit() {
    history = history.slice(0, histIndex + 1);
    history.push(snapshot());
    if (history.length > 200) history.shift();
    histIndex = history.length - 1;
    updateUndoRedo();
  }
  function doUndo() {
    if (histIndex <= 0) return;
    finishEditing();
    histIndex -= 1;
    restore(history[histIndex]);
    afterHistory();
  }
  function doRedo() {
    if (histIndex >= history.length - 1) return;
    histIndex += 1;
    restore(history[histIndex]);
    afterHistory();
  }
  function afterHistory() {
    selectedId = null;
    editingBoxId = null;
    refreshPage();
    updatePanels();
    updateUndoRedo();
  }
  function updateUndoRedo() {
    undoBtn.disabled = histIndex <= 0 || exporting;
    redoBtn.disabled = histIndex >= history.length - 1 || exporting;
  }
  undoBtn.addEventListener("click", doUndo);
  redoBtn.addEventListener("click", doRedo);

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
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
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
      isPdfLoaded = true;
      selectedId = null;
      editingBoxId = null;

      for (const key in annotationsByPage) delete annotationsByPage[key];
      setActiveTool("select");
      uploadLabel.textContent = file.name.length > 22 ? "PDF loaded ✓" : file.name;

      updateLoadedView();
      setStatus("");
      await renderPage(currentPage);
      resetHistory();
      updatePanels();
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

      pdfCanvas.width = pxW; pdfCanvas.height = pxH;
      pdfCanvas.style.width = cssW + "px"; pdfCanvas.style.height = cssH + "px";
      overlay.width = pxW; overlay.height = pxH;
      overlay.style.width = cssW + "px"; overlay.style.height = cssH + "px";
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
    updatePanels();
  }
  prevBtn.addEventListener("click", () => goToPage(currentPage - 1));
  nextBtn.addEventListener("click", () => goToPage(currentPage + 1));

  // ------------------------------------------------------------
  // Tools
  // ------------------------------------------------------------
  function setActiveTool(tool) {
    finishEditing();
    activeTool = tool;
    toolbar.querySelectorAll(".tool-button[data-tool]").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.tool === tool);
    });
    const drawMode = tool === "pen" || tool === "highlight" || tool === "shape";
    annotationLayer.classList.toggle("draw-mode", drawMode);
    if (drawMode) deselectAll();

    const hints = {
      select: "Click a text box or shape to select it.",
      text: "Click on the page to add a text box, then type.",
      pen: "Drag on the page to draw freehand.",
      highlight: "Drag on the page to highlight an area.",
      shape: "Drag on the page to draw a " + currentShape + ".",
      stamp: "Click on the page to add a signature box.",
    };
    toolHint.textContent = hints[tool] || "";
    setStatus(hints[tool] || "");
  }
  toolbar.querySelectorAll(".tool-button[data-tool]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      if (btn.id === "shapesBtn") {
        // Toggle the shape grid open/closed; also activate the shape tool.
        const isHidden = shapeGrid.classList.toggle("hidden");
        shapesCaret.textContent = isHidden ? "▶" : "▼";
        shapesBtn.setAttribute("aria-expanded", String(!isHidden));
        setActiveTool("shape");
        e.stopPropagation();
        return;
      }
      setActiveTool(btn.dataset.tool);
    });
  });
  shapeGrid.querySelectorAll(".shape-opt").forEach((opt) => {
    opt.addEventListener("click", () => {
      currentShape = opt.dataset.shape;
      shapeGrid.querySelectorAll(".shape-opt").forEach((o) =>
        o.classList.toggle("active", o === opt)
      );
      setActiveTool("shape");
    });
  });
  // Close shape grid when clicking elsewhere.
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".shape-tool-wrap")) {
      shapeGrid.classList.add("hidden");
      shapesCaret.textContent = "▶";
      shapesBtn.setAttribute("aria-expanded", "false");
    }
  });

  // ------------------------------------------------------------
  // Full page refresh
  // ------------------------------------------------------------
  function refreshPage() {
    renderCanvasAnnotations();
    syncBoxes();
    updateAnnoCount();
  }
  function updateAnnoCount() {
    const n = pageAnnotations().length;
    annoCount.textContent =
      n === 0 ? "No annotations on this page yet."
        : n + (n === 1 ? " annotation" : " annotations") + " on this page.";
  }

  // ---- Canvas: pen + highlight ----
  function renderCanvasAnnotations() {
    octx.setTransform(1, 0, 0, 1, 0, 0);
    octx.clearRect(0, 0, overlay.width, overlay.height);
    octx.setTransform(overlayScale, 0, 0, overlayScale, 0, 0);
    for (const a of pageAnnotations()) drawCanvasShape(a);
  }
  function drawCanvasShape(a) {
    if (a.type === "highlight") {
      octx.fillStyle = HIGHLIGHT_CANVAS;
      octx.fillRect(a.x, a.y, a.w, a.h);
    } else if (a.type === "pen") {
      octx.strokeStyle = a.color;
      octx.lineWidth = PEN_WIDTH;
      octx.lineJoin = "round";
      octx.lineCap = "round";
      octx.beginPath();
      a.points.forEach((p, i) => (i === 0 ? octx.moveTo(p.x, p.y) : octx.lineTo(p.x, p.y)));
      octx.stroke();
    }
  }

  // ------------------------------------------------------------
  // DOM boxes (text + shapes): create / sync / select
  // ------------------------------------------------------------
  function boxElById(id) {
    return annotationLayer.querySelector('.ann-box[data-id="' + id + '"]');
  }
  function applyBoxRect(el, a) {
    el.style.left = a.x + "px";
    el.style.top = a.y + "px";
    el.style.width = a.width + "px";
    el.style.height = a.height + "px";
    el.style.zIndex = a.zIndex || 0;
  }

  // Rebuild every text box + shape from the current page (z-order = array order).
  function syncBoxes() {
    annotationLayer.querySelectorAll(".ann-box").forEach((el) => {
      interact(el).unset();
      el.remove();
    });
    pageAnnotations().forEach((a, idx) => {
      a.zIndex = idx;
      if (a.type === "text") createTextBoxElement(a);
      else if (a.type === "shape") createShapeElement(a);
    });
    if (selectedId) {
      const el = boxElById(selectedId);
      if (el) el.classList.add("selected");
    }
  }

  function addHandles(box) {
    ["nw", "ne", "sw", "se"].forEach((c) => {
      const h = document.createElement("div");
      h.className = "tb-handle tb-" + c;
      box.appendChild(h);
    });
  }

  function setupInteract(box, onResize) {
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
          end() {
            commit();
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
            if (onResize) onResize(event.target, ann);
          },
          end() {
            commit();
          },
        },
        modifiers: [
          interact.modifiers.restrictEdges({ outer: "parent" }),
          interact.modifiers.restrictSize({ min: { width: 16, height: 16 } }),
        ],
      });
  }

  function selectBox(id) {
    selectedId = id;
    annotationLayer.querySelectorAll(".ann-box").forEach((el) => {
      el.classList.toggle("selected", el.dataset.id === id);
    });
  }
  function deselectAll() {
    if (editingBoxId) finishEditing();
    selectedId = null;
    annotationLayer.querySelectorAll(".ann-box.selected").forEach((el) =>
      el.classList.remove("selected")
    );
    updatePanels();
  }

  // ---- Text boxes ----
  function createTextBoxElement(a) {
    const box = document.createElement("div");
    box.className = "text-box ann-box";
    box.dataset.id = a.id;
    applyBoxRect(box, a);

    const content = document.createElement("div");
    content.className = "text-box-content";
    content.textContent = a.text;
    box.appendChild(content);
    addHandles(box);
    annotationLayer.appendChild(box);
    applyTextVisual(box, a);

    setupInteract(box, null);
    interact(box)
      .on("tap", () => {
        if (editingBoxId && editingBoxId !== a.id) finishEditing();
        selectBox(a.id);
        updatePanels();
      })
      .on("doubletap", () => {
        enterEdit(a.id);
        updatePanels();
      });
    return box;
  }
  function applyTextVisual(el, a) {
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
  function enterEdit(id) {
    if (editingBoxId && editingBoxId !== id) finishEditing();
    const box = boxElById(id);
    const ann = annById(id);
    if (!box || !ann || ann.type !== "text") return;
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
    let changed = false;
    if (box) {
      const content = box.querySelector(".text-box-content");
      content.contentEditable = "false";
      box.classList.remove("editing");
      interact(box).draggable(true);
      if (ann) {
        const newText = (content.innerText || "").replace(/\n+$/, "");
        if (newText !== ann.text) changed = true;
        ann.text = newText;
      }
    }
    if (ann && !ann.text.trim()) {
      removeAnnotation(id);
      if (selectedId === id) selectedId = null;
      syncBoxes();
      changed = true;
    }
    updateAnnoCount();
    if (changed) commit();
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
      id: nextId(), page: currentPage, type: "text",
      x: 0, y: 0, width: 180,
      height: Math.max(40, Math.round(textDefaults.fontSize * 1.8)),
      text: "", fontFamily: textDefaults.fontFamily, fontStyle: "normal",
      fontSize: textDefaults.fontSize, color: textDefaults.color,
      bold: textDefaults.bold, italic: textDefaults.italic,
      underline: textDefaults.underline, align: textDefaults.align,
      opacity: 1, rotation: 0, zIndex: pageAnnotations().length,
    };
    if (tool === "stamp") { a.italic = true; a.fontFamily = "Times"; }
    a.x = Math.max(0, Math.min(pos.x, layerWidth() - a.width));
    a.y = Math.max(0, Math.min(pos.y, layerHeight() - a.height));
    addAnnotation(currentPage, a);
    syncBoxes();
    selectBox(a.id);
    enterEdit(a.id);
    updatePanels();
    updateAnnoCount();
    // committed on finishEditing if it ends up with text
  }

  // ---- Shapes (SVG) ----
  function starPointsNorm() {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const ang = ((-90 + i * 36) * Math.PI) / 180;
      const r = i % 2 === 0 ? 0.5 : 0.21;
      pts.push([0.5 + r * Math.cos(ang), 0.5 + r * Math.sin(ang)]);
    }
    return pts;
  }
  function polygonNorm(kind) {
    if (kind === "triangle") return [[0.5, 0], [1, 1], [0, 1]];
    if (kind === "diamond") return [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]];
    if (kind === "arrow")
      return [[0, 0.3], [0.6, 0.3], [0.6, 0.08], [1, 0.5], [0.6, 0.92], [0.6, 0.7], [0, 0.7]];
    if (kind === "star") return starPointsNorm();
    return null;
  }
  function mapPolygon(norm, w, h, pad) {
    return norm.map(([nx, ny]) => [
      +(pad + nx * (w - 2 * pad)).toFixed(2),
      +(pad + ny * (h - 2 * pad)).toFixed(2),
    ]);
  }
  function buildShapeInnerSVG(a) {
    const w = a.width, h = a.height, sw = a.strokeWidth || 0;
    const pad = sw / 2 + 0.5;
    const sAttr =
      'fill="' + a.fillColor + '" stroke="' + a.strokeColor +
      '" stroke-width="' + sw + '"';
    switch (a.shape) {
      case "rect":
        return '<rect x="' + pad + '" y="' + pad + '" width="' + Math.max(0, w - 2 * pad) +
          '" height="' + Math.max(0, h - 2 * pad) + '" ' + sAttr + "/>";
      case "roundRect": {
        const cr = Math.max(0, Math.min(a.cornerRadius || 0, Math.min(w, h) / 2 - pad));
        return '<rect x="' + pad + '" y="' + pad + '" width="' + Math.max(0, w - 2 * pad) +
          '" height="' + Math.max(0, h - 2 * pad) + '" rx="' + cr + '" ry="' + cr + '" ' + sAttr + "/>";
      }
      case "circle": {
        const r = Math.max(0, Math.min(w, h) / 2 - pad);
        return '<circle cx="' + w / 2 + '" cy="' + h / 2 + '" r="' + r + '" ' + sAttr + "/>";
      }
      case "ellipse":
        return '<ellipse cx="' + w / 2 + '" cy="' + h / 2 + '" rx="' + Math.max(0, w / 2 - pad) +
          '" ry="' + Math.max(0, h / 2 - pad) + '" ' + sAttr + "/>";
      case "line":
        return '<line x1="' + pad + '" y1="' + pad + '" x2="' + (w - pad) + '" y2="' + (h - pad) +
          '" stroke="' + a.strokeColor + '" stroke-width="' + sw + '" stroke-linecap="round"/>';
      case "triangle":
      case "diamond":
      case "arrow":
      case "star": {
        const pts = mapPolygon(polygonNorm(a.shape), w, h, pad);
        return '<polygon points="' + pts.map((p) => p.join(",")).join(" ") + '" ' + sAttr + "/>";
      }
      default:
        return "";
    }
  }
  function applyShapeVisual(el, a) {
    const svg = el.querySelector("svg");
    svg.setAttribute("width", a.width);
    svg.setAttribute("height", a.height);
    svg.style.opacity = a.opacity == null ? 1 : a.opacity;
    svg.innerHTML = buildShapeInnerSVG(a);
    el.style.transformOrigin = "top left";
    el.style.transform = a.rotation ? "rotate(" + a.rotation + "deg)" : "";
  }
  function createShapeElement(a) {
    const box = document.createElement("div");
    box.className = "shape-box ann-box";
    box.dataset.id = a.id;
    applyBoxRect(box, a);
    const svg = document.createElementNS(SVGNS, "svg");
    svg.setAttribute("class", "shape-svg");
    box.appendChild(svg);
    addHandles(box);
    annotationLayer.appendChild(box);
    applyShapeVisual(box, a);

    setupInteract(box, (el, ann) => applyShapeVisual(el, ann));
    interact(box).on("tap", () => {
      selectBox(a.id);
      updatePanels();
    });
    return box;
  }
  function createShapeAt(box) {
    const a = {
      id: nextId(), page: currentPage, type: "shape", shape: currentShape,
      x: box.x, y: box.y, width: Math.max(8, box.w), height: Math.max(8, box.h),
      fillColor: shapeDefaults.fillColor, strokeColor: shapeDefaults.strokeColor,
      strokeWidth: shapeDefaults.strokeWidth, opacity: shapeDefaults.opacity,
      rotation: 0, cornerRadius: shapeDefaults.cornerRadius,
      zIndex: pageAnnotations().length,
    };
    addAnnotation(currentPage, a);
    syncBoxes();
    selectBox(a.id);
    updatePanels();
    updateAnnoCount();
    setStatus("Shape added.", "success");
    commit();
  }

  // ------------------------------------------------------------
  // Properties panels
  // ------------------------------------------------------------
  function fillColorSelect(sel) {
    sel.innerHTML = "";
    COLOR_PRESETS.forEach((c) => {
      const o = document.createElement("option");
      o.value = c.hex; o.textContent = c.name;
      sel.appendChild(o);
    });
    const custom = document.createElement("option");
    custom.value = "custom"; custom.textContent = "Custom…";
    sel.appendChild(custom);
  }
  fillColorSelect(colorPreset);
  fillColorSelect(fillPreset);
  fillColorSelect(strokePreset);
  function matchPreset(sel, hex) {
    let matched = "custom";
    for (const opt of sel.options) {
      if (opt.value.toLowerCase() === (hex || "").toLowerCase()) { matched = opt.value; break; }
    }
    sel.value = matched;
  }

  function updatePanels() {
    updateTextPanel();
    updateShapePanel();
  }

  // ---- Text panel ----
  function textTarget() {
    const a = selectedAnn();
    return a && a.type === "text" ? a : textDefaults;
  }
  function reflectTextToggles() {
    const st = textTarget();
    boldBtn.classList.toggle("active", !!st.bold);
    italicBtn.classList.toggle("active", !!st.italic);
    underlineBtn.classList.toggle("active", !!st.underline);
    alignLeftBtn.classList.toggle("active", (st.align || "left") === "left");
    alignCenterBtn.classList.toggle("active", st.align === "center");
    alignRightBtn.classList.toggle("active", st.align === "right");
  }
  function updateTextPanel() {
    const st = textTarget();
    const sel = selectedAnn();
    const hasText = !!(sel && sel.type === "text");
    fontFamilySel.value = st.fontFamily || "Helvetica";
    fontSizeInput.value = st.fontSize || 18;
    colorPicker.value = /^#[0-9a-f]{6}$/i.test(st.color) ? st.color : "#000000";
    matchPreset(colorPreset, st.color);
    opacityInput.value = Math.round((st.opacity == null ? 1 : st.opacity) * 100);
    rotationInput.value = st.rotation || 0;
    reflectTextToggles();
    [opacityInput, rotationInput, bringForwardBtn, sendBackwardBtn, deleteBoxBtn].forEach(
      (el) => (el.disabled = !hasText)
    );
    propsHint.textContent = hasText
      ? "Editing the selected text box."
      : "These settings apply to the next text box you add.";
  }
  function setTextProp(prop, value, perBoxOnly) {
    const a = selectedAnn();
    if (a && a.type === "text") {
      a[prop] = value;
      const el = boxElById(a.id);
      if (el) applyTextVisual(el, a);
    }
    if (!perBoxOnly) textDefaults[prop] = value;
  }

  fontFamilySel.addEventListener("change", () => { setTextProp("fontFamily", fontFamilySel.value); commit(); });
  fontSizeInput.addEventListener("input", () => {
    let v = parseInt(fontSizeInput.value, 10);
    if (isNaN(v)) return;
    setTextProp("fontSize", Math.max(4, Math.min(300, v)));
  });
  fontSizeInput.addEventListener("change", commit);
  colorPreset.addEventListener("change", () => {
    if (colorPreset.value === "custom") { colorPicker.click && colorPicker.click(); return; }
    colorPicker.value = colorPreset.value;
    setTextProp("color", colorPreset.value); commit();
  });
  colorPicker.addEventListener("input", () => { setTextProp("color", colorPicker.value); matchPreset(colorPreset, colorPicker.value); });
  colorPicker.addEventListener("change", commit);
  boldBtn.addEventListener("click", () => { setTextProp("bold", !textTarget().bold); reflectTextToggles(); commit(); });
  italicBtn.addEventListener("click", () => { setTextProp("italic", !textTarget().italic); reflectTextToggles(); commit(); });
  underlineBtn.addEventListener("click", () => { setTextProp("underline", !textTarget().underline); reflectTextToggles(); commit(); });
  alignLeftBtn.addEventListener("click", () => { setTextProp("align", "left"); reflectTextToggles(); commit(); });
  alignCenterBtn.addEventListener("click", () => { setTextProp("align", "center"); reflectTextToggles(); commit(); });
  alignRightBtn.addEventListener("click", () => { setTextProp("align", "right"); reflectTextToggles(); commit(); });
  opacityInput.addEventListener("input", () => setTextProp("opacity", parseInt(opacityInput.value, 10) / 100, true));
  opacityInput.addEventListener("change", commit);
  rotationInput.addEventListener("input", () => {
    let v = parseInt(rotationInput.value, 10);
    setTextProp("rotation", isNaN(v) ? 0 : v, true);
  });
  rotationInput.addEventListener("change", commit);
  bringForwardBtn.addEventListener("click", () => reorderSelected(1));
  sendBackwardBtn.addEventListener("click", () => reorderSelected(-1));
  deleteBoxBtn.addEventListener("click", deleteSelected);

  // ---- Shape panel ----
  function shapeTarget() {
    const a = selectedAnn();
    return a && a.type === "shape" ? a : shapeDefaults;
  }
  function updateShapePanel() {
    const st = shapeTarget();
    const sel = selectedAnn();
    const hasShape = !!(sel && sel.type === "shape");
    fillPicker.value = /^#[0-9a-f]{6}$/i.test(st.fillColor) ? st.fillColor : "#1d4ed8";
    matchPreset(fillPreset, st.fillColor);
    strokePicker.value = /^#[0-9a-f]{6}$/i.test(st.strokeColor) ? st.strokeColor : "#000000";
    matchPreset(strokePreset, st.strokeColor);
    borderWidthSel.value = String(st.strokeWidth == null ? 2 : st.strokeWidth);
    shapeOpacityInput.value = Math.round((st.opacity == null ? 1 : st.opacity) * 100);
    shapeRotationInput.value = st.rotation || 0;
    cornerRadiusInput.value = st.cornerRadius == null ? 12 : st.cornerRadius;

    // Corner radius only relevant for rounded rectangles.
    const showCorner = (hasShape && sel.shape === "roundRect") || (!hasShape && currentShape === "roundRect");
    cornerRadiusRow.hidden = !showCorner;

    [shapeRotationInput, sBringForward, sSendBackward, sToFront, sToBack, sDuplicate, sDelete].forEach(
      (el) => (el.disabled = !hasShape)
    );
    shapeHint.textContent = hasShape
      ? "Editing the selected shape."
      : "These settings apply to the next shape you draw.";
  }
  function setShapeProp(prop, value, perShapeOnly) {
    const a = selectedAnn();
    if (a && a.type === "shape") {
      a[prop] = value;
      const el = boxElById(a.id);
      if (el) applyShapeVisual(el, a);
    }
    if (!perShapeOnly) shapeDefaults[prop] = value;
  }
  fillPreset.addEventListener("change", () => {
    if (fillPreset.value === "custom") { fillPicker.click && fillPicker.click(); return; }
    fillPicker.value = fillPreset.value;
    setShapeProp("fillColor", fillPreset.value); commit();
  });
  fillPicker.addEventListener("input", () => { setShapeProp("fillColor", fillPicker.value); matchPreset(fillPreset, fillPicker.value); });
  fillPicker.addEventListener("change", commit);
  strokePreset.addEventListener("change", () => {
    if (strokePreset.value === "custom") { strokePicker.click && strokePicker.click(); return; }
    strokePicker.value = strokePreset.value;
    setShapeProp("strokeColor", strokePreset.value); commit();
  });
  strokePicker.addEventListener("input", () => { setShapeProp("strokeColor", strokePicker.value); matchPreset(strokePreset, strokePicker.value); });
  strokePicker.addEventListener("change", commit);
  borderWidthSel.addEventListener("change", () => { setShapeProp("strokeWidth", parseInt(borderWidthSel.value, 10)); commit(); });
  shapeOpacityInput.addEventListener("input", () => setShapeProp("opacity", parseInt(shapeOpacityInput.value, 10) / 100));
  shapeOpacityInput.addEventListener("change", commit);
  cornerRadiusInput.addEventListener("input", () => {
    let v = parseInt(cornerRadiusInput.value, 10);
    setShapeProp("cornerRadius", isNaN(v) ? 0 : Math.max(0, v));
  });
  cornerRadiusInput.addEventListener("change", commit);
  shapeRotationInput.addEventListener("input", () => {
    let v = parseInt(shapeRotationInput.value, 10);
    setShapeProp("rotation", isNaN(v) ? 0 : v, true);
  });
  shapeRotationInput.addEventListener("change", commit);
  sBringForward.addEventListener("click", () => reorderSelected(1));
  sSendBackward.addEventListener("click", () => reorderSelected(-1));
  sToFront.addEventListener("click", () => reorderSelected("front"));
  sToBack.addEventListener("click", () => reorderSelected("back"));
  sDuplicate.addEventListener("click", duplicateSelected);
  sDelete.addEventListener("click", deleteSelected);

  // ---- Shared selection actions ----
  function reorderSelected(dir) {
    if (!selectedId) return;
    const list = pageAnnotations();
    const i = list.findIndex((a) => a.id === selectedId);
    if (i < 0) return;
    const [item] = list.splice(i, 1);
    let j;
    if (dir === "front") j = list.length;
    else if (dir === "back") j = 0;
    else j = Math.max(0, Math.min(list.length, i + dir));
    list.splice(j, 0, item);
    syncBoxes();
    commit();
  }
  function deleteSelected() {
    if (!selectedId) return;
    editingBoxId = null;
    removeAnnotation(selectedId);
    selectedId = null;
    refreshPage();
    updatePanels();
    commit();
  }
  function duplicateSelected() {
    const a = selectedAnn();
    if (!a) return;
    const clone = JSON.parse(JSON.stringify(a));
    clone.id = nextId();
    clone.x = Math.min(a.x + 14, layerWidth() - (a.width || 20));
    clone.y = Math.min(a.y + 14, layerHeight() - (a.height || 20));
    clone.zIndex = pageAnnotations().length;
    addAnnotation(currentPage, clone);
    syncBoxes();
    selectBox(clone.id);
    updatePanels();
    updateAnnoCount();
    commit();
  }

  // ------------------------------------------------------------
  // Pointer interaction on the layer (draw tools + empty clicks)
  // ------------------------------------------------------------
  annotationLayer.addEventListener("pointerdown", (e) => {
    if (!isPdfLoaded || rendering || exporting) return;
    if (e.target !== annotationLayer && e.target !== overlay) return;
    if (activeTool !== "pen" && activeTool !== "highlight" && activeTool !== "shape") return;
    dragging = true;
    dragStart = getPos(e);
    annotationLayer.setPointerCapture(e.pointerId);
    if (activeTool === "pen") {
      activeStroke = { type: "pen", id: nextId(), color: shapeDefaults.strokeColor, points: [dragStart] };
    }
  });
  annotationLayer.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    const pos = getPos(e);
    if (activeTool === "pen") {
      activeStroke.points.push(pos);
      renderCanvasAnnotations();
      drawCanvasShape(activeStroke);
    } else {
      const box = normalizeBox(dragStart, pos);
      renderCanvasAnnotations();
      if (activeTool === "highlight") {
        octx.fillStyle = HIGHLIGHT_CANVAS;
        octx.fillRect(box.x, box.y, box.w, box.h);
      } else {
        // shape preview: dashed bounding rect
        octx.save();
        octx.strokeStyle = "#1d4ed8";
        octx.setLineDash([6, 4]);
        octx.lineWidth = 1;
        octx.strokeRect(box.x, box.y, box.w, box.h);
        octx.restore();
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
        commit();
        setStatus("Annotation added.", "success");
      }
      activeStroke = null;
      renderCanvasAnnotations();
    } else if (activeTool === "highlight") {
      const box = normalizeBox(dragStart, pos);
      if (box.w > 3 && box.h > 3) {
        addAnnotation(currentPage, { type: "highlight", id: nextId(), ...box });
        commit();
        setStatus("Annotation added.", "success");
      }
      renderCanvasAnnotations();
    } else if (activeTool === "shape") {
      const box = normalizeBox(dragStart, pos);
      renderCanvasAnnotations();
      if (box.w > 5 && box.h > 5) createShapeAt(box);
    }
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
  // Keyboard: Delete, Ctrl+C / V / Z / Y
  // ------------------------------------------------------------
  document.addEventListener("keydown", (e) => {
    if (!isPdfLoaded) return;
    // Don't hijack typing in inputs or while editing a text box.
    const ae = document.activeElement;
    const inField =
      ae &&
      (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA" ||
        ae.tagName === "SELECT" || ae.isContentEditable);
    if (inField || editingBoxId) return;

    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && e.key.toLowerCase() === "z" && !e.shiftKey) {
      e.preventDefault(); doUndo();
    } else if (ctrl && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) {
      e.preventDefault(); doRedo();
    } else if (ctrl && e.key.toLowerCase() === "c") {
      const a = selectedAnn();
      if (a) { clipboard = JSON.parse(JSON.stringify(a)); setStatus("Copied.", "success"); }
    } else if (ctrl && e.key.toLowerCase() === "v") {
      if (clipboard) pasteClipboard();
    } else if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedId) { e.preventDefault(); deleteSelected(); }
    }
  });
  function pasteClipboard() {
    const clone = JSON.parse(JSON.stringify(clipboard));
    clone.id = nextId();
    clone.page = currentPage;
    if (clone.type === "pen") {
      clone.points = clone.points.map((p) => ({ x: p.x + 14, y: p.y + 14 }));
    } else if (clone.x != null) {
      clone.x = Math.min((clone.x || 0) + 14, layerWidth() - (clone.width || 20));
      clone.y = Math.min((clone.y || 0) + 14, layerHeight() - (clone.height || 20));
    }
    clone.zIndex = pageAnnotations().length;
    addAnnotation(currentPage, clone);
    refreshPage();
    if (clone.type === "text" || clone.type === "shape") selectBox(clone.id);
    updatePanels();
    commit();
    setStatus("Pasted.", "success");
  }

  // ------------------------------------------------------------
  // Export with pdf-lib
  // ------------------------------------------------------------
  exportBtn.addEventListener("click", async () => {
    finishEditing();
    if (!isPdfLoaded || !pdfBytes) { setStatus("Please load a PDF first.", "error"); return; }
    if (exporting) return;
    exporting = true;
    setBusy(true);
    setStatus("Exporting locally...");
    try {
      const pdfDoc = await PDFDocument.load(pdfBytes);
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
      drawWrappedText(page, a, dims, fontByName[resolveStandardFont(a.fontFamily, a.bold, a.italic)]);
    } else if (a.type === "highlight") {
      page.drawRectangle({
        x: toX(a.x), y: toY(a.y + a.h),
        width: (a.w / canvasWidth) * pageWidth,
        height: (a.h / canvasHeight) * pageHeight,
        color: HIGHLIGHT_RGB, opacity: 0.4,
      });
    } else if (a.type === "pen") {
      for (let i = 1; i < a.points.length; i++) {
        const p0 = a.points[i - 1], p1 = a.points[i];
        page.drawLine({
          start: { x: toX(p0.x), y: toY(p0.y) },
          end: { x: toX(p1.x), y: toY(p1.y) },
          thickness: PEN_WIDTH / DISPLAY_SCALE, color: hexToRgb(a.color),
        });
      }
    } else if (a.type === "shape") {
      drawShapeToPdf(page, a, dims);
    }
  }

  // ---- Shape export (vector) ----
  function drawShapeToPdf(page, a, dims) {
    const { pageHeight } = dims;
    const s = DISPLAY_SCALE;
    const leftPt = a.x / s;
    const topPt = pageHeight - a.y / s;
    const wPt = a.width / s;
    const hPt = a.height / s;
    const swPt = (a.strokeWidth || 0) / s;
    const pad = swPt / 2;
    const fill = hexToRgb(a.fillColor);
    const stroke = hexToRgb(a.strokeColor);
    const op = a.opacity == null ? 1 : a.opacity;
    const rot = degrees(-(a.rotation || 0));
    const hasStroke = (a.strokeWidth || 0) > 0;

    if (a.shape === "circle" || a.shape === "ellipse") {
      const cx = leftPt + wPt / 2;
      const cy = topPt - hPt / 2;
      let rx = wPt / 2 - pad, ry = hPt / 2 - pad;
      if (a.shape === "circle") { rx = ry = Math.min(wPt, hPt) / 2 - pad; }
      const opts = {
        x: cx, y: cy, xScale: Math.max(0, rx), yScale: Math.max(0, ry),
        color: fill, opacity: op, rotate: rot,
      };
      if (hasStroke) { opts.borderColor = stroke; opts.borderWidth = swPt; opts.borderOpacity = op; }
      page.drawEllipse(opts);
      return;
    }
    if (a.shape === "line") {
      // Diagonal of the box (top-left -> bottom-right).
      page.drawLine({
        start: { x: leftPt + pad, y: topPt - pad },
        end: { x: leftPt + wPt - pad, y: topPt - (hPt - pad) },
        thickness: Math.max(0.5, swPt), color: stroke, opacity: op,
      });
      return;
    }

    // Path-based shapes (rect, roundRect, triangle, diamond, arrow, star).
    const path = buildShapePath(a, wPt, hPt, pad);
    const opts = {
      x: leftPt, y: topPt, color: fill, opacity: op, rotate: rot,
    };
    if (hasStroke) { opts.borderColor = stroke; opts.borderWidth = swPt; opts.borderOpacity = op; }
    page.drawSvgPath(path, opts);
  }

  // Build an SVG path (in PDF points, y measured DOWN from the box top) for
  // drawSvgPath. drawSvgPath places the origin at (x,y) and draws downward.
  function buildShapePath(a, w, h, pad) {
    if (a.shape === "rect") {
      const x0 = pad, y0 = pad, x1 = w - pad, y1 = h - pad;
      return "M " + x0 + " " + y0 + " L " + x1 + " " + y0 + " L " + x1 + " " + y1 +
        " L " + x0 + " " + y1 + " Z";
    }
    if (a.shape === "roundRect") {
      let r = Math.min((a.cornerRadius || 0) / DISPLAY_SCALE, Math.min(w, h) / 2 - pad);
      r = Math.max(0, r);
      const x0 = pad, y0 = pad, x1 = w - pad, y1 = h - pad;
      return (
        "M " + (x0 + r) + " " + y0 +
        " L " + (x1 - r) + " " + y0 + " Q " + x1 + " " + y0 + " " + x1 + " " + (y0 + r) +
        " L " + x1 + " " + (y1 - r) + " Q " + x1 + " " + y1 + " " + (x1 - r) + " " + y1 +
        " L " + (x0 + r) + " " + y1 + " Q " + x0 + " " + y1 + " " + x0 + " " + (y1 - r) +
        " L " + x0 + " " + (y0 + r) + " Q " + x0 + " " + y0 + " " + (x0 + r) + " " + y0 + " Z"
      );
    }
    // Polygons
    const norm = polygonNorm(a.shape);
    const pts = norm.map(([nx, ny]) => [pad + nx * (w - 2 * pad), pad + ny * (h - 2 * pad)]);
    return pts.map((p, i) => (i === 0 ? "M " : "L ") + p[0] + " " + p[1]).join(" ") + " Z";
  }

  function sanitizeForFont(str) {
    let out = "";
    for (const ch of str) out += ch.charCodeAt(0) <= 255 ? ch : "";
    return out;
  }
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
    const anchorX = a.x / s;
    const anchorY = pageHeight - a.y / s;
    const phi = (-(a.rotation || 0) * Math.PI) / 180;
    const cos = Math.cos(phi), sin = Math.sin(phi);
    const boxBottomOffset = a.height / s;
    const text = sanitizeForFont(a.text);
    if (!text.trim()) return;

    const lines = [];
    for (const para of text.split("\n")) {
      const words = para.split(/\s+/).filter((w) => w.length);
      if (!words.length) { lines.push(""); continue; }
      let line = "";
      for (const word of words) {
        const test = line ? line + " " + word : word;
        if (font.widthOfTextAtSize(test, fontSize) > maxWidth && line) { lines.push(line); line = word; }
        else line = test;
      }
      if (line) lines.push(line);
    }
    const place = (right, down) => {
      const rx = right, ry = -down;
      return { x: anchorX + (rx * cos - ry * sin), y: anchorY + (rx * sin + ry * cos) };
    };
    let down = pad + fontSize * BASELINE_RATIO;
    for (const line of lines) {
      if (down - fontSize * BASELINE_RATIO > boxBottomOffset) break;
      if (line) {
        const lineWidth = font.widthOfTextAtSize(line, fontSize);
        let right = pad;
        if (align === "center") right = pad + (maxWidth - lineWidth) / 2;
        else if (align === "right") right = pad + (maxWidth - lineWidth);
        const pos = place(right, down);
        page.drawText(line, {
          x: pos.x, y: pos.y, size: fontSize, font: font, color: color,
          opacity: opacity, rotate: degrees(-(a.rotation || 0)),
        });
        if (a.underline) {
          const u1 = place(right, down + fontSize * 0.12);
          const u2 = place(right + lineWidth, down + fontSize * 0.12);
          page.drawLine({ start: u1, end: u2, thickness: Math.max(0.5, fontSize * 0.06), color: color, opacity: opacity });
        }
      }
      down += lineHeight;
    }
  }

  function setBusy(busy) {
    exportBtn.disabled = busy;
    exportBtn.classList.toggle("is-loading", busy);
    toolbar.querySelectorAll("button").forEach((b) => (b.disabled = busy));
    updateNavButtons();
    updateUndoRedo();
  }
  function downloadPdf(bytes, filename) {
    if (lastObjectUrl) { URL.revokeObjectURL(lastObjectUrl); lastObjectUrl = null; }
    const blob = new Blob([bytes], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    lastObjectUrl = url;
    const link = document.createElement("a");
    link.href = url; link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }
  window.addEventListener("beforeunload", () => {
    if (lastObjectUrl) URL.revokeObjectURL(lastObjectUrl);
  });

  // Collapsible property panels: clicking the header toggles its body and
  // flips the caret (▼ open -> ▶ collapsed).
  document.querySelectorAll(".sidebar-group.collapsible .group-header").forEach((h) => {
    h.addEventListener("click", () => {
      const group = h.closest(".sidebar-group");
      const collapsed = group.classList.toggle("collapsed");
      h.setAttribute("aria-expanded", String(!collapsed));
      const caret = h.querySelector(".group-caret");
      if (caret) caret.textContent = collapsed ? "▶" : "▼";
    });
  });

  // Shape grid starts collapsed until the user opens it.
  shapeGrid.classList.add("hidden");
  shapesCaret.textContent = "▶";
  shapesBtn.setAttribute("aria-expanded", "false");

  updateLoadedView();
  updatePanels();
  updateUndoRedo();
})();
