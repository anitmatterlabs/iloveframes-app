/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: { sans: ['"Inter Variable"', 'system-ui', 'sans-serif'] },
      colors: {
        // neutral graphite: no blue or purple cast in the chrome
        ink: { 950: '#09090b', 900: '#0e0e10', 850: '#121214', 800: '#17171a', 700: '#1e1e22', 600: '#28282d', 500: '#3a3a41' },
        // iloveframes brand: one warm ember accent, used sparingly, plus champagne for Pro.
        // Key names are kept from the old palette so every brand-* class follows the new tokens.
        brand: { pink: '#ff6a3d', rose: '#ff8f6b', orchid: '#ff8f6b', lilac: '#ffc2a8', violet: '#e8542c', deep: '#5e6573', gold: '#d9b27a' }
      },
      boxShadow: {
        glow: '0 0 0 1px rgba(255,143,107,.30), 0 10px 30px -10px rgba(255,106,61,.45)',
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
