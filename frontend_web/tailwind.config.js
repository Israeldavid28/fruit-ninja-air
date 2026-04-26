/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
    "./estilos/**/*.css"
  ],
  theme: {
    extend: {
      colors: {
        ninja: {
          dark: '#1a1a2e',
          orange: '#ff8c42',
          light: '#e0e0e0',
          accent: '#ff3b3b' // Para cortes o cosas rojas
        }
      },
      fontFamily: {
        sans: ['"Orbitron"', 'sans-serif'], // Fuente técnica/futurista
      }
    },
  },
  plugins: [],
}
