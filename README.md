# Veridien website

Source for [veridienlabs.org](https://veridienlabs.org): a static site, plain HTML, CSS, and JavaScript, with no build step.

## Run it locally

The 3D hero loads its modules over HTTP, so serve the folder instead of opening the files directly:

```bash
python3 -m http.server 8000
```

Then open http://localhost:8000.

## Files

- `index.html`, `research.html`, `people.html`, `join.html`, `clinicians.html`: the pages
- `styles.css`: shared styles
- `main.js`: motion, menu, forms, and the Research project panels
- `abdomen.js`, `abdomen-model.js`: the 3D modular simulator on the Home page (three.js): the scroll-driven hero and the assembled model
- `anatomy-kit.js`, `organs/`: shared geometry and material code, and one file per organ module (built entirely in code; there are no mesh files)
- `artwork.js`: the MRI-slice artwork on For clinicians
- `assets/`: images

three.js, Lenis, and the General Sans font load from public CDNs.

## Contact

contact@veridienlabs.org
