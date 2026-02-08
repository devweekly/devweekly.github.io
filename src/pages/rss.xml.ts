import rss from "@astrojs/rss";
import { getCollection, render } from "astro:content";
import getSortedPosts from "@utils/getSortedPosts";
import { SITE } from "@config";
import sanitizeHtml from "sanitize-html";

export async function GET() {
  const posts = await getCollection("blog");
  const sortedPosts = getSortedPosts(posts);

  const items = await Promise.all(
    sortedPosts.map(async post => {
      // 使用 render 获取渲染后的 HTML
      const { Content } = await render(post);

      // 获取渲染后的 HTML 内容
      const htmlContent = await renderContentToHtml(Content);

      return {
        link: `posts/${post.slug}/`,
        title: post.data.title,
        description: post.data.description,
        pubDate: new Date(post.data.modDatetime ?? post.data.pubDatetime),
        content: sanitizeHtml(htmlContent),
      };
    })
  );

  return rss({
    title: SITE.title,
    description: SITE.desc,
    site: SITE.website,
    items,
  });
}

// 辅助函数：将内容组件渲染为 HTML
async function renderContentToHtml(Content: any): Promise<string> {
  // 使用 AstroContainer 渲染组件
  const { experimental_AstroContainer } = await import("astro/container");
  const container = await experimental_AstroContainer.create();
  const result = await container.renderToString(Content);
  return result;
}
