"use client";

import type { ComponentPropsWithoutRef, ReactElement, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";
import type { Components, ExtraProps } from "react-markdown";
import ReactMarkdown from "react-markdown";
import rehypeRaw from "rehype-raw";
import remarkGfm from "remark-gfm";
import { cn } from "../lib/utils";

type SpecMarkdownProps = {
  content: string;
  className?: string;
};

function MermaidDiagram({ chart }: { chart: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [svg, setSvg] = useState<string>("");

  useEffect(() => {
    const renderDiagram = async () => {
      if (!ref.current) {
        return;
      }

      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            primaryColor: "#F0F9FF",
            primaryTextColor: "#1F1F1F",
            primaryBorderColor: "#0369A1",
            lineColor: "#BABABA",
            secondaryColor: "#FFF4E6",
            secondaryTextColor: "#1F1F1F",
            secondaryBorderColor: "#E67E22",
            tertiaryColor: "#ECFDF5",
            tertiaryTextColor: "#1F1F1F",
            tertiaryBorderColor: "#059669",
            noteBkgColor: "#DBEAFE",
            noteTextColor: "#1F1F1F",
            noteBorderColor: "#2563EB",
            fontSize: "12px",
            fontFamily: "system-ui, -apple-system, sans-serif",
          },
        });

        const id = `mermaid-${Math.random().toString(36).slice(2, 11)}`;
        const { svg: renderedSvg } = await mermaid.render(id, chart);
        setSvg(renderedSvg);
      } catch (error) {
        console.error("Failed to render mermaid diagram:", error);
        setSvg(
          `<pre class="text-xs text-red-600">Failed to render diagram</pre>`
        );
      }
    };

    renderDiagram();
  }, [chart]);

  return (
    <div
      className="my-3 flex justify-center rounded-lg border border-[#E8E8E8] bg-[#FAFAFA] p-4"
      // biome-ignore lint/security/noDangerouslySetInnerHtml: Mermaid generates safe SVG
      dangerouslySetInnerHTML={{ __html: svg }}
      ref={ref}
    />
  );
}

const codeLanguagePattern = /language-(\w+)/;
const trailingNewlinePattern = /\n$/;
const blockElementTags = new Set(["step", "div", "blockquote"]);

type CodeComponentProps = ComponentPropsWithoutRef<"code"> &
  ExtraProps & {
    inline?: boolean;
  };

