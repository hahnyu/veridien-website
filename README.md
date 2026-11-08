<img src="public/logo.svg" alt="Veridien" width="240">

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

## Deploy

Pushing to `main` deploys the site. Cloudflare Workers Builds (Worker `broad-surf-8ea7`, which serves veridienlabs.org and www.veridienlabs.org) runs:

```bash
pnpm run build
npx wrangler deploy --assets=./build/client --name=broad-surf-8ea7 --compatibility-date=2026-11-01
```

It deploys `build/client`, not the repository root: the root has no `index.html`. The build log is under the Worker's Deployments tab in the Cloudflare dashboard.

`public/_redirects` sends the old site's page URLs to the matching sections.

## Files

- `app/root.tsx`: the HTML document shell
- `app/routes.ts`: the route list
- `app/routes/`: one file per page
- `app/app.css`: styles
- `app/wordmark.tsx`: the logo: the Pine mark in its 32 px cut, beside the name as vector outlines of Jost SemiBold (SIL Open Font License 1.1).
- `app/scroll-explode.tsx`: the hero, a frame sequence scrubbed by the scroll position
- `app/site-header.tsx`: the header and its section links
- `app/compare.tsx`: the three comparison images
- `app/sections.tsx`: the platform, research, people and partner sections
- `app/glide.ts`: smooth scrolling to a section, which falls back to a plain jump
- `public/`: files served as they are

The previous static site is on `main`.

## Logo

The official logo is the Pine mark beside the name. `app/wordmark.tsx` is the header's copy, centred on the nav text.

- `public/logo.svg` and `public/logo-mark.svg`: the logo and the mark alone, also served at `veridienlabs.org/logo.svg`.
- `brand/veridien-logo-transparent.png`: 2400 px wide, transparent, for video and documents.
- `brand/veridien-avatar.png` and `brand/veridien-social.png`: for account avatars and link previews.

Colours: mark and name both `#18181b`, no green, on the page field `#f5f8f6`. The mark stands 1.54 times the name's height, balanced above and below it. In the header the logo is centred in the bar and the capitals on the nav text.

## Credits

- `public/photos/surgery-*.webp`: cropped from [Female reproductive system.jpg](https://commons.wikimedia.org/wiki/File:Female_reproductive_system.jpg) by Hic et nunc, [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/). The crop stays under that licence, and the page must keep its credit line.
- `public/fonts/`: Schibsted Grotesk, SIL Open Font License 1.1 (`public/fonts/OFL.txt`).
- `public/logos/`: partner institutions' marks, from Wikimedia Commons. Public domain as images, but they remain those institutions' trademarks, so check each institution's OK before relying on them.

## Contact

contact@veridienlabs.org
