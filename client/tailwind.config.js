/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          DEFAULT: '#0f172a',
          light: '#1e3a5f',
          50: '#f1f5f9',
        },
        gold: {
          DEFAULT: '#c9a227',
          light: '#e6c866',
          dark: '#a3831c',
        },
      },
      fontFamily: {
        sans: ['Rubik', 'Assistant', 'Arial', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