const isBlockElementChild = (child: unknown): child is { tagName: string } => {
  if (!child || typeof child !== "object") {
    return false;
  }

  const candidate = child as { tagName?: unknown; type?: unknown };
  if (candidate.type !== "element") {
    return false;
  }

  return (
    typeof candidate.tagName === "string" &&
    blockElementTags.has(candidate.tagName)
  );
};

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h1 className="pt-3 pb-1 font-semibold text-[#1F1F1F] text-lg first:pt-0">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 border-[#F0F0F0] border-b pt-4 pb-1 font-semibold text-[#1F1F1F] text-sm first:pt-0">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="pt-3 pb-1 font-semibold text-[#2F2F2F] text-xs first:pt-0">
      {children}
    </h3>
  ),
  p: ({ children, node }) => {
    // Check if this paragraph only contains custom block-level elements
    const rawChildren =
      node && typeof node === "object" && "children" in node
        ? (node as { children?: unknown[] }).children
        : undefined;
    const hasBlockElement =
      Array.isArray(rawChildren) && rawChildren.some(isBlockElementChild);

    // If it contains block elements, render as a div instead
    if (hasBlockElement) {
      return (
        <div className="mb-2 text-[#3D3D3D] text-xs leading-relaxed">
          {children}
        </div>
      );
    }

    return (
      <p className="mb-2 text-[#3D3D3D] text-xs leading-relaxed">{children}</p>
    );
  },
  ul: ({ children }) => <ul className="mb-2 ml-4 space-y-1">{children}</ul>,
  ol: ({ children }) => (
    <ol className="mb-2 list-inside list-decimal space-y-1">{children}</ol>
  ),
  li: ({ children }) => (
    <li className="flex items-start text-[#3D3D3D] text-xs leading-relaxed">
      <span className="mt-0.5 mr-1.5 text-[#BABABA]">•</span>
      <span className="flex-1">{children}</span>
    </li>
  ),
  strong: ({ children }) => (
    <strong className="font-semibold text-[#2F2F2F]">{children}</strong>
  ),
  code: ({ inline, className, children }: CodeComponentProps) => {
    const match = codeLanguagePattern.exec(className ?? "");
    const language = match?.[1];

    // Handle mermaid code blocks
    if (!inline && language === "mermaid") {
      return (
        <MermaidDiagram
          chart={String(children).replace(trailingNewlinePattern, "")}
        />
      );
    }

    // Regular inline code
    return (
      <code className="rounded bg-[#F8F8F8] px-1 py-0.5 font-mono text-[#6F6F6F] text-[10px]">
        {children}
      </code>
    );
  },
  hr: () => <hr className="my-3 border-[#F0F0F0]" />,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-[#E0E0E0] border-l-3 py-1 pl-3 text-[#6F6F6F] text-xs italic">
      {children}
    </blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }) => (
    <thead className="border-[#F0F0F0] border-b bg-[#FAFAFA]">{children}</thead>
  ),
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-[#F0F0F0] border-b last:border-0">{children}</tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left font-semibold text-[#1F1F1F]">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-[#3D3D3D]">{children}</td>
  ),
} as Components;

type CustomComponentProps = { children?: ReactNode };

const customComponents: Record<
  string,
  (props: CustomComponentProps) => ReactElement
> = {
  highlight: ({ children }) => (
    <span className="inline-block rounded bg-[#FFF4E6] px-1.5 py-0.5 font-medium text-[#E67E22] text-xs">
      {children}
    </span>
  ),
  metric: ({ children }) => (
    <span className="inline-block rounded bg-[#F0F9FF] px-1.5 py-0.5 font-semibold text-[#0369A1] text-xs">
      {children}
    </span>
  ),
  field: ({ children }) => (
    <span className="mr-2 inline-block min-w-[100px] font-semibold text-[#2F2F2F] text-xs">
      {children}
    </span>
  ),
  tag: ({ children }) => (
    <span className="mr-1 inline-block rounded-md border border-[#E0E0E0] bg-[#F5F5F5] px-2 py-0.5 font-medium text-[#6F6F6F] text-[10px]">
      {children}
    </span>
  ),
  step: ({ children }) => (
    <div className="mt-2 mb-3 rounded-lg border border-[#E8E8E8] bg-[#FAFAFA] p-3">
      {children}
    </div>
  ),
  error: ({ children }) => (
    <span className="font-semibold text-[#DC2626] text-xs">{children}</span>
  ),
  success: ({ children }) => (
    <span className="rounded bg-[#ECFDF5] px-1.5 py-0.5 font-semibold text-[#059669] text-xs">
      {children}
    </span>
  ),
  warning: ({ children }) => (
    <span className="rounded bg-[#FEF3C7] px-1.5 py-0.5 font-semibold text-[#D97706] text-xs">
      {children}
    </span>
  ),
  info: ({ children }) => (
    <span className="rounded bg-[#DBEAFE] px-1.5 py-0.5 font-semibold text-[#2563EB] text-xs">
      {children}
    </span>
  ),
};

export function SpecMarkdown({ content, className }: SpecMarkdownProps) {
  return (
    <div
      className={cn("prose-sm max-w-none text-[#3D3D3D] text-xs", className)}
    >
      <ReactMarkdown
        components={
          { ...markdownComponents, ...customComponents } as Components
        }
        rehypePlugins={[rehypeRaw]}
        remarkPlugins={[remarkGfm]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
