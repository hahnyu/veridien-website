# Veridien website

Source for [veridienlabs.org](https://veridienlabs.org), built with React Router in framework mode (Vite, TypeScript). Every route is prerendered to static HTML at build time.

## Run it locally

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5173.

## Build

```bash
pnpm build
```

The site is written to `build/client` as plain static files.

## Files

- `app/root.tsx`: the HTML document shell
- `app/routes.ts`: the route list
- `app/routes/`: one file per page
- `app/app.css`: styles
- `app/wordmark.tsx`: the name, as vector outlines of Schibsted Grotesk Medium (SIL Open Font License 1.1).
- `app/scroll-explode.tsx`: the hero, a frame sequence scrubbed by the scroll position
- `app/compare.tsx`: the three images under the hero
- `app/partner.tsx`: the partner contact, and the link to it in the hero
- `public/`: files served as they are

The previous static site is on `main`.

## Credits

- `public/photos/surgery-*.webp`: cropped from [Female reproductive system.jpg](https://commons.wikimedia.org/wiki/File:Female_reproductive_system.jpg) by Hic et nunc, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The crop stays under that licence, and the page must keep its credit line.
- `public/fonts/`: Schibsted Grotesk, SIL Open Font License 1.1 (`public/fonts/OFL.txt`).

## Contact

contact@veridienlabs.org
