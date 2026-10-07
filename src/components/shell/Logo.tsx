/** Central Ops mark: a "C" orbit with two nodes and a central hub — work connected through one core. */
export function LogoGlyph({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg viewBox="0 0 32 32" className={className} style={style} fill="none" aria-hidden>
      <path d="M24.2 9.2A10 10 0 1 0 24.2 22.8" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <path d="M16 16 L24.2 9.2 M16 16 L24.2 22.8" stroke="currentColor" strokeOpacity=".45" strokeWidth="1.6" strokeLinecap="round" />
      <circle cx="24.2" cy="9.2" r="2.6" fill="currentColor" />
      <circle cx="24.2" cy="22.8" r="2.6" fill="currentColor" />
      <circle cx="16" cy="16" r="3.4" fill="currentColor" />
    </svg>
  );
}

export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center overflow-hidden text-white"
      style={{ width: size, height: size, borderRadius: size * 0.32, background: "linear-gradient(140deg, var(--color-accent-2) 0%, var(--color-accent) 55%, color-mix(in srgb, var(--color-accent) 70%, black) 100%)", boxShadow: "0 10px 22px -10px var(--color-accent), inset 0 1px 0 rgb(255 255 255 / 0.35)" }}>
      <span className="absolute inset-x-0 top-0 h-1/2" style={{ background: "linear-gradient(180deg, rgb(255 255 255 / 0.22), transparent)" }} />
      <LogoGlyph className="relative" style={{ width: size * 0.62, height: size * 0.62 }} />
    </span>
  );
}
