import type { ReactNode } from "react";
import { parseRich, type Inline } from "@/lib/rich-text";

function inline(parts: Inline[]): ReactNode[] {
  return parts.map((part, index) => {
    if (part.code) return <code key={index}>{part.text}</code>;
    if (part.bold) return <strong key={index}>{part.text}</strong>;
    if (part.italic) return <em key={index}>{part.text}</em>;
    return part.text;
  });
}

/** Draws an answer's bold, italic, code, lists and paragraphs as elements. It never inserts HTML. */
export default function RichText({ text, className }: { text: string; className?: string }) {
  return (
    <div className={className}>
      {parseRich(text).map((block, index) => {
        if (block.type === "p") return <p key={index}>{inline(block.inline)}</p>;
        const List = block.type;
        return (
          <List key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{inline(item)}</li>
            ))}
          </List>
        );
      })}
    </div>
  );
}
