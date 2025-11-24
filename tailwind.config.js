/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./src/**/*.{astro,html,js,jsx,ts,tsx,vue}", // parcours tous les fichiers Astro/Vue/JS
  ],
  theme: {
    extend: {
      fontFamily: {
        anton : ['anton', 'sans-serif'],
        nunito : ['nunito', 'sans-serif'],
        mabryLight: ['mabryLight'],
        mabry: ['mabry'],
        mabryMedium: ['mabryMedium'],
        mabryBold: ['mabryBold'],
        mabryBlack: ['mabryBlack'],
      }
    },
  },
  plugins: [],
}

