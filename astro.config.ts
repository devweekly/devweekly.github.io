import { defineConfig } from "astro/config";
import tailwind from "@astrojs/tailwind";
import react from "@astrojs/react";
import remarkToc from "remark-toc";
import remarkCollapse from "remark-collapse";
import sitemap from "@astrojs/sitemap";
import { SITE } from "./src/config";
import mermaid from "astro-mermaid";

// https://astro.build/config
export default defineConfig({
  site: SITE.website,
  integrations: [
    tailwind({
      applyBaseStyles: false,
    }),
    react(),
    // mermaid({
    //   theme: "forest",
    //   iconPacks: [
    //     {
    //       name: "logos",
    //       loader: () =>
    //         fetch("https://unpkg.com/@iconify-json/logos@1/icons.json").then(
    //           res => res.json()
    //         ),
    //     },
    //     {
    //       name: "iconoir",
    //       loader: () =>
    //         fetch("https://unpkg.com/@iconify-json/iconoir@1/icons.json").then(
    //           res => res.json()
    //         ),
    //     },
    //   ],
    // }),
    sitemap(),
  ],
  markdown: {
    remarkPlugins: [
      remarkToc,
      [
        remarkCollapse,
        {
          test: "Table of contents",
        },
      ],
    ],
    shikiConfig: {
      theme: "one-dark-pro",
      wrap: true,
    },
  },
  vite: {
    optimizeDeps: {
      exclude: ["@resvg/resvg-js"],
    },
  },
  scopedStyleStrategy: "where",
});
