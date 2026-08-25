import { Dimensions, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';

import { Colors } from '@/constants/theme';

const STARS = [
  { x: 0.08, y: 0.05, r: 1.1 },
  { x: 0.18, y: 0.09, r: 0.7 },
  { x: 0.27, y: 0.04, r: 1.3 },
  { x: 0.35, y: 0.12, r: 0.6 },
  { x: 0.46, y: 0.03, r: 0.9 },
  { x: 0.58, y: 0.08, r: 0.6 },
  { x: 0.68, y: 0.05, r: 1.2 },
  { x: 0.77, y: 0.11, r: 0.7 },
  { x: 0.86, y: 0.04, r: 1.0 },
  { x: 0.93, y: 0.09, r: 0.6 },
  { x: 0.14, y: 0.15, r: 0.5 },
  { x: 0.62, y: 0.14, r: 0.5 },
  { x: 0.4, y: 0.17, r: 0.8 },
];

export function PremiumBackground() {
  const { width, height } = Dimensions.get('window');

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[StyleSheet.absoluteFill, { backgroundColor: Colors.bg }]} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id="glowTop" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={Colors.gold} stopOpacity={0.22} />
            <Stop offset="100%" stopColor={Colors.gold} stopOpacity={0} />
          </RadialGradient>
          <RadialGradient id="glowBottom" cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={Colors.gold} stopOpacity={0.16} />
            <Stop offset="100%" stopColor={Colors.gold} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        <Circle cx={width * 0.1} cy={height * 0.02} r={width * 0.6} fill="url(#glowTop)" />
        <Circle cx={width * 0.95} cy={height} r={width * 0.65} fill="url(#glowBottom)" />

        {STARS.map((star, i) => (
          <Circle
            key={i}
            cx={width * star.x}
            cy={height * star.y}
            r={star.r}
            fill={Colors.text}
            opacity={0.5}
          />
        ))}
      </Svg>
    </View>
  );
}
