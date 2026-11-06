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
        raised: '#ebe5d7',
        ink: '#1b1915',
        secondary: '#4b473f',
        muted: '#78736a',
        hairline: '#dcd5c4',
        accent: '#b5321f',
        'accent-hover': '#8e2517',
      },
      borderRadius: { DEFAULT: '3px', sm: '3px', md: '3px', lg: '3px' },
      fontFamily: {
        serif: ['"Libertinus Serif"', 'Georgia', 'serif'],
        sans: ['system-ui', '-apple-system', '"Segoe UI"', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
