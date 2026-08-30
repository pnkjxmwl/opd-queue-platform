/**
 * React Native mirror of docs/Design.md (calm clinical, light-only for MVP).
 * apps/web/tailwind.config.ts is the web twin - change both together.
 *
 * docs/Design.md 12 is the source: every token below traces to a row in that doc.
 * Nothing here is invented, and no screen should hardcode a colour or a radius.
 */
export const theme = {
  color: {
    primary: '#0E7C7B',
    accent: '#14B8A6',
    canvas: '#F7FAFC',
    surface: '#FFFFFF',
    text: '#0F172A',
    textMuted: '#64748B',
    textDisabled: '#94A3B8',
    border: '#E2E8F0',
    success: { fg: '#16A34A', bg: '#DCFCE7' },
    warning: { fg: '#D97706', bg: '#FEF3C7' },
    danger: { fg: '#DC2626', bg: '#FEE2E2' },
    info: { fg: '#2563EB', bg: '#DBEAFE' },

    /**
     * The full ramps (docs/Design.md 2.1, 2.2). The named roles above are the ones
     * screens normally reach for; these exist for the handful of places the design
     * calls out a specific step - teal-50 search fill, teal-100 avatars, teal-800
     * pressed states, slate-100 neutral pill backgrounds.
     */
    teal: {
      50: '#F0FDFA',
      100: '#CCFBF1',
      200: '#99F6E4',
      300: '#5EEAD4',
      400: '#2DD4BF',
      500: '#14B8A6',
      600: '#0D9488',
      700: '#0E7C7B',
      800: '#115E59',
      900: '#134E4A',
    },
    slate: {
      50: '#F8FAFC',
      100: '#F1F5F9',
      200: '#E2E8F0',
      300: '#CBD5E1',
      400: '#94A3B8',
      500: '#64748B',
      600: '#475569',
      700: '#334155',
      800: '#1E293B',
      900: '#0F172A',
    },
  },
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 20, 6: 24, 8: 32, 10: 40, 12: 48, 16: 64 },
  radius: { sm: 6, md: 10, lg: 16, xl: 24, full: 9999 },
  font: {
    display: { fontSize: 40, lineHeight: 48, fontWeight: '700' },
    h1: { fontSize: 28, lineHeight: 36, fontWeight: '700' },
    h2: { fontSize: 22, lineHeight: 30, fontWeight: '600' },
    h3: { fontSize: 18, lineHeight: 26, fontWeight: '600' },
    bodyLg: { fontSize: 16, lineHeight: 24, fontWeight: '400' },
    body: { fontSize: 14, lineHeight: 22, fontWeight: '400' },
    label: { fontSize: 14, lineHeight: 20, fontWeight: '500' },
    caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
    /** docs/Design.md 3: 11/16, 600, tracked +4%, UPPERCASE. Section headers. */
    overline: { fontSize: 11, lineHeight: 16, fontWeight: '600', letterSpacing: 0.44 },
  },

  /**
   * docs/Design.md 4 - soft, low-opacity shadows, never harsh.
   *
   * Both families are set on every level on purpose: iOS reads shadowColor/Offset/
   * Opacity/Radius and ignores `elevation`; Android reads only `elevation` and
   * ignores the rest. Setting one gives a card that is raised on one platform and
   * flat on the other, which is the "looks off on Android" bug in miniature.
   */
  elevation: {
    sm: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 2,
      elevation: 1,
    },
    md: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 3,
    },
    lg: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.12,
      shadowRadius: 28,
      elevation: 8,
    },
  },
} as const;
