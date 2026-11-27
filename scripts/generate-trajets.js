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
  if (sec > 0 && sec < 60) return 'moins de 1 min';
  const minutes = Math.round(sec / 60);
  const h = Math.floor(minutes / 60), m = minutes % 60;
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
      null, { timeout: CALCUL_TIMEOUT_MS },
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
      const z = r.alternativeSansPeage;
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

const PAGE_COMPARATIF = 'comparatif-sans-peages.html';

function comparaisonPeages(r) {
  const centimes = montant => Math.round(montant * 100);
  const connu = n => Number.isFinite(n) && n >= 0;
  const totalRapide = connu(r.coutPeage) && connu(r.coutCarburant)
    ? (centimes(r.coutCarburant) + centimes(r.coutPeage)) / 100 : null;
  // Quand le rapide est gratuit, on peut le garder pour rouler sans péages.
  const sans = r.coutPeage === 0 ? r : r.zero;
  const totalSans = sans && connu(sans.coutCarburant) ? centimes(sans.coutCarburant) / 100 : null;
  const gain = totalRapide !== null && totalSans !== null
    ? (centimes(totalRapide) - centimes(totalSans)) / 100 : null;
  const detour = sans && connu(sans.dureeSec) && connu(r.dureeSec) ? sans.dureeSec - r.dureeSec : null;
  const taux = gain !== null && detour > 0 ? gain * 3600 / detour : null;

  let texte;
  if (r.coutPeage === 0) texte = 'Le trajet le plus rapide est déjà sans péage. Vous pouvez le garder au même coût et avec la même durée.';
  else if (totalRapide === null) texte = 'Le tarif des péages est inconnu. L’économie éventuelle reste à chiffrer.';
  else if (gain === null) texte = 'Le coût de l’itinéraire sans péage n’est pas disponible pour cette comparaison.';
  else {
    const budget = gain > 0 ? `Éviter les péages fait économiser ${fmtEur(gain)}`
      : gain < 0 ? `L’itinéraire sans péages coûte ${fmtEur(-gain)} de plus` : 'Les deux itinéraires coûtent le même prix';
    const temps = detour === null ? 'La durée du détour est inconnue.'
      : detour > 0 ? `Comptez ${fmtDuree(detour)} de route en plus.`
      : detour < 0 ? `Vous arrivez ${fmtDuree(-detour)} plus tôt.` : 'La durée est identique.';
    texte = `${budget}. ${temps}`;
  }
  return { sans, totalRapide, totalSans, gain, detour, taux, texte };
}

function montant(n) {
  return Number.isFinite(n) ? fmtEur(n) : 'Indisponible';
}
function dureeDetour(sec) {
  if (sec === null) return 'Indisponible';
  if (sec < 0) return `${fmtDuree(-sec)} de moins`;
  return fmtDuree(sec);
}
function tauxHoraire(n) {
  return fmtEur(n) + '/h';
}

const SOURCE_CARBURANT = '<a href="https://data.economie.gouv.fr/explore/dataset/prix-des-carburants-en-france-flux-instantane-v2/">prix des carburants du ministère de l’Économie</a>';
const SOURCE_ROUTE = '<a href="https://openrouteservice.org/">OpenRouteService</a> sur les données © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
const SOURCE_VINCI = '<a href="https://www.vinci-autoroutes.com/fr/mon-trajet/">VINCI Autoroutes</a>';
const SOURCE_MICHELIN = '<a href="https://www.viamichelin.fr/itineraires">ViaMichelin</a>';

function sourcePeage(r) {
  if (r.peageSource === 'vinci') return `Tarif de classe 1 fourni par ${SOURCE_VINCI}.`;
  if (r.peageSource === 'viamichelin') return `Tarif de classe 1 fourni par ${SOURCE_MICHELIN}.`;
  if (r.coutPeage === 0) return 'Le calculateur identifie un trajet rapide sans péage.';
  if (!(Number.isFinite(r.coutPeage) && r.coutPeage >= 0)) return 'Aucun tarif de péage confirmé pour le trajet rapide.';
  return `Le fournisseur du tarif de classe 1 n’est pas précisé dans ce relevé. Vérification possible sur ${SOURCE_VINCI} ou ${SOURCE_MICHELIN}.`;
}

