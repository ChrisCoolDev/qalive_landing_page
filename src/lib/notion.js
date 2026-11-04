import notionPkg from '@notionhq/client';
import n2mPkg from 'notion-to-md';
import { marked } from 'marked';

const Client = notionPkg.Client || notionPkg.default?.Client;
const NotionToMarkdown = n2mPkg.NotionToMarkdown || n2mPkg.default?.NotionToMarkdown;

const NOTION_SECRET = import.meta.env.NOTION_SECRET || process.env.NOTION_SECRET;
const BLOG_DB_ID = import.meta.env.NOTION_BLOG_DATABASE_ID || process.env.NOTION_BLOG_DATABASE_ID;
const CHANGELOG_DB_ID = import.meta.env.NOTION_CHANGELOG_DATABASE_ID || process.env.NOTION_CHANGELOG_DATABASE_ID;

const notion = NOTION_SECRET ? new Client({ auth: NOTION_SECRET }) : null;
const n2m = notion ? new NotionToMarkdown({ notionClient: notion }) : null;

/**
 * Helper utilitaire pour générer un slug à partir d'un titre
 */
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-');
}

/**
 * Fonction helper robuste pour interroger une base de données Notion
 * compatible avec toutes les versions de @notionhq/client (v2, v4, v5+)
 */
async function queryDatabase(database_id, queryParams = {}) {
  if (!notion) return { results: [] };

  // Support de la nouvelle API Notion v5+ (Data Sources)
  if (typeof notion.dataSources?.query === 'function') {
    let dsId = database_id;
    try {
      const db = await notion.databases.retrieve({ database_id });
      if (db?.data_sources?.[0]?.id) {
        dsId = db.data_sources[0].id;
      }
    } catch {
      // Si l'ID passé est déjà un data_source_id ou en cas d'erreur de retrieve
    }
    return notion.dataSources.query({ data_source_id: dsId, ...queryParams });
  }

  // Support rétrocompatible Notion v2
  if (typeof notion.databases?.query === 'function') {
    return notion.databases.query({ database_id, ...queryParams });
  }

  if (typeof notion.request === 'function') {
    return notion.request({
      path: `databases/${database_id}/query`,
      method: 'post',
      body: queryParams,
    });
  }
  throw new Error('Notion client does not support database query');
}

/**
 * Helper d'extraction flexible de propriétés Notion (insensible à la casse / variantes)
 */
function getProp(props, ...possibleNames) {
  for (const name of possibleNames) {
    if (props[name]) return props[name];
    // recherche insensible à la casse
    const key = Object.keys(props).find(k => k.toLowerCase() === name.toLowerCase());
    if (key && props[key]) return props[key];
  }
  return null;
}

function getTextValue(prop) {
  if (!prop) return '';
  if (prop.title && prop.title.length > 0) return prop.title.map(t => t.plain_text).join('');
  if (prop.rich_text && prop.rich_text.length > 0) return prop.rich_text.map(t => t.plain_text).join('');
  if (prop.select) return prop.select.name || '';
  if (prop.status) return prop.status.name || '';
  return '';
}

/**
 * Récupère tous les articles de blog publiés pour une langue donnée (EN ou FR)
 */
export async function getBlogPosts(lang = 'EN') {
  if (!notion || !BLOG_DB_ID) {
    console.warn('[Notion CMS] NOTION_SECRET ou NOTION_BLOG_DATABASE_ID manquant dans .env. Rendu d\'exemple activé.');
    return [
      {
        id: 'sample-1',
        title: lang.toUpperCase() === 'FR' ? 'Comment nous avons créé QALive' : 'How We Built QALive for Live Presentations',
        slug: 'how-we-built-qalive',
        language: lang.toUpperCase(),
        date: '2026-11-04',
        excerpt: lang.toUpperCase() === 'FR' 
          ? 'Découvrez pourquoi nous avons conçu un outil de présentation interactif tout-en-un sans friction pour les speakers.'
          : 'Discover why we designed an all-in-one interactive presentation tool with zero friction for speakers.',
        cover: null,
      }
    ];
  }

  try {
    const targetLang = lang.toUpperCase();
    const response = await queryDatabase(BLOG_DB_ID);

    const posts = response.results
      .map((page) => {
        const props = page.properties || {};
        const titleProp = getProp(props, 'Title', 'Name', 'Titre', 'Nom');
        const slugProp = getProp(props, 'Slug', 'slug', 'URL');
        const langProp = getProp(props, 'Language', 'Langue', 'Lang');
        const statusProp = getProp(props, 'Status', 'Statut', 'State');
        const dateProp = getProp(props, 'Published Date', 'Date', 'Published', 'Publication');
        const excerptProp = getProp(props, 'Excerpt', 'Description', 'Resume', 'Résumé', 'Texte');

        const title = getTextValue(titleProp) || 'Untitled';
        const rawSlug = getTextValue(slugProp);
        const slug = rawSlug || slugify(title) || page.id;
        const pageLang = (getTextValue(langProp) || 'EN').toUpperCase();
        const status = (getTextValue(statusProp) || 'Published').toLowerCase();
        const date = dateProp?.date?.start || page.created_time?.split('T')[0] || '2026-11-04';
        const excerpt = getTextValue(excerptProp);
        const cover = page.cover?.external?.url || page.cover?.file?.url || null;

        return {
          id: page.id,
          title,
          slug,
          language: pageLang,
          status,
          date,
          excerpt,
          cover,
        };
      })
      // Filtrer par statut publié et par langue (avec repli si la langue n'est pas spécifiée)
      .filter((post) => {
        const isPublished = ['published', 'publié', 'done', 'terminé', 'termine'].includes(post.status);
        const matchesLang = post.language === targetLang || (!post.language && targetLang === 'EN');
        return isPublished && matchesLang;
      })
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return posts;
  } catch (error) {
    console.error('[Notion CMS] Erreur lors de la récupération des articles:', error);
    return [];
  }
}

