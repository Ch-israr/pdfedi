/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef4ff',
          500: '#2f6bff',
          600: '#2456cc',
          700: '#1d46a8',
        },
      },
    },
  },
  plugins: [],
};
