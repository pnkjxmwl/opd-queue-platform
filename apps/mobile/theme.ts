/**
 * React Native mirror of docs/Design.md (calm clinical, light-only for MVP).
 * apps/web/tailwind.config.ts is the web twin - change both together.
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
  },
} as const;
