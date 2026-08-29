import type { Config } from 'tailwindcss';

/**
 * Theme transcribed from docs/Design.md (calm clinical, light-only for MVP).
 * apps/mobile/theme.ts is the React Native mirror of this - change both together.
 */
export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}', './lib/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
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
        primary: '#0E7C7B',
        accent: '#14B8A6',
        canvas: '#F7FAFC',
        surface: '#FFFFFF',
        ink: {
          DEFAULT: '#0F172A',
          muted: '#64748B',
          disabled: '#94A3B8',
        },
        line: '#E2E8F0',
        // Semantic - docs/Design.md 2.3
        success: { DEFAULT: '#16A34A', bg: '#DCFCE7' },
        warning: { DEFAULT: '#D97706', bg: '#FEF3C7' },
        danger: { DEFAULT: '#DC2626', bg: '#FEE2E2' },
        info: { DEFAULT: '#2563EB', bg: '#DBEAFE' },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'Roboto', 'Segoe UI', 'sans-serif'],
      },
      fontSize: {
        display: ['40px', { lineHeight: '48px', fontWeight: '700' }],
        h1: ['28px', { lineHeight: '36px', fontWeight: '700' }],
        h2: ['22px', { lineHeight: '30px', fontWeight: '600' }],
        h3: ['18px', { lineHeight: '26px', fontWeight: '600' }],
        'body-lg': ['16px', { lineHeight: '24px' }],
        body: ['14px', { lineHeight: '22px' }],
        label: ['14px', { lineHeight: '20px', fontWeight: '500' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
      },
      borderRadius: { sm: '6px', md: '10px', lg: '16px', xl: '24px' },
      boxShadow: {
        sm: '0 1px 2px rgba(15,23,42,0.06)',
        md: '0 4px 12px rgba(15,23,42,0.08)',
        lg: '0 12px 28px rgba(15,23,42,0.12)',
      },
    },
  },
  plugins: [],
} satisfies Config;
