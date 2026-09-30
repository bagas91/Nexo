import React, { useMemo } from 'react';

interface SparklineProps {
  values: number[];
  className?: string;
  stroke?: string;
}

/** Mini linha SVG para tendência (ex.: últimos 7 dias). */
const Sparkline: React.FC<SparklineProps> = ({
  values,
  className = 'w-20 h-8',
  stroke = 'var(--bs-accent)',
}) => {
  const points = useMemo(() => {
    if (!values.length) return '';
    const max = Math.max(...values, 1);
    const min = Math.min(...values, 0);
    const span = Math.max(max - min, 1);
    const w = 80;
    const h = 28;
    const pad = 2;
    return values
      .map((v, i) => {
        const x = pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
        const y = h - pad - ((v - min) / span) * (h - pad * 2);
        return `${x},${y}`;
      })
      .join(' ');
  }, [values]);

  if (values.length < 2) {
    return <div className={className} />;
  }

  return (
    <svg viewBox="0 0 80 28" className={className} preserveAspectRatio="none" aria-hidden>
      <polyline
        points={points}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
};

export default Sparkline;
