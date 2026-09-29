import { cn } from "@/lib/utils"

// Atmospheric background. CSS only: soft radial light, a faint dot grid and, on
// entry screens, an abstract skill network. Motion is slow (40 s cycles), drawn with
// transforms only, and removed under prefers-reduced-motion (see globals.css).

// Fixed coordinates (percent of a 100 x 100 box), so server and client render the same.
const NODES = [
  [8, 18], [22, 9], [31, 27], [17, 41], [44, 14], [52, 33], [38, 52],
  [63, 12], [71, 29], [58, 55], [83, 18], [90, 40], [76, 62], [26, 68],
  [47, 78], [66, 84], [88, 76], [12, 84],
] as const

const EDGES: Array<[number, number]> = [
  [0, 1], [1, 2], [0, 3], [2, 3], [1, 4], [2, 5], [4, 5], [3, 6], [5, 6],
  [4, 7], [7, 8], [5, 8], [8, 9], [6, 9], [7, 10], [10, 11], [8, 11],
  [11, 12], [9, 12], [6, 13], [13, 14], [9, 14], [14, 15], [12, 15],
  [15, 16], [12, 16], [13, 17], [3, 13],
]

// Nodes that softly pulse, as if activity moves through the network.
const LIVE = new Set([2, 5, 9, 11, 14])

function SkillNetwork() {
  return (
    <svg
      className="absolute inset-0 h-full w-full"
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
    >
      <g stroke="oklch(1 0 0 / 5.5%)" strokeWidth="0.1">
        {EDGES.map(([a, b]) => (
          <line
            key={`${a}-${b}`}
            x1={NODES[a][0]}
            y1={NODES[a][1]}
            x2={NODES[b][0]}
            y2={NODES[b][1]}
          />
        ))}
      </g>
      {NODES.map(([x, y], index) => (
        <circle
          key={index}
          cx={x}
          cy={y}
          r={LIVE.has(index) ? 0.42 : 0.28}
          fill={LIVE.has(index) ? (index % 2 ? "var(--ai)" : "var(--primary)") : "oklch(1 0 0 / 22%)"}
          style={
            LIVE.has(index)
              ? {
                  animation: "sb-pulse-soft 6s ease-in-out infinite",
                  animationDelay: `${index * 0.7}s`,
                }
              : undefined
          }
        />
      ))}
    </svg>
  )
}

export function Ambient({
  variant = "app",
  className,
}: {
  variant?: "app" | "hero"
  className?: string
}) {
  const hero = variant === "hero"

  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 -z-10 overflow-hidden",
        className
      )}
    >
      <div
        className="absolute -left-[20%] -top-[35%] h-[80vmax] w-[80vmax] rounded-full"
        style={{
          background: `radial-gradient(closest-side, oklch(0.72 0.135 250 / ${hero ? "22%" : "10%"}), transparent)`,
          animation: "sb-drift-a 42s ease-in-out infinite",
          willChange: "transform",
        }}
      />
      <div
        className="absolute -bottom-[40%] -right-[25%] h-[75vmax] w-[75vmax] rounded-full"
        style={{
          background: `radial-gradient(closest-side, oklch(0.82 0.11 192 / ${hero ? "14%" : "5%"}), transparent)`,
          animation: "sb-drift-b 52s ease-in-out infinite",
          willChange: "transform",
        }}
      />
      {hero && (
        <>
          <div
            className="absolute inset-0"
            style={{
              backgroundImage: "radial-gradient(oklch(1 0 0 / 6%) 1px, transparent 1px)",
              backgroundSize: "26px 26px",
              maskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent)",
              WebkitMaskImage: "radial-gradient(ellipse 70% 60% at 50% 40%, black, transparent)",
            }}
          />
          <SkillNetwork />
        </>
      )}
      <div
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, oklch(0.72 0.135 250 / 35%), oklch(0.82 0.11 192 / 25%), transparent)",
        }}
      />
    </div>
  )
}
