import type { Config } from "@react-router/dev/config";

// Static output: every route is prerendered to real HTML at build time, so
// build/client deploys as plain files on the Cloudflare static-assets setup.
export default {
  ssr: false,
  prerender: true,
} satisfies Config;
