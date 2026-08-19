/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'cyber-dark': '#0f172a',
        'neon-blue': '#22d3ee',
        'neon-green': '#10b981',
        'neon-red': '#f43f5e',
      },
    },
  },
  plugins: [],
}