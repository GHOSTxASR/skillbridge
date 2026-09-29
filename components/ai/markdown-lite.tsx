import { Fragment } from "react"

// A deliberately small Markdown subset for assistant replies: headings, bullet and
// numbered lists, tables, **bold** and `code`. It builds React elements from text, so
// nothing in a reply is ever interpreted as HTML.

function inline(text: string, keyPrefix: string) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean)

  return parts.map((part, index) => {
    const key = `${keyPrefix}-${index}`
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return (
        <strong key={key} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      )
    }
    if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
      return (
        <code key={key} className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-foreground">
          {part.slice(1, -1)}
        </code>
      )
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

type Block =
  | { kind: "p"; lines: string[] }
  | { kind: "h"; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "table"; rows: string[][] }

function parse(text: string): Block[] {
  const blocks: Block[] = []
  const lines = text.replace(/\r\n/g, "\n").split("\n")

  for (const raw of lines) {
    const line = raw.trim()
    const last = blocks[blocks.length - 1]

    if (!line) {
      blocks.push({ kind: "p", lines: [] })
      continue
    }

    if (line.startsWith("|")) {
      const cells = line.replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim())
      if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue
      if (last?.kind === "table") last.rows.push(cells)
      else blocks.push({ kind: "table", rows: [cells] })
      continue
    }

    const heading = line.match(/^#{1,4}\s+(.*)$/)
    if (heading) {
      blocks.push({ kind: "h", text: heading[1] })
      continue
    }

    const bullet = line.match(/^[-*•]\s+(.*)$/)
    if (bullet) {
      if (last?.kind === "ul") last.items.push(bullet[1])
      else blocks.push({ kind: "ul", items: [bullet[1]] })
      continue
    }

    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    if (numbered) {
      if (last?.kind === "ol") last.items.push(numbered[1])
      else blocks.push({ kind: "ol", items: [numbered[1]] })
      continue
    }

    if (last?.kind === "p") last.lines.push(line)
    else blocks.push({ kind: "p", lines: [line] })
  }

  return blocks.filter((block) => block.kind !== "p" || block.lines.length > 0)
}

export function MarkdownLite({ text }: { text: string }) {
  const blocks = parse(text)

  return (
    <div className="space-y-3">
      {blocks.map((block, index) => {
        const key = `b-${index}`
        switch (block.kind) {
          case "h":
            return (
              <p key={key} className="pt-1 text-sm font-semibold text-foreground">
                {inline(block.text, key)}
              </p>
            )
          case "ul":
            return (
              <ul key={key} className="space-y-1.5">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="flex gap-2.5">
                    <span className="mt-[0.6em] size-1 shrink-0 rounded-full bg-ai/70" aria-hidden="true" />
                    <span>{inline(item, `${key}-${itemIndex}`)}</span>
                  </li>
                ))}
              </ul>
            )
          case "ol":
            return (
              <ol key={key} className="space-y-1.5">
                {block.items.map((item, itemIndex) => (
                  <li key={itemIndex} className="flex gap-2.5">
                    <span className="w-4 shrink-0 text-right tabular-nums text-subtle-foreground">{itemIndex + 1}.</span>
                    <span>{inline(item, `${key}-${itemIndex}`)}</span>
                  </li>
                ))}
              </ol>
            )
          case "table":
            return (
              <div key={key} className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-xs">
                  <tbody>
                    {block.rows.map((row, rowIndex) => (
                      <tr key={rowIndex} className={rowIndex === 0 ? "bg-surface-2/70 font-medium text-foreground" : "border-t border-border"}>
                        {row.map((cell, cellIndex) => (
                          <td key={cellIndex} className="px-3 py-2 align-top">
                            {inline(cell, `${key}-${rowIndex}-${cellIndex}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          default:
            return (
              <p key={key}>
                {block.lines.map((line, lineIndex) => (
                  <Fragment key={lineIndex}>
                    {lineIndex > 0 && <br />}
                    {inline(line, `${key}-${lineIndex}`)}
                  </Fragment>
                ))}
              </p>
            )
        }
      })}
    </div>
  )
}