function tableauTrajet(r, c) {
  const { sans } = c;
  const km = n => Number.isFinite(n) ? fmtKm(n) : 'Indisponible';
  const duree = n => Number.isFinite(n) ? fmtDuree(n) : 'Indisponible';
  const lignes = [
    ['Distance', km(r.distanceKm), km(sans?.distanceKm)],
    ['Durée', duree(r.dureeSec), duree(sans?.dureeSec)],
    ['Carburant', montant(r.coutCarburant), montant(sans?.coutCarburant)],
    ['Péages', c.totalRapide === null ? 'Tarif inconnu' : montant(r.coutPeage), sans ? fmtEur(0) : 'Indisponible'],
    ['Total', montant(c.totalRapide), montant(c.totalSans)],
  ];
  return `<table class="table-trajet"><caption>Coût et durée pour un aller simple</caption>
    <thead><tr><th scope="col">Parcours</th><th scope="col">${r.coutPeage > 0 ? 'Avec péages' : 'Rapide'}</th><th scope="col">Sans péages</th></tr></thead>
    <tbody>${lignes.map(([nom, rapide, alternatif]) => `<tr><th scope="row">${nom}</th><td>${rapide}</td><td>${alternatif}</td></tr>`).join('\n')}</tbody>
  </table>`;
}

