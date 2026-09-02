// Sparkline — inline mini price chart using react-native-svg

import React, { useMemo } from 'react';
import Svg, { Polyline, Defs, LinearGradient, Stop, Path } from 'react-native-svg';
import { DS } from '@/lib/design';

interface SparklineProps {
  data: number[];
  positive?: boolean;
  width?: number;
  height?: number;
  strokeWidth?: number;
  showFill?: boolean;
}

export function Sparkline({
  data,
  positive = true,
  width = 64,
  height = 32,
  strokeWidth = 1.8,
  showFill = false,
}: SparklineProps) {
  const { points, fillPath } = useMemo(() => {
    if (!data || data.length < 2) return { points: '', fillPath: '' };
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const pad = 2;
    const pts = data.map((v, i) => {
      const x = (i / (data.length - 1)) * width;
      const y = height - pad - ((v - min) / range) * (height - pad * 2);
      return { x, y };
    });
    const polyPts = pts.map(p => `${p.x},${p.y}`).join(' ');
    const area = pts.map((p, i) => (i === 0 ? `M${p.x},${p.y}` : `L${p.x},${p.y}`)).join(' ')
      + ` L${pts[pts.length - 1].x},${height} L${pts[0].x},${height} Z`;
    return { points: polyPts, fillPath: area };
  }, [data, width, height]);

  const color = positive ? DS.color.buy : DS.color.sell;

  return (
    <Svg width={width} height={height}>
      {showFill && (
        <Defs>
          <LinearGradient id="sg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={color} stopOpacity="0.25" />
            <Stop offset="1" stopColor={color} stopOpacity="0" />
          </LinearGradient>
        </Defs>
      )}
      {showFill && <Path d={fillPath} fill="url(#sg)" />}
      <Polyline points={points} fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
    </Svg>
  );
}