/**
 * Récupère le contenu complet d'un article par son slug et sa langue
 */
export async function getPostBySlug(slug, lang = 'EN') {
  const targetLang = lang.toUpperCase();

  if (!notion || !BLOG_DB_ID) {
    return {
      title: targetLang === 'FR' ? 'Comment nous avons créé QALive' : 'How We Built QALive for Live Presentations',
      slug,
      language: targetLang,
      date: '2026-11-04',
      excerpt: 'Sample post',
      cover: null,
      contentHtml: `
        <h2>Introduction</h2>
        <p>This is a sample preview post rendered because your <code>.env</code> file is being configured.</p>
        <p>Once you paste your <code>NOTION_SECRET</code> and <code>NOTION_BLOG_DATABASE_ID</code> in <code>.env</code>, your real Notion content with headings, images, callouts, and links will display here automatically!</p>
      `,
    };
  }

  try {
    const allPosts = await getBlogPosts(targetLang);
    const postMeta = allPosts.find((p) => p.slug === slug);

    if (!postMeta) return null;

    let contentHtml = '';
    if (n2m) {
      const mdBlocks = await n2m.pageToMarkdown(postMeta.id);
      const mdString = n2m.toMarkdownString(mdBlocks);
      contentHtml = marked.parse(mdString.parent || '');
    }

    return {
      ...postMeta,
      contentHtml,
    };
  } catch (error) {
    console.error(`[Notion CMS] Erreur lors de la récupération de l'article "${slug}":`, error);
    return null;
  }
}

/**
 * Récupère les entrées du Changelog
 */
export async function getChangelogEntries(lang = 'EN') {
  const targetLang = lang.toUpperCase();

  if (!notion || !CHANGELOG_DB_ID) {
    return [
      {
        id: 'sample-change-1',
        version: 'v2.2.0',
        title: targetLang === 'FR' ? 'Réactions Live & Écran de Scène' : 'Live Reactions & Interactive Stage View',
        date: '2026-11-04',
        type: 'New Feature',
        contentHtml: `<p>${targetLang === 'FR' ? 'Support des réactions en direct du public et grand écran de scène interactif.' : 'Audience live reaction bar and full-screen presenter stage view.'}</p>`,
      },
      {
        id: 'sample-change-2',
        version: 'v2.1.0',
        title: targetLang === 'FR' ? 'Améliorations des Quotas et Protection des Sessions' : 'Session Limits & Revenue Protection',
        date: '2026-11-02',
        type: 'Improvement',
        contentHtml: `<p>${targetLang === 'FR' ? 'Sécurisation des limites de questions et webhook Lemon Squeezy durci.' : 'Secured 70-question limit enforcement and hardened Lemon Squeezy webhook.'}</p>`,
      }
    ];
  }

  try {
    const response = await queryDatabase(CHANGELOG_DB_ID);

    const entries = await Promise.all(
      response.results.map(async (page) => {
        const props = page.properties || {};
        const versionProp = getProp(props, 'Version', 'Name', 'Title', 'Titre');
        const titleProp = getProp(props, 'Title', 'Titre', 'Description');
        const langProp = getProp(props, 'Language', 'Langue', 'Lang');
        const statusProp = getProp(props, 'Status', 'Statut', 'State');
        const dateProp = getProp(props, 'Release Date', 'Date', 'Released');
        const typeProp = getProp(props, 'Type', 'Category', 'Catégorie');

        const version = getTextValue(versionProp) || 'v1.0.0';
        const title = getTextValue(titleProp) || version;
        const pageLang = (getTextValue(langProp) || 'EN').toUpperCase();
        const status = (getTextValue(statusProp) || 'Published').toLowerCase();
        const date = dateProp?.date?.start || page.created_time?.split('T')[0] || '2026-11-04';
        const type = getTextValue(typeProp) || 'Update';

        const isPublished = ['published', 'publié', 'done', 'terminé', 'termine'].includes(status);
        const matchesLang = pageLang === targetLang || (!pageLang && targetLang === 'EN');

        if (!isPublished || !matchesLang) {
          return null;
        }

        let contentHtml = '';
        if (n2m) {
          const mdBlocks = await n2m.pageToMarkdown(page.id);
          const mdString = n2m.toMarkdownString(mdBlocks);
          contentHtml = marked.parse(mdString.parent || '');
        }

        return {
          id: page.id,
          version,
          title,
          date,
          type,
          contentHtml,
        };
      })
    );

    return entries
      .filter(Boolean)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (error) {
    console.error('[Notion CMS] Erreur lors de la récupération du Changelog:', error);
    return [];
  }
}

