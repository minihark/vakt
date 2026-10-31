/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        serif: ['Newsreader', 'Georgia', 'serif'],
        sans: ['"Space Grotesk"', '"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      colors: {
        vakt: {
          bg: '#080C14',
          card: '#0E1422',
          hover: '#141C30',
          border: '#1A2438',
          'border-active': '#263552',
          emerald: '#10B981',
          amber: '#F59E0B',
          red: '#EF4444',
          cyan: '#06B6D4',
        },
      },
      boxShadow: {
        'radar': '0 0 25px -4px rgba(16, 185, 129, 0.25)',
        'incident': '0 0 25px -4px rgba(239, 68, 68, 0.35)',
      },
    },
  },
  plugins: [],
}
