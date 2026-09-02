// ExchangeX Premium Design System
// Single source of truth for all visual tokens

export const DS = {
  // ── Colors ──────────────────────────────────────────────────────────────────
  color: {
    // Backgrounds
    bg:       '#0B0E12',
    bgAlt:    '#111827',
    card:     '#161B22',
    cardAlt:  '#1A2030',
    surface:  '#202630',
    // Brand
    gold:     '#F0B90B',
    goldDark: '#C99A09',
    goldBg:   '#F0B90B15',
    // Semantic
    buy:      '#0ECB81',
    buyBg:    '#0ECB8115',
    sell:     '#F6465D',
    sellBg:   '#F6465D15',
    warn:     '#FFA726',
    warnBg:   '#FFA72615',
    info:     '#1E90FF',
    infoBg:   '#1E90FF15',
    // Text
    text1:    '#F0F2F5',
    text2:    '#848E9C',
    text3:    '#4B5563',
    // Border
    border:   '#1E2530',
    border2:  '#2B3444',
    // Overlay
    overlay:  'rgba(0,0,0,0.70)',
    shimmer1: '#1A2030',
    shimmer2: '#242D3A',
  },

  // ── Spacing (4pt grid) ───────────────────────────────────────────────────────
  space: {
    xxs: 4,
    xs:  8,
    sm:  12,
    md:  16,
    lg:  24,
    xl:  32,
    xxl: 48,
    xxxl: 64,
  },

  // ── Border Radius ───────────────────────────────────────────────────────────
  radius: {
    xs:   4,
    sm:   8,
    md:   12,
    lg:   16,
    xl:   20,
    xxl:  24,
    full: 9999,
  },

  // ── Typography ──────────────────────────────────────────────────────────────
  font: {
    // Sizes
    xxxl: 32,
    xxl:  28,
    xl:   24,
    lg:   20,
    md:   18,
    base: 16,
    sm:   14,
    xs:   12,
    xxs:  11,
    xxxs: 10,
    // Weights
    regular:   '400' as const,
    medium:    '500' as const,
    semibold:  '600' as const,
    bold:      '700' as const,
    extrabold: '800' as const,
    // Line heights
    tight:  1.2,
    normal: 1.5,
    loose:  1.7,
  },

  // ── Animation ───────────────────────────────────────────────────────────────
  anim: {
    fast:   150,
    normal: 250,
    slow:   350,
  },

  // ── Tab bar ─────────────────────────────────────────────────────────────────
  tabBar: {
    height: 64,
    bgColor: '#0E1218',
    borderColor: '#1E2530',
    activeColor: '#F0B90B',
    inactiveColor: '#4B5563',
  },
} as const;

export type DSColor = keyof typeof DS.color;
export type DSSpace = keyof typeof DS.space;
