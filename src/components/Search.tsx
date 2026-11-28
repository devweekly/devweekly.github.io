import Fuse from "fuse.js";
import { useEffect, useRef, useState } from "react";
import Card from "@components/Card";
import type { CollectionEntry } from "astro:content";

export type SearchItem = {
  title: string;
  description: string;
  data: CollectionEntry<"blog">["data"];
  slug: string;
};

interface Props {
  searchList: SearchItem[];
}

type PagefindResult = {
  url: string;
  excerpt: string;
  meta: Record<string, string>;
};

type PagefindApi = {
  search: (
    query: string
  ) => Promise<{ results: { data: () => Promise<PagefindResult> }[] }>;
};

const MAX_RESULTS = 50;
const DEBOUNCE_MS = 300;

// Constructed at runtime: Vite cannot statically analyze this import, so the
// build succeeds before pagefind emits its bundle into dist/.
const dynamicImport = new Function("url", "return import(url)") as (
  url: string
) => Promise<unknown>;

export default function SearchBar({ searchList }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputVal, setInputVal] = useState("");
  const [pagefind, setPagefind] = useState<PagefindApi | null>(null);
  const [fullTextResults, setFullTextResults] = useState<PagefindResult[]>([]);
  const [titleResults, setTitleResults] = useState<SearchItem[]>([]);

  // Pagefind's assets are emitted at build time. In dev they don't exist,
  // so fall back to title/description search via Fuse.
  useEffect(() => {
    let active = true;
    dynamicImport("/pagefind/pagefind.js")
      .then(mod => {
        if (active)
          setPagefind(
            (mod as { default?: PagefindApi }).default ?? (mod as PagefindApi)
          );
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const searchUrl = new URLSearchParams(window.location.search);
    const searchStr = searchUrl.get("q");
    if (searchStr) setInputVal(searchStr);
    setTimeout(function () {
      inputRef.current!.selectionStart = inputRef.current!.selectionEnd =
        searchStr?.length || 0;
    }, 50);
  }, []);

  useEffect(() => {
    if (inputVal.length > 0) {
      const searchParams = new URLSearchParams(window.location.search);
      searchParams.set("q", inputVal);
      history.replaceState(
        history.state,
        "",
        window.location.pathname + "?" + searchParams.toString()
      );
    } else {
      history.replaceState(history.state, "", window.location.pathname);
    }
  }, [inputVal]);

  useEffect(() => {
    const query = inputVal.trim();
    if (query.length < 2) {
      setFullTextResults([]);
      setTitleResults([]);
      return;
    }

    let stale = false;

    if (pagefind) {
      const timer = setTimeout(() => {
        pagefind
          .search(query)
          .then(async ({ results }) => {
            const data = await Promise.all(
              results.slice(0, MAX_RESULTS).map(r => r.data())
            );
            if (!stale) setFullTextResults(data);
          })
          .catch(() => {
            if (!stale) setFullTextResults([]);
          });
      }, DEBOUNCE_MS);
      return () => {
        stale = true;
        clearTimeout(timer);
      };
    }

    const fuse = new Fuse(searchList, {
      keys: ["title", "description"],
      includeMatches: true,
      minMatchCharLength: 2,
      threshold: 0.5,
    });
    setTitleResults(
      fuse
        .search(query)
        .slice(0, MAX_RESULTS)
        .map(r => r.item)
    );
    return () => {
      stale = true;
    };
  }, [inputVal, pagefind, searchList]);

  const resultCount = pagefind ? fullTextResults.length : titleResults.length;

  return (
    <>
      <label className="relative block">
        <span className="absolute inset-y-0 left-0 flex items-center pl-2 opacity-75">
          <svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M19.023 16.977a35.13 35.13 0 0 1-1.367-1.384c-.372-.378-.596-.653-.596-.653l-2.8-1.337A6.962 6.962 0 0 0 16 9c0-3.859-3.14-7-7-7S2 5.141 2 9s3.14 7 7 7c1.763 0 3.37-.66 4.603-1.739l1.337 2.8s.275.224.653.596c.387.363.896.854 1.384 1.367l1.358 1.392.604.646 2.121-2.121-.646-.604c-.379-.372-.885-.866-1.391-1.36zM9 14c-2.757 0-5-2.243-5-5s2.243-5 5-5 5 2.243 5 5-2.243 5-5 5z"></path>
          </svg>
          <span className="sr-only">Search</span>
        </span>
        <input
          className="block w-full rounded border border-skin-fill 
        border-opacity-40 bg-skin-fill py-3 pl-10
        pr-3 placeholder:italic placeholder:text-opacity-75 
        focus:border-skin-accent focus:outline-none"
          placeholder="Search for anything..."
          type="text"
          name="search"
          value={inputVal}
          onChange={e => setInputVal(e.currentTarget.value)}
          autoComplete="off"
          ref={inputRef}
        />
      </label>

      {inputVal.length > 1 && (
        <div className="mt-8">
          Found {resultCount}
          {resultCount === 1 ? " result" : " results"} for '{inputVal}'
        </div>
      )}

      {pagefind ? (
        <ul>
          {fullTextResults.map(result => (
            <li
              key={result.url}
              className="my-6 border-b border-skin-fill pb-6"
            >
              <a
                href={result.url}
                className="text-lg font-semibold text-skin-accent hover:underline"
              >
                {result.meta?.title ?? result.url}
              </a>
              <div
                className="mt-2 text-sm text-skin-base [&_mark]:bg-skin-accent [&_mark]:text-skin-base"
                dangerouslySetInnerHTML={{ __html: result.excerpt }}
              />
            </li>
          ))}
        </ul>
      ) : (
        <ul>
          {titleResults.map(item => (
            <Card
              href={`/posts/${item.slug}/`}
              frontmatter={item.data}
              key={item.slug}
            />
          ))}
        </ul>
      )}
    </>
  );
}
