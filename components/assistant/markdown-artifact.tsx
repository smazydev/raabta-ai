"use client";

import ReactMarkdown from "react-markdown";

export function MarkdownArtifact({ source }: { source: string }) {
  return (
    <div className="markdown-artifact max-w-none space-y-3 break-words text-sm leading-relaxed text-foreground [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-bold [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:font-medium [&_li]:my-0.5 [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_table]:w-full [&_table]:border-collapse [&_td]:border [&_td]:border-border [&_td]:p-2 [&_th]:border [&_th]:border-border [&_th]:p-2 [&_th]:text-left [&_ul]:list-disc [&_ul]:pl-5">
      <ReactMarkdown>{source}</ReactMarkdown>
    </div>
  );
}
