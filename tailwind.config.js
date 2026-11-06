/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        paper: '#f4f0e7',
        panel: '#fdfbf6',
        sheet: '#fdfbf6',
        raised: '#ebe5d7',
        ink: '#1b1915',
        secondary: '#4b473f',
        muted: '#78736a',
        hairline: '#dcd5c4',
        rule: '#dcd5c4',
        accent: '#b5321f',
        'accent-hover': '#8e2517',
        red: '#b5321f',
        deep: '#8e2517',
        white: '#ffffff',
      },
      borderRadius: { DEFAULT: '3px', sm: '3px', md: '3px', lg: '3px' },
      fontFamily: {
        serif: ['"Libertinus Serif"', 'Georgia', 'serif'],
        sans: ['"Libertinus Sans"', 'system-ui', 'sans-serif'],
        mono: ['"Libertinus Mono"', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        xs: ['0.875rem', { lineHeight: '1.25rem' }],
        sm: ['0.9375rem', { lineHeight: '1.375rem' }],
        base: ['1.0625rem', { lineHeight: '1.625rem' }],
        lg: ['1.25rem', { lineHeight: '1.625rem' }],
        xl: ['1.5rem', { lineHeight: '1.875rem' }],
        '2xl': ['1.75rem', { lineHeight: '2.125rem' }],
        '3xl': ['2rem', { lineHeight: '2.375rem' }],
      },
      maxWidth: { page: '70rem' },
    },
  },
  plugins: [],
}
