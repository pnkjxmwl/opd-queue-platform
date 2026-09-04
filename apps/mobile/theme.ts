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
  /**
   * docs/Design.md 4, and the same four steps the console uses.
   *
   * **`control` is the fifth, and it exists because it already did.** Every button
   * and every input in `lib/ui.tsx` hardcoded `borderRadius: 12` - a value that was
   * in no token table - while `pressable()` defaulted its ripple mask to `md`. So on
   * Android the ripple was clipped to a 10px corner inside a 12px button, which is
   * the kind of half-pixel wrongness nobody can name and everybody can see. One
   * token, used by both.
   *
   * `lg` came down from 16 to 14 with the console: on a 390pt phone a 16pt corner on
   * a full-bleed card is most of the way to a lozenge, and the tighter radius is what
   * makes a stack of cards read as a list rather than as a pile of pills.
   */
  radius: { sm: 6, md: 8, control: 12, lg: 14, xl: 20, full: 9999 },
  /**
   * The four Inter faces, by name.
   *
   * **React Native has no `fontWeight` once a real family is named.** Each weight is
   * a separate loaded face, so `fontFamily: 'Inter_400Regular'` with
   * `fontWeight: '700'` does not give you bold Inter - Android synthesises a smeared
   * faux-bold and iOS ignores it. Anywhere a style used to reach for a heavier
   * `fontWeight`, it names a face from here instead.
   *
   * Loaded in app/_layout.tsx and gated on the splash, so these names always resolve.
   */
  fontFamily: {
    regular: 'Inter_400Regular',
    medium: 'Inter_500Medium',
    semibold: 'Inter_600SemiBold',
    bold: 'Inter_700Bold',
  },

  /**
   * **`fontWeight` is set alongside `fontFamily` on every token, deliberately.**
   *
   * The refresh first dropped `fontWeight` on the reasoning that a named face like
   * `Inter_700Bold` already IS the bold, so a weight next to it risks a synthetic
   * double-bold. That reasoning is correct and the decision was still wrong, because
   * it ignored what happens when the face is missing.
   *
   * If Inter fails to load for any reason - a bundler cache, a dev client without
   * the asset, `useFonts` erroring and the app rendering anyway - Android falls back
   * to the system font. With no `fontWeight`, that fallback is REGULAR WEIGHT
   * EVERYWHERE: no bold headings, no semibold buttons, no weight on a token number.
   * The whole app goes flat and looks broken, and nothing in the code says why.
   *
   * Keeping the weight makes the bad path merely imperfect instead of catastrophic:
   * Android synthesises the weight it cannot find. The failure mode of a redundant
   * weight is a slightly heavy glyph; the failure mode of a missing one is an app
   * with no typographic hierarchy at all. Always take the first.
   */
  font: {
    display: { fontSize: 40, lineHeight: 48, fontFamily: 'Inter_700Bold', fontWeight: '700', letterSpacing: -1.2 },
    h1: { fontSize: 28, lineHeight: 36, fontFamily: 'Inter_700Bold', fontWeight: '700', letterSpacing: -0.6 },
    h2: { fontSize: 22, lineHeight: 30, fontFamily: 'Inter_600SemiBold', fontWeight: '600', letterSpacing: -0.4 },
    h3: { fontSize: 18, lineHeight: 26, fontFamily: 'Inter_600SemiBold', fontWeight: '600', letterSpacing: -0.2 },
    bodyLg: { fontSize: 16, lineHeight: 24, fontFamily: 'Inter_400Regular', fontWeight: '400' },
    body: { fontSize: 14, lineHeight: 22, fontFamily: 'Inter_400Regular', fontWeight: '400' },
    label: { fontSize: 14, lineHeight: 20, fontFamily: 'Inter_500Medium', fontWeight: '500' },
    caption: { fontSize: 12, lineHeight: 16, fontFamily: 'Inter_500Medium', fontWeight: '500' },
    /** docs/Design.md 3: 11/16, 600, tracked +4%, UPPERCASE. Section headers. */
    overline: { fontSize: 11, lineHeight: 16, fontFamily: 'Inter_600SemiBold', fontWeight: '600', letterSpacing: 0.44 },
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
    /**
     * The standard card (docs/Design.md 4). Always paired with a 1px `border` -
     * never the shadow alone.
     *
     * A shadow this soft vanishes against `canvas` on a cheap LCD in daylight, and a
     * border alone reads as a wireframe. Together they hold an edge in both
     * conditions, which is the entire job of a card on a phone used outdoors
     * outside a clinic.
     */
    card: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.05,
      shadowRadius: 8,
      elevation: 2,
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
