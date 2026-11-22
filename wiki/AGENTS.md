# Wiki Maintenance Rules

## Purpose

This directory is an **OKF v0.3 bundle** maintained with the LLM Wiki workflow. Markdown and YAML are the storage format; the agent is the ongoing maintainer. The wiki should accumulate reusable concepts and relationships, not become a directory of disconnected article summaries.

## Sources and derived knowledge

- Keep evidence separate from curated knowledge. A source is the authority for its claims; a wiki page is a derived, navigable representation.
- For a web source, preserve its canonical URL, title, author when known, publication date, and relevant modification date. Do not copy an entire copyrighted article into the repository. Keep summaries concise and attribute claims to the source.
- When the user supplies a local document, preserve it unchanged under `raw/` and treat it as read-only. Do not create `raw/` until there is an actual local source to store.
- Use `references/` for source records that add durable context or navigation. A reference page is not a substitute for the original source.
- Never promote a model inference, an unverified search result, or a memory from another conversation into a source fact.

## Ingestion workflow

1. Read this file and `index.md`; inspect the relevant concepts and references before creating anything.
2. Register the source in `references/` when it adds lasting value. Record the canonical URI and only metadata that can be verified.
3. Extract the smallest set of reusable concepts. Update an existing concept when the new source adds evidence; create a page only for a genuinely distinct concept.
4. Preserve provenance in OKF frontmatter using `sources`. Attribute important source-dependent claims with footnotes whose labels match `sources[].id`.
5. Link related concepts with standard Markdown links. Update every affected directory index and append one factual entry to `log.md`.
6. Review the resulting graph: verify links, source attribution, unsupported claims, duplicated pages, and indexes.

## LLM Wiki maintenance

The wiki is maintained incrementally. Each ingestion may add evidence or change a concept; it should not trigger a wholesale rewrite. A separate consolidation pass (“dreaming”) is useful after a meaningful batch of new evidence, repeated corrections, conflicting claims, or signs of stale/duplicated knowledge. It should:

- compare derived pages with their source material;
- correct unsupported or outdated claims and preserve unresolved disagreements;
- merge duplicate concepts and repair missing or weak links;
- keep indexes navigable and remove details that do not help future retrieval.

Do not run consolidation on a fixed schedule merely for activity. Trigger it when there is new evidence or a concrete maintenance reason. Prefer independent writes to source-specific pages, then consolidate shared concepts and indexes in a serialized pass; concurrent agents must not overwrite the same shared page.

## Reading and answering

Start with `index.md`, then follow relevant concept links and inspect the cited sources when a claim matters. Use the wiki for recurring or cross-source questions, and source search for details that are best answered from one document. The wiki complements retrieval; it does not replace the underlying evidence.

Do not inject the whole wiki into every session. Load the entry index first and retrieve only the relevant pages. Keep any always-loaded context small, factual, and useful across tasks.

## OKF conventions

- Every concept file has YAML frontmatter with a non-empty `type`.
- The bundle-root `index.md` may declare `okf_version: "0.3"`; subdirectory indexes and `log.md` have no frontmatter.
- Use standard Markdown links and RFC 3339 timestamps. Do not use Obsidian-only `[[wikilinks]]`.
- Use `generated` for the actor and date of the last meaningful content change. Do not update it for whitespace-only edits.
- Use `verified` only when an actual human or deterministic process checked the current content. Never manufacture a human review.
- Use `status: draft` for newly generated, unreviewed knowledge; use `stable` only when it is ready for consumption. Add `stale_after` only when there is a defensible review date.
- Keep unknown frontmatter keys when editing existing pages. New extension keys must use the `x-devweekly-*` prefix.
- `index.md` files provide progressive disclosure. `log.md` is newest-first and records completed changes, not intentions.

## Scope

Keep the taxonomy small. Add `entities/`, `syntheses/`, or other categories only when the corpus contains enough material to justify them. Do not create one page per source or split concepts into trivial fragments.
