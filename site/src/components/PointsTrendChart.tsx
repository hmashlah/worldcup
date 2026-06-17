import { useMemo, useState } from 'react';
import { usePointsTrend, type PlayerTrend } from '@/hooks/usePointsTrend';
import { useAuth } from '@/contexts/AuthContext';

// Distinct colors for player lines
const LINE_COLORS = [
  '#e11d48', // rose
  '#2563eb', // blue
  '#16a34a', // green
  '#d97706', // amber
  '#7c3aed', // violet
  '#0891b2', // cyan
  '#c026d3', // fuchsia
  '#ea580c', // orange
  '#4f46e5', // indigo
  '#059669', // emerald
  '#dc2626', // red
  '#0d9488', // teal
];

const CHART_PADDING = { top: 24, right: 16, bottom: 32, left: 36 };

export function PointsTrendChart() {
  const { user } = useAuth();
  const { loading, trends, matchLabels } = usePointsTrend();
  const [hoveredPlayer, setHoveredPlayer] = useState<string | null>(null);

  const chartWidth = 700;
  const chartHeight = 280;
  const plotW = chartWidth - CHART_PADDING.left - CHART_PADDING.right;
  const plotH = chartHeight - CHART_PADDING.top - CHART_PADDING.bottom;

  const { paths, maxPts, xStep, yTicks } = useMemo(() => {
    if (!trends.length || !matchLabels.length) {
      return { paths: [], maxPts: 0, xStep: 0, yTicks: [] };
    }

    const maxPts = Math.max(...trends.map(t => t.finalTotal), 1);
    const numPoints = matchLabels.length;
    const xStep = numPoints > 1 ? plotW / (numPoints - 1) : plotW;

    // Y-axis ticks (aim for ~5 ticks)
    const tickInterval = Math.max(1, Math.ceil(maxPts / 5));
    const yTicks: number[] = [];
    for (let v = 0; v <= maxPts; v += tickInterval) yTicks.push(v);
    if (yTicks[yTicks.length - 1] < maxPts) yTicks.push(maxPts);

    const paths = trends.map((t, idx) => {
      const d = t.points
        .map((p, i) => {
          const x = CHART_PADDING.left + i * xStep;
          const y = CHART_PADDING.top + plotH - (p.cumulative / maxPts) * plotH;
          return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
        })
        .join(' ');

      return {
        userId: t.user_id,
        displayName: t.display_name,
        d,
        color: LINE_COLORS[idx % LINE_COLORS.length],
        finalTotal: t.finalTotal,
        lastX: CHART_PADDING.left + (numPoints - 1) * xStep,
        lastY: CHART_PADDING.top + plotH - (t.finalTotal / maxPts) * plotH,
      };
    });

    return { paths, maxPts, xStep, yTicks };
  }, [trends, matchLabels, plotW, plotH]);

  if (loading) return null;
  if (!trends.length || matchLabels.length < 2) return null;

  // Determine x-axis label density (show every Nth label)
  const labelEvery = Math.max(1, Math.ceil(matchLabels.length / 12));

  return (
    <div className="trend-chart">
      <div className="trend-chart-header">
        <span className="trend-chart-title">Points Race</span>
      </div>
      <div className="trend-chart-svg-wrap">
        <svg
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="trend-chart-svg"
          preserveAspectRatio="xMidYMid meet"
        >
          {/* Y-axis grid lines + labels */}
          {yTicks.map(v => {
            const y = CHART_PADDING.top + plotH - (v / maxPts) * plotH;
            return (
              <g key={v}>
                <line
                  x1={CHART_PADDING.left}
                  x2={chartWidth - CHART_PADDING.right}
                  y1={y}
                  y2={y}
                  className="trend-grid-line"
                />
                <text x={CHART_PADDING.left - 6} y={y + 3} className="trend-y-label">
                  {v}
                </text>
              </g>
            );
          })}

          {/* X-axis labels */}
          {matchLabels.map((label, i) => {
            if (i % labelEvery !== 0 && i !== matchLabels.length - 1) return null;
            const x = CHART_PADDING.left + i * xStep;
            return (
              <text key={i} x={x} y={chartHeight - 8} className="trend-x-label">
                {label}
              </text>
            );
          })}

          {/* Player lines */}
          {paths.map(p => {
            const isMe = p.userId === user?.id;
            const isHovered = hoveredPlayer === p.userId;
            const isFaded = hoveredPlayer && !isHovered;
            return (
              <path
                key={p.userId}
                d={p.d}
                fill="none"
                stroke={p.color}
                strokeWidth={isMe ? 2.5 : isHovered ? 2.5 : 1.8}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={isFaded ? 0.2 : 1}
                className="trend-line"
              />
            );
          })}

          {/* End-of-line dots */}
          {paths.map(p => {
            const isFaded = hoveredPlayer && hoveredPlayer !== p.userId;
            return (
              <circle
                key={`dot-${p.userId}`}
                cx={p.lastX}
                cy={p.lastY}
                r={3}
                fill={p.color}
                opacity={isFaded ? 0.2 : 1}
              />
            );
          })}
        </svg>
      </div>

      {/* Legend */}
      <div className="trend-legend">
        {paths.map(p => {
          const isMe = p.userId === user?.id;
          return (
            <button
              key={p.userId}
              className={'trend-legend-item' + (isMe ? ' is-me' : '') + (hoveredPlayer === p.userId ? ' is-hovered' : '')}
              onMouseEnter={() => setHoveredPlayer(p.userId)}
              onMouseLeave={() => setHoveredPlayer(null)}
              onFocus={() => setHoveredPlayer(p.userId)}
              onBlur={() => setHoveredPlayer(null)}
            >
              <span className="trend-legend-dot" style={{ background: p.color }} />
              <span className="trend-legend-name">{p.displayName}</span>
              <span className="trend-legend-pts">{p.finalTotal}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
