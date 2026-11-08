/** The small part of markdown Ask Qula answers use: bold, italic, code, lists and paragraphs. */
export type Inline = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

export type RichBlock =
  | { type: "p"; inline: Inline[] }
  | { type: "ul" | "ol"; items: Inline[][] };

export function parseInline(text: string): Inline[] {
  const out: Inline[] = [];
  let buffer = "";
  const flush = () => {
    if (buffer) out.push({ text: buffer });
    buffer = "";
  };
  let i = 0;
  while (i < text.length) {
    if (text.startsWith("**", i)) {
      const end = text.indexOf("**", i + 2);
      flush();
      // Bold that is not closed yet, while the answer is still arriving, runs to the end.
      const inner = text.slice(i + 2, end === -1 ? undefined : end);
      if (inner) out.push({ text: inner, bold: true });
      i = end === -1 ? text.length : end + 2;
      continue;
    }
    if (text[i] === "`") {
      const end = text.indexOf("`", i + 1);
      if (end > i + 1) {
        flush();
        out.push({ text: text.slice(i + 1, end), code: true });
        i = end + 1;
        continue;
      }
    }
    if (text[i] === "*" && text[i + 1] && text[i + 1] !== "*" && !/\s/.test(text[i + 1])) {
      const end = text.indexOf("*", i + 1);
      if (end > i + 1 && !/\s/.test(text[end - 1]) && text[end + 1] !== "*") {
        flush();
        out.push({ text: text.slice(i + 1, end), italic: true });
        i = end + 1;
        continue;
      }
    }
    buffer += text[i];
    i += 1;
  }
  flush();
  return out;
}

const BULLET = /^\s*[-*•]\s+(.*)$/;
const NUMBER = /^\s*\d+[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseRich(text: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  let paragraph: string[] = [];
  const endParagraph = () => {
    if (paragraph.length) blocks.push({ type: "p", inline: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };
  for (const line of text.split("\n")) {
    const bullet = BULLET.exec(line);
    const number = NUMBER.exec(line);
    const heading = HEADING.exec(line);
    if (bullet || number) {
      endParagraph();
      const type = bullet ? "ul" : "ol";
      const item = parseInline((bullet ?? number)![1]);
      const last = blocks[blocks.length - 1];
      if (last && last.type === type) last.items.push(item);
      else blocks.push({ type, items: [item] });
    } else if (heading) {
      endParagraph();
      blocks.push({ type: "p", inline: [{ text: heading[1], bold: true }] });
    } else if (!line.trim()) {
      endParagraph();
    } else {
      paragraph.push(line);
    }
  }
  endParagraph();
  return blocks;
}
