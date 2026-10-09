/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'system-ui', 'sans-serif'] },
      colors: {
        ink: { 950: '#07070a', 900: '#0c0c11', 850: '#111117', 800: '#16161d', 700: '#1d1d26', 600: '#272732', 500: '#3a3a48' },
        rose: { 400: '#ff6b9d', 500: '#ff4d8d', 600: '#f02d76' },
        violet: { 400: '#a78bfa', 500: '#8b5cf6' },
        // iloveframes brand: the pink to violet of the logo and the home headline
        brand: { pink: '#ff4d8d', rose: '#ff6b9d', orchid: '#c084fc', lilac: '#d8b4fe', violet: '#8b5cf6', deep: '#7c3aed' }
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(192,132,252,.35), 0 10px 30px -8px rgba(214,77,170,.55)',
        panel: '0 1px 0 0 rgba(255,255,255,.04) inset, 0 20px 50px -20px rgba(0,0,0,.6)'
      },
      keyframes: {
        'pulse-ring': { '0%': { transform: 'scale(.9)', opacity: '.8' }, '100%': { transform: 'scale(1.8)', opacity: '0' } },
        shimmer: { '0%': { backgroundPosition: '-200% 0' }, '100%': { backgroundPosition: '200% 0' } }
      },
      animation: { 'pulse-ring': 'pulse-ring 1.6s cubic-bezier(.2,.6,.3,1) infinite', shimmer: 'shimmer 2.4s linear infinite' }
    }
  },
  plugins: []
}
