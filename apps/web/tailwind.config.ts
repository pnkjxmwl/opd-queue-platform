import type { Config } from 'tailwindcss';

/**
 * The console's design tokens. `docs/Design.md` is the source; this is the web
 * mirror and `apps/mobile/theme.ts` is the React Native one.
 *
 * **The two mirrors share a palette and a spacing rhythm, not a type scale.** They
 * are different machines used by different people: the console is a dense desktop
 * tool a receptionist stares at for a whole shift on a 1440px monitor, and the app
 * is a phone held at arm's length by a patient who may be sixty. 28px screen titles
 * and 16px body are right on the phone and waste a third of the console's vertical
 * space. The scale below is therefore one step tighter throughout, and that
 * divergence is deliberate - recorded in docs/Design.md 3.
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

        /**
         * Four surfaces, not two.
         *
         * The console used `canvas` for the page, the sidebar, every table hover,
         * every neutral pill and every skeleton block, so a hovered row, an inactive
         * status and a loading placeholder were all literally the same colour as the
         * page behind them. `sunken` is the recessed one (rails, table heads, inert
         * pills); `raised` is a card lifted off the page; `hover` is the interaction
         * tint. They are close together on purpose - a console is not a landing
         * page - but they are no longer the same value.
         */
        canvas: '#F7FAFC',
        surface: '#FFFFFF',
        sunken: '#F1F5F9',
        hover: '#F8FAFC',

        ink: {
          DEFAULT: '#0F172A',
          soft: '#334155',
          muted: '#64748B',
          disabled: '#94A3B8',
        },
        line: {
          DEFAULT: '#E2E8F0',
          soft: '#EEF2F6',
          strong: '#CBD5E1',
        },

        // Semantic - docs/Design.md 2.3. `line` is the hairline that goes with the
        // fill, so a banner never has to reach for an arbitrary opacity.
        success: { DEFAULT: '#16A34A', bg: '#DCFCE7', line: '#BBF7D0' },
        warning: { DEFAULT: '#B45309', bg: '#FEF3C7', line: '#FDE68A' },
        danger: { DEFAULT: '#DC2626', bg: '#FEE2E2', line: '#FECACA' },
        info: { DEFAULT: '#2563EB', bg: '#DBEAFE', line: '#BFDBFE' },
      },
      fontFamily: {
        /** The variable next/font sets in app/layout.tsx, NOT the literal "Inter". */
        sans: ['var(--font-inter)', '-apple-system', 'Roboto', 'Segoe UI', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        /**
         * Negative tracking on everything above 18px. Inter is drawn a little loose
         * for display sizes, and headings set at 0 are the single most reliable tell
         * that a UI was assembled from defaults rather than typeset.
         */
        display: ['30px', { lineHeight: '36px', fontWeight: '700', letterSpacing: '-0.02em' }],
        h1: ['22px', { lineHeight: '28px', fontWeight: '600', letterSpacing: '-0.02em' }],
        h2: ['17px', { lineHeight: '24px', fontWeight: '600', letterSpacing: '-0.014em' }],
        h3: ['15px', { lineHeight: '20px', fontWeight: '600', letterSpacing: '-0.008em' }],
        'body-lg': ['15px', { lineHeight: '24px' }],
        body: ['13.5px', { lineHeight: '20px' }],
        label: ['13px', { lineHeight: '16px', fontWeight: '500' }],
        caption: ['12px', { lineHeight: '16px', fontWeight: '500' }],
        /** UPPERCASE section markers and column heads. docs/Design.md 3, Overline. */
        eyebrow: ['11px', { lineHeight: '14px', fontWeight: '600', letterSpacing: '0.06em' }],
      },
      borderRadius: {
        xs: '4px',
        sm: '6px',
        md: '8px',
        lg: '14px',
        xl: '20px',
      },
      boxShadow: {
        /**
         * Borders do the work; shadows only say "this floats above the page".
         *
         * The old scale put a 12px blur under every card, which on a screen holding
         * nine of them reads as haze rather than as hierarchy. Cards now take a
         * hairline plus `xs`; `md` and `lg` are reserved for things that genuinely
         * overlay - menus, the mobile nav drawer.
         */
        xs: '0 1px 2px rgba(15,23,42,0.04)',
        sm: '0 1px 3px rgba(15,23,42,0.06), 0 1px 2px rgba(15,23,42,0.04)',
        md: '0 4px 12px rgba(15,23,42,0.08)',
        lg: '0 16px 40px -8px rgba(15,23,42,0.18)',
        /** The focus ring, as a shadow so it can sit outside an overflow-hidden row. */
        focus: '0 0 0 2px #FFFFFF, 0 0 0 4px rgba(20,184,166,0.55)',
      },
      keyframes: {
        'fade-up': {
          from: { opacity: '0', transform: 'translateY(3px)' },
          to: { opacity: '1', transform: 'none' },
        },
        breathe: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.35' },
        },
      },
      animation: {
        'fade-up': 'fade-up 180ms cubic-bezier(0.16, 1, 0.3, 1)',
        breathe: 'breathe 2s ease-in-out infinite',
      },
    },
  },
  plugins: [],
} satisfies Config;
