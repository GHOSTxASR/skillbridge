// Re-mounts on every navigation, so each page's content enters once with the same
// gentle rise (a cross-fade under prefers-reduced-motion; see globals.css).
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="page-enter">{children}</div>
}
