import { readFileSync } from "node:fs";
import { join } from "node:path";
import Link from "next/link";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy notice — UHA Legal",
  robots: { index: true, follow: false },
};

/** Convert the subset of Markdown used in privacy-notice.md to safe HTML (no eval, no user input). */
function mdToHtml(md: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" rel="noopener noreferrer">$1</a>');

  const out: string[] = [];
  let para: string[] = [];
  let inTable = false;
  let tableHeaderDone = false;
  let inList = false;

  const flushPara = () => { if (para.length) { out.push(`<p>${para.join(" ")}</p>`); para = []; } };
  const closeTable = () => { if (inTable) { out.push("</tbody></table>"); inTable = false; tableHeaderDone = false; } };
  const closeList = () => { if (inList) { out.push("</ul>"); inList = false; } };

  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();

    const hm = line.match(/^(#{1,4}) (.+)/);
    if (hm) {
      flushPara(); closeTable(); closeList();
      const n = hm[1].length;
      out.push(`<h${n}>${inline(hm[2])}</h${n}>`);
      continue;
    }

    if (line.startsWith("|")) {
      flushPara(); closeList();
      const cells = line.split("|").slice(1, -1).map((c) => c.trim());
      if (cells.every((c) => /^[-: ]+$/.test(c))) {
        tableHeaderDone = true;
        out.push("</thead><tbody>");
      } else if (!inTable) {
        out.push('<table><thead>');
        inTable = true;
        out.push(`<tr>${cells.map((c) => `<th>${inline(c)}</th>`).join("")}</tr>`);
      } else {
        const tag = tableHeaderDone ? "td" : "th";
        out.push(`<tr>${cells.map((c) => `<${tag}>${inline(c)}</${tag}>`).join("")}</tr>`);
      }
      continue;
    }
    closeTable();

    if (line.match(/^- /)) {
      flushPara();
      if (!inList) { out.push("<ul>"); inList = true; }
      out.push(`<li>${inline(line.slice(2))}</li>`);
      continue;
    }

    if (line === "") {
      flushPara(); closeList();
      continue;
    }

    para.push(inline(line));
  }

  flushPara(); closeTable(); closeList();
  return out.join("\n");
}

export default function PrivacyPage() {
  const md = readFileSync(join(process.cwd(), "docs/privacy-notice.md"), "utf-8");
  const html = mdToHtml(md);
  return (
    <main className="wrap privacy">
      <p className="privacy-back"><Link href="/">← Back to portal</Link></p>
      <div dangerouslySetInnerHTML={{ __html: html }} />
    </main>
  );
}
