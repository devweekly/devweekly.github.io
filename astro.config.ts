import { defineConfig } from "astro/config";
import tailwind from "@tailwindcss/vite";
import react from "@astrojs/react";
import remarkToc from "remark-toc";
import remarkCollapse from "remark-collapse";
import sitemap from "@astrojs/sitemap";
import { SITE } from "./src/config";
import mermaid from "astro-mermaid";

type HastNode = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
};

/**
 * 给每张 Markdown 表格套一层可横向滚动的容器。
 * 表格的 min-content 宽度常常超过小屏正文列，直接放进正文会把整个文档撑宽，
 * 移动端浏览器随之缩放整页（iOS Safari 的 shrink-to-fit），正文只剩左侧一小条。
 */
function rehypeWrapTables() {
  const wrap = (node: HastNode): HastNode => {
    if (node.children) {
      node.children = node.children.map(child => {
        const next = wrap(child);
        if (next.type === "element" && next.tagName === "table") {
          return {
            type: "element",
            tagName: "div",
            properties: { className: ["table-wrap"] },
            children: [next],
          };
        }
        return next;
      });
    }
    return node;
  };
  return (tree: HastNode) => {
    wrap(tree);
  };
}

// https://astro.build/config
export default defineConfig({
  site: SITE.website,
  integrations: [
    react(),
    mermaid({
      theme: "forest",
      iconPacks: [
        {
          name: "logos",
          loader: () =>
            fetch("https://unpkg.com/@iconify-json/logos@1/icons.json").then(
              res => res.json()
            ),
        },
        {
          name: "iconoir",
          loader: () =>
            fetch("https://unpkg.com/@iconify-json/iconoir@1/icons.json").then(
              res => res.json()
            ),
        },
      ],
    }),
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
    rehypePlugins: [rehypeWrapTables],
    shikiConfig: {
      theme: "github-light",
      wrap: true,
    },
  },
  vite: {
    plugins: [tailwind()],
    optimizeDeps: {
      exclude: ["@resvg/resvg-js"],
    },
  },
  scopedStyleStrategy: "where",
});
