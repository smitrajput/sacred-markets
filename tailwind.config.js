/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#f4f0e7',
        sheet: '#fdfbf6',
        raised: '#ebe5d7',
        rule: '#dcd5c4',
        'rule-strong': '#c4b9a2',
        ink: '#1b1915',
        'ink-2': '#4b473f',
        'ink-3': '#78736a',
        accent: '#b5321f',
        'accent-deep': '#8e2517',
        up: '#1f6a3a',
      },
      borderRadius: { DEFAULT: '3px', sm: '3px', md: '3px', lg: '3px' },
      fontFamily: {
        serif: ['"Libertinus Serif"', 'Georgia', 'serif'],
        sans: ['"Libertinus Sans"', 'system-ui', 'sans-serif'],
        mono: ['"Libertinus Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.75rem', { lineHeight: '1rem' }],
        xs: ['0.8125rem', { lineHeight: '1.125rem' }],
        sm: ['0.9375rem', { lineHeight: '1.375rem' }],
        base: ['1.0625rem', { lineHeight: '1.625rem' }],
        lg: ['1.25rem', { lineHeight: '1.625rem' }],
        xl: ['1.5rem', { lineHeight: '1.875rem' }],
        '2xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '3xl': ['2.5rem', { lineHeight: '2.75rem' }],
      },
      maxWidth: { page: '72rem' },
      boxShadow: { sheet: '0 1px 0 rgba(27,25,21,0.03), 0 12px 32px -18px rgba(27,25,21,0.22)', pop: '0 18px 40px -16px rgba(27,25,21,0.35)' },
    },
  },
  plugins: [],
}
