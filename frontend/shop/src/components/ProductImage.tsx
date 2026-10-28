/** Product artwork drawn as SVG: no external images, works fully offline. */
const ICONS: Record<string, JSX.Element> = {
  phone: (
    <g>
      <rect x="38" y="14" width="44" height="92" rx="9" fill="currentColor" />
      <rect x="42" y="20" width="36" height="78" rx="5" fill="#fff" opacity=".18" />
      <rect x="52" y="17" width="16" height="4" rx="2" fill="#000" opacity=".5" />
    </g>
  ),
  laptop: (
    <g>
      <rect x="22" y="26" width="76" height="50" rx="5" fill="currentColor" />
      <rect x="27" y="31" width="66" height="40" rx="2" fill="#fff" opacity=".2" />
      <path d="M12 80h96l-8 10H20z" fill="currentColor" opacity=".85" />
    </g>
  ),
  earbuds: (
    <g fill="currentColor">
      <rect x="28" y="56" width="64" height="40" rx="18" opacity=".9" />
      <circle cx="44" cy="40" r="12" />
      <rect x="40" y="40" width="8" height="26" rx="4" />
      <circle cx="76" cy="40" r="12" />
      <rect x="72" y="40" width="8" height="26" rx="4" />
    </g>
  ),
  headphones: (
    <g fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round">
      <path d="M28 70V58a32 32 0 0 1 64 0v12" />
      <rect x="20" y="64" width="18" height="30" rx="7" fill="currentColor" />
      <rect x="82" y="64" width="18" height="30" rx="7" fill="currentColor" />
    </g>
  ),
  speaker: (
    <g>
      <rect x="22" y="38" width="76" height="44" rx="22" fill="currentColor" />
      <circle cx="44" cy="60" r="11" fill="#fff" opacity=".25" />
      <circle cx="76" cy="60" r="11" fill="#fff" opacity=".25" />
    </g>
  ),
  watch: (
    <g fill="currentColor">
      <rect x="46" y="10" width="28" height="22" rx="4" opacity=".7" />
      <rect x="46" y="88" width="28" height="22" rx="4" opacity=".7" />
      <rect x="34" y="28" width="52" height="64" rx="14" />
      <rect x="40" y="34" width="40" height="52" rx="9" fill="#fff" opacity=".2" />
    </g>
  ),
  tv: (
    <g>
      <rect x="12" y="20" width="96" height="62" rx="5" fill="currentColor" />
      <rect x="17" y="25" width="86" height="52" rx="2" fill="#fff" opacity=".18" />
      <rect x="46" y="86" width="28" height="6" rx="3" fill="currentColor" />
    </g>
  ),
  diya: (
    <g>
      <path d="M60 22c9 12 9 22 0 28-9-6-9-16 0-28z" fill="#fbbf24" />
      <path d="M60 32c4 6 4 11 0 14-4-3-4-8 0-14z" fill="#fff7ed" />
      <path d="M18 58h84c-4 20-22 32-42 32S22 78 18 58z" fill="currentColor" />
      <path d="M30 66h60" stroke="#fde68a" strokeWidth="3" strokeDasharray="4 5" />
    </g>
  ),
  lights: (
    <g>
      <path d="M8 30q26 30 52 0t52 0" stroke="#334155" strokeWidth="2.5" fill="none" />
      {[20, 40, 60, 80, 100].map((x, i) => (
        <circle key={x} cx={x} cy={i % 2 ? 44 : 38} r="7" fill="currentColor" opacity={0.75 + (i % 2) * 0.25} />
      ))}
      <path d="M8 70q26 30 52 0t52 0" stroke="#334155" strokeWidth="2.5" fill="none" />
      {[20, 40, 60, 80, 100].map((x, i) => (
        <circle key={x} cx={x} cy={i % 2 ? 84 : 78} r="7" fill="currentColor" opacity={1 - (i % 2) * 0.25} />
      ))}
    </g>
  ),
  thali: (
    <g>
      <ellipse cx="60" cy="72" rx="48" ry="20" fill="currentColor" />
      <ellipse cx="60" cy="68" rx="40" ry="14" fill="#fde68a" opacity=".5" />
      <circle cx="45" cy="64" r="7" fill="#dc2626" />
      <circle cx="74" cy="64" r="7" fill="#f59e0b" />
      <path d="M60 40c5 7 5 12 0 16-5-4-5-9 0-16z" fill="#f97316" />
    </g>
  ),
  shirt: (
    <path d="M42 18l-26 14 10 22 10-5v53h48V49l10 5 10-22-26-14c-2 8-9 12-18 12s-16-4-18-12z" fill="currentColor" />
  ),
  saree: (
    <g>
      <path d="M30 14h60l8 92H22z" fill="currentColor" />
      <path d="M30 14l-8 92h18l10-92z" fill="#fbbf24" opacity=".85" />
      <path d="M26 90h72" stroke="#fde68a" strokeWidth="4" />
    </g>
  ),
  cooker: (
    <g fill="currentColor">
      <rect x="26" y="44" width="68" height="52" rx="12" />
      <rect x="22" y="34" width="76" height="14" rx="7" opacity=".85" />
      <rect x="52" y="22" width="16" height="12" rx="3" />
      <rect x="42" y="60" width="36" height="16" rx="4" fill="#fff" opacity=".25" />
    </g>
  ),
  vacuum: (
    <g fill="currentColor">
      <rect x="56" y="10" width="8" height="70" rx="4" />
      <rect x="46" y="26" width="28" height="30" rx="10" />
      <path d="M40 84h40l6 14H34z" />
    </g>
  ),
  reader: (
    <g>
      <rect x="32" y="12" width="56" height="96" rx="8" fill="currentColor" />
      <rect x="38" y="20" width="44" height="74" rx="2" fill="#f8fafc" opacity=".9" />
      {[30, 38, 46, 54, 62, 70].map((y) => (
        <rect key={y} x="43" y={y} width={y % 16 ? 30 : 34} height="3" rx="1.5" fill="#94a3b8" />
      ))}
    </g>
  ),
};

export function ProductImage({ icon, color, size = 'md' }: { icon: string; color: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <div className={`product-image product-image--${size}`} style={{ ['--tint' as string]: color }}>
      <svg viewBox="0 0 120 120" style={{ color }} aria-hidden="true">
        {ICONS[icon] ?? ICONS.phone}
      </svg>
    </div>
  );
}
