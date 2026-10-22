export function LogoMark({ size = 18 }: { size?: number }) {
  const dots = [[16, 9, 1.35, 1], [15.06, 12.5, 1.3, .92], [12.5, 15.06, 1.25, .84], [9, 16, 1.2, .76], [5.5, 15.06, 1.15, .68], [2.94, 12.5, 1.1, .6], [2, 9, 1.05, .52], [2.94, 5.5, 1, .44], [5.5, 2.94, .95, .36], [9, 2, .9, .3], [12.5, 2.94, .9, .26], [15.06, 5.5, .9, .22]];
  return (
    <svg width={size} height={size} viewBox="0 0 18 18" aria-hidden="true">
      {dots.map(([cx, cy, r, o], i) => <circle key={i} cx={cx} cy={cy} r={r} fill="#0B0B0C" fillOpacity={o} />)}
      <circle cx="9" cy="9" r="1.7" fill="#0B0B0C" />
    </svg>
  );
}

export function Wordmark({ size = 16 }: { size?: number }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <LogoMark size={size + 2} />
      <span style={{ fontSize: size, fontWeight: 600, letterSpacing: "-0.02em" }}>scout</span>
    </span>
  );
}
