"use client";
/** Stable columns let each digit roll when depth changes, including backwards navigation. */
export function RollingNumber({ value }: { value: number }) {
  const digits = String(Math.max(0, Math.floor(value))).padStart(2, '0');
  return <span className="eidos-rolling-number" role="img" aria-label={`节点深度 ${value}`}>
    {digits.split('').map((digit, index) => <span className="eidos-rolling-digit" aria-hidden="true" key={digits.length - index}>
      <span className="eidos-rolling-reel" style={{ transform: `translateY(-${Number(digit) * 10}%)` }}>{Array.from({length:10}, (_, n) => <span key={n}>{n}</span>)}</span>
    </span>)}
  </span>;
}
