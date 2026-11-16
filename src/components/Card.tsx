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
    className: "text-lg sm:text-xl font-semibold transition-colors hover:text-skin-accent",
  };

  return (
    <li className="border-b border-skin-line py-4 sm:py-10">
      <a
        href={href}
        className="inline-block rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-skin-accent focus-visible:ring-offset-2"
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
      <p className="mt-3 text-base leading-snug opacity-80 sm:leading-relaxed">
        {description}
      </p>
    </li>
  );
}
