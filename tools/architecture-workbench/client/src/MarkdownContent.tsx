import { CodeHighlighter, Mermaid } from "@ant-design/x";
import { XMarkdown } from "@ant-design/x-markdown";
import type { ReactNode } from "react";

interface MarkdownCodeProps {
  children?: ReactNode;
  className?: string;
  lang?: string;
  block?: boolean;
}

interface MarkdownContentProps {
  content: string;
}

function MarkdownCode({ children, className, lang, block }: MarkdownCodeProps) {
  if (!block) return <code className={className}>{children}</code>;
  return <CodeHighlighter className={className} lang={lang || "text"}>{children}</CodeHighlighter>;
}

// Keep component references stable. XMarkdown maps Mermaid code fences to the
// Ant Design X Mermaid component and uses CodeHighlighter only for fenced blocks.
const markdownComponents = {
  mermaid: Mermaid,
  code: MarkdownCode
};

export default function MarkdownContent({ content }: MarkdownContentProps) {
  const value = typeof content === "string" ? content : String(content ?? "");
  if (!value.trim()) return null;

  return (
    <div className="markdown-content">
      <XMarkdown content={value} components={markdownComponents} escapeRawHtml />
    </div>
  );
}
