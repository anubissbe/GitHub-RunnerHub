/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#fff7ed',
          100: '#ffedd5',
          500: '#ff6500',
          600: '#ea5a00',
          700: '#d14e00',
          900: '#9a3800',
        },
        gray: {
          50: '#fafafa',
          100: '#f5f5f5',
          800: '#1f1f1f',
          900: '#0a0a0a',
        }
      },
      animation: {
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'spin-slow': 'spin 3s linear infinite',
      }
    },
  },
  plugins: [],
}