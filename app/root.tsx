import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import type { Route } from "./+types/root";
import "./app.css";

// Browsers cache tab icons apart from everything else, so a new icon gets a new address (?v=…) or
// visitors keep seeing the old one. The .ico serves browsers and crawlers that don't read SVG icons.
export const links: Route.LinksFunction = () => [
  { rel: "icon", href: "/favicon.ico?v=pinecone", sizes: "32x32" },
  { rel: "icon", href: "/favicon.svg?v=pinecone", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=pinecone" },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <meta name="theme-color" content="#f5f8f6" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
