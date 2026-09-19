/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: 'rgb(107, 199, 250)',
        checker: {
          light: 'rgb(56, 56, 56)',
          dark: 'rgb(41, 41, 41)'
        }
      },
      fontFamily: {
        ui: ['Segoe UI', 'system-ui', 'sans-serif']
      }
    }
  },
  plugins: []
}
