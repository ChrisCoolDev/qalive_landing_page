import typography from '@tailwindcss/typography';

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
      },
      typography: {
        DEFAULT: {
          css: {
            maxWidth: '100%',
            color: '#161924',
            a: {
              color: '#E85D4A',
              textDecoration: 'underline',
              '&:hover': {
                color: '#d44d3c',
              },
            },
            'h1, h2, h3, h4': {
              color: '#161924',
              fontWeight: '600',
            },
            blockquote: {
              borderLeftColor: '#E85D4A',
              color: '#555',
            },
            code: {
              backgroundColor: '#F6F5EF',
              padding: '0.2rem 0.4rem',
              borderRadius: '0.25rem',
              fontWeight: '500',
            },
          },
        },
      },
    },
  },
  plugins: [typography],
}

