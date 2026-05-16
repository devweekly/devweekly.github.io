import { slugifyStr } from "@utils/slugify";
import Datetime from "./Datetime";
import type { CollectionEntry } from "astro:content";

export interface Props {
  href?: string;
  frontmatter: CollectionEntry<"blog">["data"];
  secHeading?: boolean;
}

export default function Card({ href, frontmatter, secHeading = true }: Props) {
  const { title, pubDatetime, modDatetime, description } = frontmatter;

  const headerProps = {
    style: { viewTransitionName: slugifyStr(title) },
    className: "text-xl font-semibold transition-colors hover:text-skin-accent",
  };

  return (
    <li className="py-6 sm:py-10 border-b border-skin-line">
      <a
        href={href}
        className="inline-block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-skin-accent focus-visible:ring-offset-2 rounded"
      >
        {secHeading ? (
          <h2 {...headerProps}>{title}</h2>
        ) : (
          <h3 {...headerProps}>{title}</h3>
        )}
      </a>
      <Datetime
        pubDatetime={pubDatetime}
        modDatetime={modDatetime}
        className="mt-2 text-sm opacity-70"
      />
      <p className="mt-3 leading-snug sm:leading-relaxed opacity-80">
        {description}
      </p>
    </li>
  );
}