function dateReleve() {
  return new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Paris' });
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

function renderPage(t, r, all, dateMaj = dateReleve()) {
  const title = `${t.depart} → ${t.arrivee} en voiture : coût avec et sans péages | Futéroute`;
  const c = comparaisonPeages(r);
  const peageConnu = c.totalRapide !== null;
  const carburant = fmtEur(r.coutCarburant);
  const prixLitre = r.distanceKm > 0 ? r.coutCarburant / (r.distanceKm * 6.6 / 100) : null;
  const prixAffiche = peageConnu ? fmtEur(c.totalRapide) : `${carburant} de carburant`;
  const appUrl = `/?from=${encodeURIComponent(t.depart)}&amp;to=${encodeURIComponent(t.arriveeGps || t.arrivee)}`;
  const description = `${t.depart} → ${t.arrivee} : ${prixAffiche}${peageConnu ? ' pour le trajet rapide' : ' (hors péages, tarif inconnu)'}. ${c.texte}${c.taux !== null ? ' Soit ' + tauxHoraire(c.taux) + ' de détour.' : ''}`;
  const trajet = `pour ${fmtKm(r.distanceKm)}, soit ${fmtDuree(r.dureeSec)} de route.`;
  const questions = [
    {
      q: `Combien coûte le trajet ${t.depart} - ${t.arrivee} en voiture ?`,
      a: peageConnu
        ? `Comptez environ ${prixAffiche} (carburant + péages, base SP95-E10 à 6,6 L/100 km) ${trajet} Les péages représentent ${fmtEur(r.coutPeage)} de ce total.`
        : `Comptez environ ${prixAffiche} (SP95-E10 à 6,6 L/100 km) ${trajet} Le tarif des péages est inconnu.`,
    },
    {
      q: `Vaut-il le coup d'éviter les péages entre ${t.depart} et ${t.arrivee} ?`,
      a: c.texte,
    },
  ];
  const faq = questions.map(f => `<details class="faq-item"><summary>${f.q}</summary><p>${f.a}</p></details>`).join('\n');

  const faqSchema = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: questions.map(f => ({
      '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a },
    })),
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
<meta name="description" content="${description}">
<link rel="canonical" href="${SITE_URL}/trajets/${t.slug}.html">
<meta property="og:title" content="${t.depart} → ${t.arrivee} : ${prixAffiche}${peageConnu ? '' : ' (hors péages)'}">
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

  <section class="card decision">
    <h2>Est-ce rentable d’éviter les péages ?</h2>
    <p>${c.texte}</p>
${t.slug === 'lyon-geneve' && r.peageSource === 'vinci' ? '<p class="src-note">Le montant VINCI couvre les péages français. Si vous devez acheter la vignette suisse pour cet itinéraire, ajoutez son prix au budget. <a href="https://www.bazg.admin.ch/fr/faq-vignette-et-achat-d-e-vignette">Conditions de la douane suisse</a>.</p>' : ''}
    <dl class="mesures">
      <div><dt>${c.gain < 0 ? 'Surcoût net' : 'Économie nette'}</dt><dd>${c.gain === null ? 'Indisponible' : fmtEur(Math.abs(c.gain))}</dd></div>
      <div><dt>Temps de route en plus</dt><dd>${dureeDetour(c.detour)}</dd></div>
      <div><dt>Économie par heure de détour</dt><dd>${c.taux !== null ? tauxHoraire(c.taux) : c.detour !== null && c.detour <= 0 ? 'Aucun détour' : 'Indisponible'}</dd></div>
    </dl>
    <a class="cta" href="${appUrl}">Recalculer ${t.depart} → ${t.arrivee} avec ma voiture</a>
  </section>

  <section class="card">
    <h2>Avec ou sans péages</h2>
    ${tableauTrajet(r, c)}
    <div class="src-note"><h3>Sources et hypothèses</h3>
      <p>Voiture de classe 1, SP95-E10 à 6,6 L/100 km. Le coût du carburant utilise la moyenne nationale du relevé du ${dateMaj}, issue des ${SOURCE_CARBURANT}${prixLitre === null ? '' : `, soit ${prixLitre.toLocaleString('fr-FR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })} €/L`}.</p>
      <p>Distances et durées hors trafic calculées par ${SOURCE_ROUTE}. ${sourcePeage(r)}</p>
${t.arriveeGps ? `<p>Le point d’arrivée retenu pour ${t.arrivee} est <a href="https://www.openstreetmap.org/search?query=${encodeURIComponent(t.arriveeGps)}">repéré sur la carte</a>.</p>` : ''}
    </div>
    <p class="rel-all"><a href="./${PAGE_COMPARATIF}">Sur quels trajets une heure de détour économise-t-elle le plus ?</a></p>
  </section>

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

function renderComparatif(reussis, dateMaj) {
  const mesures = reussis.map(t => ({ ...t, ...comparaisonPeages(t.r) }));
  const avecGain = mesures.filter(t => t.gain > 0 && t.detour !== null);
  const classement = avecGain.filter(t => t.detour > 0)
    .sort((a, b) => b.taux - a.taux || b.gain - a.gain || a.slug.localeCompare(b.slug));
  const sansDetour = avecGain.filter(t => t.detour <= 0).sort((a, b) => b.gain - a.gain);
  const top = classement.slice(0, 10);
  const lien = t => `<a href="./${t.slug}.html">${t.depart} → ${t.arrivee}</a>`;
  const meilleur = top[0];
  const parGain = [...avecGain].sort((a, b) => b.gain - a.gain || a.detour - b.detour);
  const court = parGain.find(t => t.detour <= 1800);
  const gainMax = parGain[0];
  const titre = 'Sur quels trajets éviter les péages rapporte-t-il le plus par heure de détour ?';
  const tableau = top.length ? `<table class="classement"><caption>Les ${top.length} meilleurs rapports entre économie et temps de détour</caption>
    <thead><tr><th scope="col">Trajet</th><th scope="col">Économie nette</th><th scope="col">Détour</th><th scope="col">Économie par heure</th></tr></thead>
    <tbody>${top.map((t, i) => `<tr><th scope="row">${i + 1}. ${lien(t)}</th><td>${fmtEur(t.gain)}</td><td>${fmtDuree(t.detour)}</td><td>${tauxHoraire(t.taux)}</td></tr>`).join('\n')}</tbody>
  </table>` : '<p>Aucun trajet de ce relevé ne combine une économie nette et du temps de route en plus.</p>';
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Éviter les péages : les meilleurs trajets par heure de détour | Futéroute</title>
<meta name="description" content="Quels trajets sans péages économisent le plus par heure de route supplémentaire ? Comparez les euros, les minutes et les coûts détaillés du relevé Futéroute.">
<link rel="canonical" href="${SITE_URL}/trajets/${PAGE_COMPARATIF}">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="stylesheet" href="/pages.css">
</head>
<body>
<main class="page">
${renderHeader(false)}
  <div class="breadcrumb"><a href="/">Futéroute</a> › <a href="./">Trajets</a> › Comparatif sans péages</div>
  <h1>${titre}</h1>
  <p class="maj">Relevé du ${dateMaj} · ${reussis.length} trajets étudiés · aller simple, hors trafic</p>
  <section class="card lecture">
    <h2>Où le détour rapporte le plus</h2>
${meilleur ? `<p>Sur ${lien(meilleur)}, vous économisez <strong>${fmtEur(meilleur.gain)}</strong> en roulant ${fmtDuree(meilleur.detour)} de plus. Cela représente <strong>${tauxHoraire(meilleur.taux)}</strong> de détour, le meilleur rapport parmi les ${classement.length} trajets classables de ce relevé.</p>` : ''}
    ${tableau}
${court ? `<p><strong>Si vous avez une demi-heure de marge.</strong> Dans la limite de 30 minutes supplémentaires, ${lien(court)} offre la plus grande économie, avec ${fmtEur(court.gain)} ${court.detour > 0 ? 'pour ' + fmtDuree(court.detour) + ' de plus' : 'sans temps de route supplémentaire'}.</p>` : ''}
${gainMax && gainMax !== court && gainMax.detour > 0 ? `<p><strong>Si le budget passe en premier.</strong> Sur ${lien(gainMax)}, éviter les péages économise ${fmtEur(gainMax.gain)}, le montant le plus élevé du relevé. Il faut prévoir ${fmtDuree(gainMax.detour)} de route en plus.</p>` : ''}
${sansDetour.length ? `<h3>Moins cher sans détour</h3><ul>${sansDetour.map(t => `<li>${lien(t)} économise ${fmtEur(t.gain)} ${t.detour < 0 ? 'et fait gagner ' + fmtDuree(-t.detour) : 'à durée égale'}.</li>`).join('')}</ul>` : ''}
    <a class="cta" href="/">Comparer les deux itinéraires avec ma voiture</a>
  </section>
  <section class="card lecture">
    <h2>Comment le classement est calculé</h2>
    <p>Pour chaque trajet, Futéroute soustrait le coût du parcours sans péages de celui du parcours rapide. Les deux totaux incluent le carburant consommé, avec la même hypothèse de 6,6 L/100 km de SP95-E10. Les péages sont ceux d’une voiture de classe 1.</p>
    <p>L’économie nette est divisée par les heures de route supplémentaires, avant l’arrondi des durées affichées. Le tableau présente jusqu’à dix trajets par ordre décroissant d’euros par heure. À taux égal, la plus grande économie passe en premier.</p>
    <p>Seuls les trajets recalculés avec deux coûts connus, une économie positive et un détour de durée positive entrent dans le classement horaire. Chaque fiche détaille les deux itinéraires et leurs sources.</p>
    <p>Les durées proviennent de ${SOURCE_ROUTE}. Le SP95-E10 reprend les ${SOURCE_CARBURANT}. Pour les péages, le calculateur interroge ${SOURCE_VINCI}, puis ${SOURCE_MICHELIN} si nécessaire.</p>
    <p><a href="./">Consulter toutes les fiches trajet</a></p>
  </section>
</main>
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
  <p class="card"><a href="./${PAGE_COMPARATIF}">Quels trajets sans péages économisent le plus par heure de détour ?</a></p>
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
          const r = await calculerTrajet(browser, t.depart, t.arriveeGps || t.arrivee);
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

  publierPages(reussis, publiables);
  console.log(`\n${reussis.length}/${TRAJETS.length} trajets recalculés ; ${publiables.length}/${TRAJETS.length} pages publiées. sitemap.xml mis à jour.`);
}

function publierPages(reussis, publiables, racine = ROOT, dateMaj = dateReleve()) {
  const outDir = path.join(racine, 'trajets');
  for (const t of reussis) {
    fs.writeFileSync(path.join(outDir, `${t.slug}.html`), renderPage(t, t.r, publiables, dateMaj));
  }
  fs.writeFileSync(path.join(outDir, 'index.html'), renderIndex(publiables));
  fs.writeFileSync(path.join(outDir, PAGE_COMPARATIF), renderComparatif(reussis, dateMaj));

  const urls = publiables.map(t => `${SITE_URL}/trajets/${t.slug}.html`);
  urls.push(`${SITE_URL}/trajets/`, `${SITE_URL}/trajets/${PAGE_COMPARATIF}`);

  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE_URL}/</loc><changefreq>weekly</changefreq></url>
${urls.map(u => `  <url><loc>${u}</loc><changefreq>weekly</changefreq></url>`).join('\n')}
</urlset>
`;
  fs.writeFileSync(path.join(racine, 'sitemap.xml'), sitemap);
}

if (require.main === module) main();
module.exports = { renderPage, renderComparatif, comparaisonPeages, publierPages };
