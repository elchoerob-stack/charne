/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        navy: { DEFAULT: '#14284B', 50: '#EEF1F7', 100: '#D6DDEA', 200: '#A9B7D0', 400: '#4C6593', 600: '#1C3766', 700: '#14284B', 800: '#0E1D37', 900: '#0A1528', 950: '#060D1A' },
        gold: { DEFAULT: '#C9A227', 50: '#FBF6E6', 100: '#F5EAC4', 300: '#E2C766', 400: '#D6B443', 500: '#C9A227', 600: '#A6841C', 700: '#7C6215' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
