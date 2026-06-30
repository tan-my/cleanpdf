<<<<<<< HEAD
# CleanPDF

Free, ad-free, privacy-first PDF tools that run entirely in the browser.

CleanPDF is a static web app with no backend. Every file you open is processed
locally on your device and is never uploaded to any server.

## Features

- **Merge PDF files** — combine multiple PDFs into a single document.
- **Convert images to PDF** — turn JPG, JPEG, and PNG images into one PDF, with
  each image fitted neatly onto an A4 page.
- **Rotate PDF pages** — rotate every page left 90°, right 90°, or 180°.
- **Edit PDF** — annotate existing pages:
  - Add text to PDF
  - Highlight areas
  - Draw on PDF
  - Add rectangles
  - Add signature / text stamp
  - Export the edited PDF locally

> **Note:** Edit PDF currently supports adding annotations on top of existing
> PDF pages. Direct editing of existing PDF text is not supported yet.

## Privacy

- Files are processed locally in the browser.
- No upload to any server.
- No account required.
- No tracking, no ads, no paywall.

## Tech stack

- HTML
- CSS
- JavaScript
- [pdf-lib](https://pdf-lib.js.org/) (saving / exporting edited PDFs)
- [pdf.js](https://mozilla.github.io/pdf.js/) (rendering page previews)
- GitHub Pages (hosting)

## Project structure

```
CleanPDF/
├── index.html              # Homepage
├── README.md
├── assets/                 # Images / static assets
├── css/
│   └── style.css           # Shared styles
├── js/
│   ├── merge.js
│   ├── images-to-pdf.js
│   ├── rotate.js
│   └── edit.js
└── tools/
    ├── merge.html
    ├── images-to-pdf.html
    ├── rotate.html
    └── edit.html
```

## How to run locally

The tools rely on browser APIs, so serve the folder through a local web server
rather than opening files directly with `file://`.

```bash
# Python 3
python -m http.server 8000
```

Then open <http://localhost:8000> in your browser.

> An internet connection is needed on first load so the browser can fetch
> pdf-lib from the CDN. Your files themselves never leave the browser.

## How to deploy on GitHub Pages

1. Push this project to a GitHub repository.
2. Go to **Settings → Pages**.
3. Under **Build and deployment**, set **Source** to *Deploy from a branch*.
4. Choose your default branch and the `/ (root)` folder, then **Save**.
5. Your site will be published at `https://<username>.github.io/<repo>/`.

No build step is required — it is plain HTML, CSS, and JavaScript.

## Support

No ads, no tracking, no paywall. Donations help keep this project alive. If
CleanPDF is useful to you, please consider supporting development. _(Update the
donation link placeholder `#` in the pages with your own.)_

## Roadmap

- Organize / delete PDF pages
- Add page numbers
- Add watermark
- Compress PDF
- Dark mode

## License

Add your preferred license here.
=======
# cleanpdf
Free, privacy-first PDF tools that run entirely in your browser. No uploads. No ads.
>>>>>>> 14c4853d04cfc476660cabdf92a72e29cacac0f1
