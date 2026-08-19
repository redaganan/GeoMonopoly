module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        'cyber-dark': '#0b0f1a',
        'neon-blue': '#00f0ff',
        'neon-green': '#39ff14',
        'neon-red': '#ff2d95',
      },
      boxShadow: {
        neon: '0 0 18px rgba(0,240,255,0.12), 0 0 28px rgba(57,255,20,0.06)',
      }
    },
    fontFamily: {
      sans: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'Helvetica', 'Arial']
    }
  },
  plugins: [],
}
