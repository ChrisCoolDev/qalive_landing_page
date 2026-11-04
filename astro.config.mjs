// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
    site: 'https://qalive.online',
    integrations: [sitemap()],
    i18n: {
        defaultLocale: 'en',
        locales: ['en', 'fr'],
        routing: {
            prefixDefaultLocale: false,
        },
    },
});
