#!/usr/bin/env node
/**
 * Génère les pages trajet SEO (trajets/<slug>.html) à partir des trajets
 * listés dans trajets/trajets.json, en réutilisant les VRAIS calculs de
 * l'application (aucun tarif inventé) : chaque page est produite en
 * chargeant index.html dans un navigateur headless avec ?from=&to=, en
 * attendant le résultat réel, puis en l'injectant dans un gabarit statique.
 *
 * Nécessite un accès réseau réel aux APIs (BAN, ORS, data.gouv.fr, Worker
 * péages) : à exécuter via `npm run generate:trajets` en local, ou via le
 * workflow GitHub Actions .github/workflows/generate-trajets.yml (déclenché
 * manuellement), jamais dans un environnement au réseau restreint.
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TRAJETS = JSON.parse(fs.readFileSync(path.join(ROOT, 'trajets/trajets.json'), 'utf8'));
const SITE_URL = 'https://futeroute.fr';
const PORT = 8973;
const CALCUL_TIMEOUT_MS = 45000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAYS_MS = [15000, 45000];
const DELAY_BETWEEN_ROUTES_MS = 1000;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fmtEur(n) {
  return n.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' €';
}
function fmtDuree(sec) {
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h > 0 ? `${h} h ${m > 0 ? m + ' min' : ''}`.trim() : `${m} min`;
}
function fmtKm(n) {
  return Math.round(n).toLocaleString('fr-FR') + ' km';
}

// Sert le dépôt en statique le temps de la génération (index.html seul suffit).
function startServer() {
  const server = http.createServer((req, res) => {
    let filePath = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
    if (req.url === '/' || req.url.startsWith('/?')) filePath = path.join(ROOT, 'index.html');
    fs.readFile(filePath, (err, data) => {
      if (err) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': filePath.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise(resolve => server.listen(PORT, () => resolve(server)));
}

async function calculerTrajet(browser, depart, arrivee) {
  const page = await browser.newPage();
  const networkFailures = [];
  const rememberFailure = message => {
    if (message && !networkFailures.includes(message)) networkFailures.push(message);
  };
  const requestLabel = url => {
    try {
      const u = new URL(url);
      return u.host + u.pathname;
    } catch (_) {
      return url;
    }
  };

  // Les erreurs fetch/XHR sont conservées pour remplacer le timeout Playwright
  // opaque par le vrai service et le vrai code HTTP dans les logs de l'Action.
  page.on('response', response => {
    const request = response.request();
    if (['fetch', 'xhr'].includes(request.resourceType()) && !response.ok()) {
      rememberFailure(`${requestLabel(response.url())} HTTP ${response.status()}`);
    }
  });
  page.on('requestfailed', request => {
    if (['fetch', 'xhr'].includes(request.resourceType())) {
      const failure = request.failure();
      rememberFailure(`${requestLabel(request.url())} : ${failure ? failure.errorText : 'échec réseau'}`);
    }
  });

  try {
    await page.goto(
      `http://localhost:${PORT}/index.html?from=${encodeURIComponent(depart)}&to=${encodeURIComponent(arrivee)}`,
      { waitUntil: 'domcontentloaded', timeout: 20000 },
    );

    // Sort dès qu'un résultat existe OU que l'application affiche une erreur.
    // Sans ce second cas, un HTTP 429/4xx/5xx était masqué par 30 s d'attente.
    await page.waitForFunction(
      () => {
        const dataReady = typeof routeOptionsData !== 'undefined'
          && routeOptionsData
          && routeOptionsData.rapide
          && typeof routeOptionsData.rapide.coutA === 'number';
        const errorEl = document.getElementById('error');
        const calculationFailed = errorEl
          && getComputedStyle(errorEl).display !== 'none'
          && errorEl.textContent.trim().length > 0;
        return dataReady || calculationFailed;
      },
      { timeout: CALCUL_TIMEOUT_MS },
    );

    const result = await page.evaluate(() => {
      const dataReady = typeof routeOptionsData !== 'undefined'
        && routeOptionsData
        && routeOptionsData.rapide
        && typeof routeOptionsData.rapide.coutA === 'number';
      if (!dataReady) {
        const errorEl = document.getElementById('error');
        return { error: errorEl && errorEl.textContent.trim() || 'Calcul interrompu sans résultat.' };
      }
      const r = routeOptionsData.rapide;
      const z = routeOptionsData.zero || null;
      return {
        data: {
          distanceKm: r.distA,
          dureeSec: r.dureeSec,
          coutCarburant: r.coutA,
          coutPeage: typeof r.coutPeage === 'number' ? r.coutPeage : null,
          peageSource: r.peageSource || null,
          zero: z ? { distanceKm: z.distA, dureeSec: z.dureeSec, coutCarburant: z.coutA } : null,
        },
      };
    });

    if (!result.data) throw new Error(result.error);
    return result.data;
  } catch (error) {
    const baseMessage = error.name === 'TimeoutError'
      ? `délai dépassé après ${CALCUL_TIMEOUT_MS / 1000} s`
      : (error.message || 'Erreur inconnue');
    const details = networkFailures.length
      ? ` — ${networkFailures.slice(-4).join(' | ')}`
      : '';
    throw new Error(baseMessage + details);
  } finally {
    await page.close().catch(() => {});
  }
}

function verdictSansPeages(rapide, zero) {
  if (!zero || typeof rapide.coutPeage !== 'number') return null;
  const totalRapide = rapide.coutCarburant + rapide.coutPeage;
  const totalZero = zero.coutCarburant;
  const dE = totalRapide - totalZero;
  const dT = zero.dureeSec - rapide.dureeSec;
  if (dE <= 0.5) return { rentable: false, texte: `Éviter les péages ne fait pas économiser sur ce trajet (${fmtEur(Math.abs(dE))} de différence, pour ${fmtDuree(Math.abs(dT))} de plus) : autant prendre l'autoroute.` };
  return { rentable: true, dE, dT, texte: `Éviter les péages fait économiser ${fmtEur(dE)}, au prix de ${fmtDuree(dT)} de trajet en plus.` };
}

// Liens internes : autres trajets partageant une ville (départ ou arrivée)
// avec le trajet courant. Aide Google à explorer, et garde le visiteur sur le
// site. On ne relie qu'aux trajets RÉUSSIS (passés en paramètre), donc aucun
// lien mort.
function relatedLinks(t, all) {
  return all.filter(o => o.slug !== t.slug &&
    (o.depart === t.depart || o.arrivee === t.arrivee ||
     o.depart === t.arrivee || o.arrivee === t.depart)).slice(0, 8);
}

function renderHeader(annuaire) {
  return `<header class="entete">
  <a class="marque" href="/" aria-label="Futéroute – calculateur"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1098 169" width="1098" height="169" role="img" aria-label="Futé Route">
  <defs>
    <image id="wordmark" href="/futeroute-logo.webp" width="1098" height="169"/>
    <clipPath id="wordmark-left"><path d="M0 0H360V107H324L341 121Q338 129 330 133L320 138V169H0Z"/></clipPath>
    <clipPath id="wordmark-right"><rect x="658" width="440" height="169"/></clipPath>
  </defs>
  <use href="#wordmark" clip-path="url(#wordmark-left)" transform="translate(6 0)"/>
  <path transform="translate(6 0)" fill="#fcb00f" d="M324 109L341 121Q338 129 329 133L322 132L319 118Z"/>
  <use href="#wordmark" clip-path="url(#wordmark-right)" transform="translate(-19 0)"/>
  <image href="/logo%20rat%20seul.png" x="324" y="5" width="331" height="156" style="filter:drop-shadow(0 2px 2.5px rgba(18,42,70,.20))"/>
</svg></a>
  <nav class="rubriques" aria-label="Navigation principale">
    <a href="/">Calculateur</a>
    <a href="/trajets/" aria-current="${annuaire ? 'page' : 'location'}">Trajets</a>
    <a href="/accueil.html">À propos</a>
  </nav>
</header>`;
}

function renderPage(t, r, all) {
  const title = `Trajet ${t.depart} → ${t.arrivee} : coût, péages, faut-il éviter l'autoroute ? | Futéroute`;
  const totalRapide = r.coutCarburant + (r.coutPeage || 0);
  const verdict = verdictSansPeages(r, r.zero);
  const dateMaj = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
  const appUrl = `${SITE_URL}/index.html?from=${encodeURIComponent(t.depart)}&to=${encodeURIComponent(t.arrivee)}`;

  const faq = [
    {
      q: `Combien coûte le trajet ${t.depart} - ${t.arrivee} en voiture ?`,
      a: `Comptez environ ${fmtEur(totalRapide)} (carburant + péages, base SP95 à 6,6 L/100 km) pour ${fmtKm(r.distanceKm)}, soit ${fmtDuree(r.dureeSec)} de route.`
        + (typeof r.coutPeage === 'number' ? ` Les péages représentent ${fmtEur(r.coutPeage)} de ce total.` : ''),
    },
    {
      q: `Vaut-il le coup d'éviter les péages entre ${t.depart} et ${t.arrivee} ?`,
      a: verdict ? verdict.texte : `Le prix des péages n'a pas pu être déterminé pour ce trajet ; recalculez-le dans l'outil pour un chiffrage à jour.`,
    },
  ].map(f => `<details class="faq-item"><summary>${f.q}</summary><p>${f.a}</p></details>`).join('\n');

  const faqSchema = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: [
      { '@type': 'Question', name: `Combien coûte le trajet ${t.depart} - ${t.arrivee} en voiture ?`,
        acceptedAnswer: { '@type': 'Answer', text: `Environ ${fmtEur(totalRapide)} pour ${fmtKm(r.distanceKm)} (${fmtDuree(r.dureeSec)}).` } },
      { '@type': 'Question', name: `Vaut-il le coup d'éviter les péages entre ${t.depart} et ${t.arrivee} ?`,
        acceptedAnswer: { '@type': 'Answer', text: verdict ? verdict.texte : 'Non déterminé.' } },
    ],
  };

  // Fil d'Ariane en données structurées (rich result dans Google).
  const breadcrumbSchema = {
    '@context': 'https://schema.org', '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'Futéroute', item: `${SITE_URL}/` },
      { '@type': 'ListItem', position: 2, name: 'Trajets', item: `${SITE_URL}/trajets/` },
      { '@type': 'ListItem', position: 3, name: `${t.depart} → ${t.arrivee}`, item: `${SITE_URL}/trajets/${t.slug}.html` },
    ],
  };

  const rel = relatedLinks(t, all || []);
  const relatedHtml = rel.length ? `
  <div class="card">
    <h2 class="rel-title">Autres trajets à comparer</h2>
    <ul class="related">
      ${rel.map(o => `<li><a href="./${o.slug}.html">${o.depart} → ${o.arrivee}</a></li>`).join('\n      ')}
    </ul>
    <p class="rel-all"><a href="./">Voir tous les trajets →</a></p>
  </div>` : '';

  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<meta name="description" content="${t.depart} → ${t.arrivee} : ${fmtEur(totalRapide)} (carburant + péages), ${fmtKm(r.distanceKm)}, ${fmtDuree(r.dureeSec)}. ${verdict ? verdict.texte : ''} Chiffres mis à jour le ${dateMaj}.">
<link rel="canonical" href="${SITE_URL}/trajets/${t.slug}.html">
<meta property="og:title" content="${t.depart} → ${t.arrivee} : ${fmtEur(totalRapide)}">
<meta property="og:type" content="article">
<meta property="og:image" content="${SITE_URL}/logo%20trajet%20rat.png">
<link rel="icon" href="../favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="96x96" href="../favicon.png">
<script type="application/ld+json">${JSON.stringify(faqSchema)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumbSchema)}</script>
<link rel="stylesheet" href="/pages.css">
</head>
<body>
<div class="page">
${renderHeader(false)}
  <div class="breadcrumb"><a href="${SITE_URL}/">Futéroute</a> › <a href="./">Trajets</a> › ${t.depart} → ${t.arrivee}</div>
  <h1>${t.depart} → ${t.arrivee} : coût du trajet en voiture</h1>
  <div class="maj">Chiffres mis à jour le ${dateMaj} · estimation, hors trafic</div>

  <div class="card">
    <div class="bilan">
      <div class="total">${fmtEur(totalRapide)} au total</div>
      ${verdict ? `<div class="verdict ${verdict.rentable ? 'eco' : 'non-eco'}">${verdict.texte}</div>` : ''}
    </div>
    <div class="chiffres">
      <div class="chip"><div class="chip-label">Distance</div><div class="chip-value">${fmtKm(r.distanceKm)}</div></div>
      <div class="chip"><div class="chip-label">Durée</div><div class="chip-value">${fmtDuree(r.dureeSec)}</div></div>
    </div>
    <div class="chiffres">
      <div class="chip"><div class="chip-label">Carburant (SP95)</div><div class="chip-value">${fmtEur(r.coutCarburant)}</div></div>
      <div class="chip"><div class="chip-label">Péages</div><div class="chip-value">${typeof r.coutPeage === 'number' ? fmtEur(r.coutPeage) : 'n.c.'}</div></div>
    </div>
    <a class="cta" href="${appUrl}">Recalculer avec ma voiture (aller-retour, autre carburant, étapes…)</a>
    <div class="src-note">Carburant : moyenne France, prix du jour (data.gouv.fr). Péages : tarifs officiels des concessionnaires, classe 1 (voiture).</div>
  </div>

  <div class="card">
    <h2 class="rel-title">Questions fréquentes</h2>
    ${faq}
  </div>
${relatedHtml}
  <footer><a href="${SITE_URL}/">← Retour à Futéroute</a></footer>
</div>
</body>
</html>
`;
}

function renderIndex(reussis) {
  const items = reussis.map(t => `<li><a href="./${t.slug}.html">${t.depart} → ${t.arrivee}</a></li>`).join('\n');
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Coût des trajets en voiture : carburant, péages | Futéroute</title>
<meta name="description" content="Coût détaillé (carburant + péages) des trajets les plus recherchés en France, avec comparaison éviter/prendre les péages.">
<link rel="canonical" href="${SITE_URL}/trajets/">
<link rel="icon" href="../favicon.ico" sizes="any">
<link rel="icon" type="image/png" sizes="96x96" href="../favicon.png">
<link rel="stylesheet" href="/pages.css">
</head>
<body>
<div class="page">
${renderHeader(true)}
  <div class="breadcrumb"><a href="${SITE_URL}/">Futéroute</a> › Trajets</div>
  <h1>Coût des trajets en voiture</h1>
  <div class="card"><ul class="annuaire">${items}</ul></div>
  <footer><a href="${SITE_URL}/">← Retour à Futéroute</a></footer>
</div>
</body>
</html>
`;
}

async function main() {
  const server = await startServer();
  let browser;
  const outDir = path.join(ROOT, 'trajets');
  const resultsBySlug = new Map();
  const lastErrorsBySlug = new Map();

  try {
    browser = await chromium.launch();

    // Trois passes espacées plutôt que trois essais immédiats : les APIs ont
    // le temps de récupérer d'un quota minute ou d'une indisponibilité brève.
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const pending = TRAJETS.filter(t => !resultsBySlug.has(t.slug));
      if (!pending.length) break;

      if (attempt > 1) {
        const delayMs = RETRY_DELAYS_MS[attempt - 2];
        console.log(`\nPause de ${delayMs / 1000} s avant de retenter ${pending.length} trajet(s)…`);
        await sleep(delayMs);
      }
      console.log(`\nPasse ${attempt}/${MAX_ATTEMPTS} — ${pending.length} trajet(s)`);

      for (let i = 0; i < pending.length; i++) {
        const t = pending[i];
        process.stdout.write(`Calcul ${t.depart} → ${t.arrivee}… `);
        try {
          const r = await calculerTrajet(browser, t.depart, t.arrivee);
          resultsBySlug.set(t.slug, { ...t, r });
          lastErrorsBySlug.delete(t.slug);
          console.log('ok');
        } catch (error) {
          const message = error.message || 'Erreur inconnue';
          lastErrorsBySlug.set(t.slug, message);
          console.log(attempt < MAX_ATTEMPTS ? `à retenter : ${message}` : `échec définitif : ${message}`);
        }

        if (i < pending.length - 1) await sleep(DELAY_BETWEEN_ROUTES_MS);
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
    await new Promise(resolve => server.close(resolve));
  }

  const reussis = TRAJETS.filter(t => resultsBySlug.has(t.slug)).map(t => resultsBySlug.get(t.slug));
  const echecs = TRAJETS.filter(t => !resultsBySlug.has(t.slug));

  // Garde-fou : une panne large reste un vrai échec. Aucun fichier n'est
  // touché, donc une génération incomplète ne peut pas être publiée.
  const seuil = Math.ceil(TRAJETS.length * 0.7);
  if (reussis.length < seuil) {
    console.error(`\nTrop d'échecs : ${reussis.length}/${TRAJETS.length} réussis (seuil ${seuil}). Rien n'est écrit.`);
    for (const t of echecs) console.error(`- ${t.depart} → ${t.arrivee}: ${lastErrorsBySlug.get(t.slug)}`);
    process.exitCode = 1;
    return;
  }

  if (echecs.length) {
    console.warn(`\n${echecs.length} trajet(s) restent indisponibles après ${MAX_ATTEMPTS} passes. Leur dernière page valide sera conservée.`);
    for (const t of echecs) console.warn(`- ${t.depart} → ${t.arrivee}: ${lastErrorsBySlug.get(t.slug)}`);
  }

  // Une erreur isolée ne doit pas supprimer du maillage SEO une page déjà
  // publiée. Les nouveaux trajets sans fichier ne sont, eux, pas annoncés.
  const publiables = TRAJETS.filter(t =>
    resultsBySlug.has(t.slug) || fs.existsSync(path.join(outDir, `${t.slug}.html`)));

  for (const t of reussis) {
    fs.writeFileSync(path.join(outDir, `${t.slug}.html`), renderPage(t, t.r, publiables));
  }
  fs.writeFileSync(path.join(outDir, 'index.html'), renderIndex(publiables));

  const urls = publiables.map(t => `${SITE_URL}/trajets/${t.slug}.html`);
  urls.push(`${SITE_URL}/trajets/`);

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><changefreq>weekly</changefreq></url>
${urls.map(u => `  <url><loc>${u}</loc><changefreq>weekly</changefreq></url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(ROOT, 'sitemap.xml'), sitemap);
  console.log(`\n${reussis.length}/${TRAJETS.length} trajets recalculés ; ${publiables.length}/${TRAJETS.length} pages publiées. sitemap.xml mis à jour.`);
}

main();
