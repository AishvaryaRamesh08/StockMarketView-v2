/** Tiny intraday price line. Coloured by direction versus the previous close (dashed baseline). */
export function Sparkline({ values, prevClose, width = 64, height = 22 }: { values?: number[]; prevClose?: number | null; width?: number; height?: number }) {
  if (!values || values.length < 2) return <svg className="sparkline" width={width} height={height} aria-hidden />;
  const all = prevClose != null ? [...values, prevClose] : values;
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;
  const x = (i: number) => (i / (values.length - 1)) * (width - 2) + 1;
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4);
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const up = values[values.length - 1] >= (prevClose ?? values[0]);
  return (
    <svg className={`sparkline ${up ? 'up' : 'down'}`} width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      {prevClose != null && <line x1="0" x2={width} y1={y(prevClose)} y2={y(prevClose)} className="spark-base" />}
      <path d={d} />
    </svg>
  );
}
