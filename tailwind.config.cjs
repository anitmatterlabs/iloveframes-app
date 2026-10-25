/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'system-ui', 'sans-serif'] },
      colors: {
        // neutral graphite: no blue or purple cast in the chrome
        ink: { 950: '#09090b', 900: '#0e0e10', 850: '#121214', 800: '#17171a', 700: '#1e1e22', 600: '#28282d', 500: '#3a3a41' },
        // iloveframes brand: one rose accent (the heart), used sparingly, plus champagne for Pro.
        // Key names are kept from the old palette so every brand-* class follows the new tokens.
        brand: { pink: '#ff4f7b', rose: '#ff7d9c', orchid: '#ff7d9c', lilac: '#ffc4d2', violet: '#e0375f', deep: '#5e6573', gold: '#d9b27a' }
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,125,156,.30), 0 10px 30px -10px rgba(255,79,123,.45)',
        lift: '0 1px 0 0 rgba(255,255,255,.7) inset, 0 1px 2px rgba(0,0,0,.4), 0 8px 24px -10px rgba(255,255,255,.28)',
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
