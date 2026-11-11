import notionPkg from '@notionhq/client';
import n2mPkg from 'notion-to-md';
import { marked } from 'marked';

const Client = notionPkg.Client || notionPkg.default?.Client;
const NotionToMarkdown = n2mPkg.NotionToMarkdown || n2mPkg.default?.NotionToMarkdown;

const env = (typeof import.meta !== 'undefined' && import.meta.env) ? import.meta.env : {};
const NOTION_SECRET = env.NOTION_SECRET || process.env.NOTION_SECRET;
const BLOG_DB_ID = env.NOTION_BLOG_DATABASE_ID || process.env.NOTION_BLOG_DATABASE_ID;
const CHANGELOG_DB_ID = env.NOTION_CHANGELOG_DATABASE_ID || process.env.NOTION_CHANGELOG_DATABASE_ID;

const notion = NOTION_SECRET ? new Client({ auth: NOTION_SECRET }) : null;
const n2m = notion ? new NotionToMarkdown({ notionClient: notion }) : null;

/**
 * Helper utilitaire pour générer un slug propre à partir d'un titre
 */
function slugify(text) {
  return text
    .toString()
    .toLowerCase()
    .trim()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .replace(/[^\w\-]+/g, '')
    .replace(/\-\-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Interroge une base de données Notion (compatible @notionhq/client v2, v4 et v5+ Data Sources)
 */
async function queryDatabase(database_id, queryParams = {}) {
  if (!notion || !database_id) return { results: [] };

  if (typeof notion.dataSources?.query === 'function') {
    let dsId = database_id;
    try {
      const db = await notion.databases.retrieve({ database_id });
      if (db?.data_sources?.[0]?.id) {
        dsId = db.data_sources[0].id;
      }
    } catch {
      // Si database_id est déjà un data_source_id
    }
    return notion.dataSources.query({ data_source_id: dsId, ...queryParams });
  }

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
 * Recherche une propriété Notion par liste de noms possibles (insensible à la casse)
 */
function getProp(props, ...possibleNames) {
  if (!props) return null;
  for (const name of possibleNames) {
    if (props[name]) return props[name];
    const key = Object.keys(props).find((k) => k.toLowerCase() === name.toLowerCase());
    if (key && props[key]) return props[key];
  }
  return null;
}

function getTitleProp(props) {
  const byName = getProp(props, 'Title', 'Name', 'Titre', 'Nom', 'Article', 'Post');
  if (byName && byName.type === 'title') return byName;
  const anyTitle = Object.values(props || {}).find((p) => p?.type === 'title');
  return anyTitle || byName;
}

function getTextValue(prop) {
  if (!prop) return '';
  if (prop.title && prop.title.length > 0) return prop.title.map((t) => t.plain_text).join('');
  if (prop.rich_text && prop.rich_text.length > 0) return prop.rich_text.map((t) => t.plain_text).join('');
  if (prop.select) return prop.select.name || '';
  if (prop.multi_select && prop.multi_select.length > 0) return prop.multi_select.map((s) => s.name).join(', ');
  if (prop.status) return prop.status.name || '';
  if (prop.people && prop.people.length > 0) return prop.people[0].name || '';
  if (prop.url) return prop.url;
  if (typeof prop.number === 'number') return `${prop.number} min read`;
  return '';
}

function getCoverUrl(page, props) {
  if (page.cover?.external?.url) return page.cover.external.url;
  if (page.cover?.file?.url) return page.cover.file.url;
  const coverProp = getProp(props, 'Cover', 'Image', 'Thumbnail', 'Couverture', 'Illustration');
  if (!coverProp) return null;
  if (coverProp.files && coverProp.files.length > 0) {
    const fileObj = coverProp.files[0];
    return fileObj.external?.url || fileObj.file?.url || null;
  }
  if (coverProp.url) return coverProp.url;
  return null;
}

function normalizeLang(rawLang) {
  if (!rawLang) return '';
  const v = rawLang.trim().toUpperCase();
  if (['FR', 'FRANÇAIS', 'FRANCAIS', 'FRENCH', 'FR-FR'].includes(v)) return 'FR';
  if (['EN', 'ENGLISH', 'ANGLAIS', 'EN-US', 'EN-GB'].includes(v)) return 'EN';
  return v;
}

function isPagePublished(statusProp) {
  if (!statusProp) return { explicitPublished: false, isDraft: false };
  if (typeof statusProp.checkbox === 'boolean') {
    return { explicitPublished: statusProp.checkbox, isDraft: !statusProp.checkbox };
  }
  const raw = getTextValue(statusProp).trim().toLowerCase();
  if (!raw) return { explicitPublished: false, isDraft: false };
  const publishedValues = ['published', 'publié', 'publie', 'done', 'terminé', 'termine', 'live', 'ready', 'actif', 'online'];
  const draftValues = ['draft', 'brouillon', 'archived', 'archivé', 'archive', 'hidden'];
  return {
    explicitPublished: publishedValues.includes(raw),
    isDraft: draftValues.includes(raw),
  };
}

function stripMarkdown(md = '') {
  return md
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/[#>*_`~-]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function getFallbackPosts(lang = 'EN') {
  return [
    {
      id: 'sample-1',
      title: 'Why we built QAlive for live events and conferences',
      slug: 'why-we-built-qalive',
      language: 'EN',
      date: '2026-11-04',
      excerpt: 'Discover how QAlive gives every attendee a voice during conferences, panels, and workshops via a simple QR code—with zero app downloads or sign-ups.',
      cover: null,
      tag: 'Product',
      author: 'Christian Ludovic',
      readingTime: '3 min read',
    },
    {
      id: 'sample-2',
      title: '5 simple ways to increase attendee engagement during presentations',
      slug: '5-ways-to-increase-attendee-engagement',
      language: 'EN',
      date: '2026-11-08',
      excerpt: 'Turn passive listeners into active participants with real-time upvoting, anonymous questions, and clear moderation.',
      cover: null,
      tag: 'Guides',
      author: 'Christian Ludovic',
      readingTime: '4 min read',
    },
    {
      id: 'sample-3',
      title: 'Introducing Event Pass: Flexible Q&A for one-off summits and panels',
      slug: 'introducing-event-pass-pricing',
      language: 'EN',
      date: '2026-11-10',
      excerpt: 'Organizing a single summit or panel? The new $9 Event Pass gives you 7 days of unlimited sessions with zero recurring commitment.',
      cover: null,
      tag: 'Announcements',
      author: 'Christian Ludovic',
      readingTime: '2 min read',
    },
  ];
}

/**
 * Récupère tous les articles de blog depuis Notion pour une langue donnée (EN ou FR)
 */
export async function getBlogPosts(lang = 'EN') {
  const targetLang = lang.toUpperCase();

  if (!notion || !BLOG_DB_ID) {
    console.warn('[Notion CMS] NOTION_SECRET ou NOTION_BLOG_DATABASE_ID manquant dans .env.');
    return getFallbackPosts(targetLang);
  }

  try {
    const response = await queryDatabase(BLOG_DB_ID);
    const results = response.results || [];

    if (results.length === 0) {
      return getFallbackPosts(targetLang);
    }

    const mapped = results
      .map((page) => {
        const props = page.properties || {};
        const titleProp = getTitleProp(props);
        const slugProp = getProp(props, 'Slug', 'slug', 'URL', 'Lien');
        const langProp = getProp(props, 'Language', 'Langue', 'Lang', 'Locale');
        const statusProp = getProp(props, 'Status', 'Statut', 'State', 'État', 'Published', 'Publié');
        const dateProp =
          getProp(props, 'Published Date', 'Date', 'Published', 'Publication', 'Created') ||
          Object.values(props).find((p) => p?.type === 'date');
        const excerptProp = getProp(
          props,
          'Excerpt',
          'Description',
          'Resume',
          'Résumé',
          'Summary',
          'Extrait',
          'Subtitle',
          'Sous-titre',
          'Texte'
        );
        const tagProp = getProp(props, 'Tag', 'Tags', 'Category', 'Catégorie', 'Topic', 'Sujet', 'Type');
        const authorProp = getProp(props, 'Author', 'Auteur', 'Written by', 'Writer');
        const durationProp = getProp(props, 'Reading Time', 'Duration', 'Read time', 'Temps de lecture');

        const title = getTextValue(titleProp).trim();
        if (!title) return null;

        const rawSlug = getTextValue(slugProp).trim();
        const slug = rawSlug ? slugify(rawSlug) : slugify(title) || page.id;
        const pageLang = normalizeLang(getTextValue(langProp));
        const { explicitPublished, isDraft } = isPagePublished(statusProp);
        const date = dateProp?.date?.start || page.created_time?.split('T')[0] || new Date().toISOString().split('T')[0];
        const excerpt = getTextValue(excerptProp).trim();
        const cover = getCoverUrl(page, props);
        const rawTag = getTextValue(tagProp).split(',')[0]?.trim();
        const tag = rawTag || (targetLang === 'FR' ? 'Article' : 'Insights');
        const author = getTextValue(authorProp).trim() || 'QAlive Team';
        const readingTime =
          getTextValue(durationProp).trim() || (targetLang === 'FR' ? '4 min de lecture' : '4 min read');

        return {
          id: page.id,
          title,
          slug,
          language: pageLang,
          explicitPublished,
          isDraft,
          date,
          excerpt,
          cover,
          tag,
          author,
          readingTime,
        };
      })
      .filter(Boolean);

    // Filtrage du statut : si au moins un article est explicitement marqué "Published/Publié/Done",
    // on ne garde que ceux-là ; sinon on garde tous ceux qui ne sont pas en "Draft/Brouillon".
    const hasExplicitPublished = mapped.some((p) => p.explicitPublished);
    const statusFiltered = mapped.filter((p) =>
      hasExplicitPublished ? p.explicitPublished : !p.isDraft
    );

    // Filtrage par langue : on garde les articles de la langue cible ou sans langue spécifiée.
    let langFiltered = statusFiltered.filter(
      (p) => !p.language || p.language === targetLang
    );

    // Si aucun article n'est trouvé dans la langue cible mais qu'il existe des articles publiés dans Notion,
    // on les affiche plutôt qu'une page vide.
    if (langFiltered.length === 0 && statusFiltered.length > 0) {
      langFiltered = statusFiltered;
    }

    if (langFiltered.length === 0) {
      return getFallbackPosts(targetLang);
    }

    return langFiltered.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  } catch (error) {
    console.error('[Notion CMS] Erreur lors de la récupération des articles:', error);
    return getFallbackPosts(targetLang);
  }
}

/**
 * Récupère un article complet par son slug et convertit ses blocs Notion en HTML
 */
export async function getPostBySlug(slug, lang = 'EN') {
  const targetLang = lang.toUpperCase();
  const isFr = targetLang === 'FR';

  try {
    const allPosts = await getBlogPosts(targetLang);
    const postIndex = allPosts.findIndex((p) => p.slug === slug);

    if (postIndex === -1) return null;

    const postMeta = allPosts[postIndex];
    const nextPost = postIndex > 0 ? allPosts[postIndex - 1] : null;
    const prevPost = postIndex < allPosts.length - 1 ? allPosts[postIndex + 1] : null;

    let contentHtml = '';
    let excerpt = postMeta.excerpt;
    let readingTime = postMeta.readingTime;

    if (n2m && !postMeta.id.startsWith('sample-')) {
      const mdBlocks = await n2m.pageToMarkdown(postMeta.id);
      const mdString = n2m.toMarkdownString(mdBlocks);
      const rawMd = mdString.parent || '';

      const words = rawMd.trim().split(/\s+/).filter(Boolean).length;
      if (words > 0) {
        const mins = Math.max(1, Math.round(words / 200));
        readingTime = isFr ? `${mins} min de lecture` : `${mins} min read`;
      }

      if (!excerpt && rawMd) {
        const plain = stripMarkdown(rawMd);
        excerpt = plain.length > 160 ? `${plain.slice(0, 157)}...` : plain;
      }

      contentHtml = marked.parse(rawMd);
    } else {
      if (postMeta.slug === '5-ways-to-increase-attendee-engagement') {
        contentHtml = `
          <p>Keeping an audience engaged during a 45-minute conference talk or town hall is one of the hardest challenges organizers face. Here are five practical strategies that make every session interactive.</p>
          <h2>1. Lower the barrier to ask questions</h2>
          <p>Most attendees will never raise their hand in a room of 200 people. With anonymous digital submissions via QR code, introverts and remote participants have the exact same voice.</p>
          <h2>2. Use upvoting to highlight group consensus</h2>
          <p>Instead of answering questions chronologically, let the audience upvote the questions they care about most. This guarantees the Q&amp;A segment addresses the highest-impact topics.</p>
          <h2>3. Moderate unobtrusively</h2>
          <p>Having an assistant or co-host filter duplicates and off-topic questions keeps the onstage rhythm fast-paced and professional.</p>
          <blockquote>"Audience engagement isn't about gimmicks—it's about removing social friction so questions can flow freely."</blockquote>
          <h2>4. Show questions on the main presentation screen</h2>
          <p>When attendees see questions appearing live on stage, participation snowballs.</p>
          <h2>5. Share session summaries post-event</h2>
          <p>Export questions and answers to follow up with attendees who had unanswered inquiries after time ran out.</p>
        `;
      } else if (postMeta.slug === 'introducing-event-pass-pricing') {
        contentHtml = `
          <p>Not everyone organizes recurring weekly events. Many speakers, event managers, and company leads organize one major summit or conference a year.</p>
          <h2>Introducing the $9 Event Pass</h2>
          <p>The <strong>Event Pass</strong> provides full access to QAlive's premium features for 7 consecutive days for a single one-time payment of $9.</p>
          <h2>What's included:</h2>
          <ul>
            <li><strong>Unlimited sessions</strong> for 7 days</li>
            <li><strong>Unlimited participants &amp; questions</strong> per session</li>
            <li><strong>Private sessions</strong> secured with custom access codes</li>
            <li><strong>Advance scheduling</strong> for upcoming conferences</li>
            <li><strong>File sharing up to 25 MB</strong> during presentations</li>
          </ul>
          <p>No monthly subscription or recurring billing to remember to cancel—just simple, transparent pricing designed around your event calendar.</p>
        `;
      } else {
        contentHtml = `
          <p><strong>QAlive</strong> was built to solve a simple problem at conferences, workshops, and town halls: giving every person in the room a voice with zero technical friction.</p>
          <h2>1. No app downloads, no account required</h2>
          <p>Simply display your session QR code on screen. Attendees scan it with their phone camera and can immediately submit questions live—anonymously or with their name.</p>
          <blockquote>"The best conference tools are the ones that get out of the way so real conversations between the speaker and the audience can happen."</blockquote>
          <h2>2. Real-time moderation and clean stage display</h2>
          <p>From your private dashboard, you stay in full control of which questions appear on the main presentation screen while keeping discussions dynamic and on-topic.</p>
        `;
      }
    }

    return {
      ...postMeta,
      excerpt,
      readingTime,
      contentHtml,
      prevPost,
      nextPost,
    };
  } catch (error) {
    console.error(`[Notion CMS] Erreur lors de la récupération de l'article "${slug}":`, error);
    return null;
  }
}

/**
 * Récupère les entrées du Changelog depuis Notion (ou entrées par défaut si non configuré)
 */
export async function getChangelogEntries(lang = 'EN') {
  const targetLang = lang.toUpperCase();
  const isFr = targetLang === 'FR';

  const fallbackEntries = [
    {
      id: 'sample-change-1',
      version: 'v2.2.0',
      title: isFr ? 'Nouveau domaine officiel qalive.online & Blog Notion' : 'Official qalive.online Domain & Notion CMS Blog',
      date: '2026-11-04',
      type: isFr ? 'Nouveauté' : 'New Feature',
      contentHtml: isFr
        ? `<p>Migration complète vers <strong>qalive.online</strong> (avec redirection automatique depuis qalive.ink) et lancement de notre blog et changelog propulsés par Notion.</p>`
        : `<p>Seamless migration to <strong>qalive.online</strong> (with automatic redirect from qalive.ink) and launch of our Notion-powered blog and product changelog.</p>`,
    },
    {
      id: 'sample-change-2',
      version: 'v2.1.0',
      title: isFr ? 'Écran de scène en direct & Modération rapide' : 'Live Stage Display & Instant Moderation',
      date: '2026-10-18',
      type: isFr ? 'Amélioration' : 'Improvement',
      contentHtml: isFr
        ? `<p>Affichage grand écran optimisé pour les vidéoprojecteurs de conférence et validation en un clic depuis le tableau de bord organisateur.</p>`
        : `<p>High-contrast stage view tailored for conference projectors and one-click question curation from the organizer dashboard.</p>`,
    },
    {
      id: 'sample-change-3',
      version: 'v2.0.0',
      title: isFr ? 'Soumission instantanée par QR code sans connexion' : 'Zero-Login QR Code Question Submission',
      date: '2026-09-12',
      type: isFr ? 'Nouveauté' : 'Release',
      contentHtml: isFr
        ? `<p>Les participants rejoignent la session en scannant le QR code sans créer de compte. Support des questions anonymes et suivi temps réel.</p>`
        : `<p>Attendees join any session by scanning the QR code with no signup required. Includes anonymous question support and real-time syncing.</p>`,
    },
  ];

  if (!notion || !CHANGELOG_DB_ID) {
    return fallbackEntries;
  }

  try {
    const response = await queryDatabase(CHANGELOG_DB_ID);
    const results = response.results || [];
    if (results.length === 0) return fallbackEntries;

    const entries = await Promise.all(
      results.map(async (page) => {
        const props = page.properties || {};
        const versionProp = getProp(props, 'Version', 'Tag', 'Release');
        const titleProp = getTitleProp(props) || getProp(props, 'Title', 'Titre', 'Name', 'Nom', 'Description');
        const langProp = getProp(props, 'Language', 'Langue', 'Lang');
        const statusProp = getProp(props, 'Status', 'Statut', 'State', 'Published');
        const dateProp =
          getProp(props, 'Release Date', 'Date', 'Released', 'Published Date') ||
          Object.values(props).find((p) => p?.type === 'date');
        const typeProp = getProp(props, 'Type', 'Category', 'Catégorie', 'Tag');

        const title = getTextValue(titleProp).trim();
        if (!title) return null;

        const version = getTextValue(versionProp).trim() || 'Update';
        const pageLang = normalizeLang(getTextValue(langProp));
        const { isDraft } = isPagePublished(statusProp);
        if (isDraft) return null;

        if (pageLang && pageLang !== targetLang) {
          return null;
        }

        const date = dateProp?.date?.start || page.created_time?.split('T')[0] || new Date().toISOString().split('T')[0];
        const type = getTextValue(typeProp).trim() || (isFr ? 'Mise à jour' : 'Update');

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

    const validEntries = entries
      .filter(Boolean)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

    return validEntries.length > 0 ? validEntries : fallbackEntries;
  } catch (error) {
    console.error('[Notion CMS] Erreur lors de la récupération du Changelog:', error);
    return fallbackEntries;
  }
}
