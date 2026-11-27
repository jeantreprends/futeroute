// Centres des communes françaises : https://geo.api.gouv.fr/decoupage-administratif/communes
// Les points d’arrivée GPS du catalogue (notamment Genève) priment sur le centre communal.
const centres = require('./villes-carte.json');

const etiquettes = {
  Brest: [-7, -7], Rennes: [-7, -7], Nantes: [-8, -6], Lille: [7, -6],
  Paris: [8, -8], Strasbourg: [-6, -8], Lyon: [-7, -8], Genève: [7, -5],
  Bordeaux: [-7, -6], Toulouse: [-5, 17], Montpellier: [-4, -9],
  Marseille: [-5, 17], Nice: [8, -4],
};

function echapper(s) {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function pointCarte(ville, gps) {
  const coords = gps ? gps.split(',').map(Number).reverse() : centres[ville];
  if (!coords || coords.length !== 2 || !coords.every(Number.isFinite)) return null;
  // Même projection et même emprise que fond-france.svg.
  const x = +((coords[0] + 6.5) * 38).toFixed(1);
  const y = +((51.7 - coords[1]) * 55).toFixed(1);
  return x >= 0 && x <= 640 && y >= 0 && y <= 580 ? { x, y } : null;
}

function renderCarte(trajets, baseFiches) {
  const villes = [...new Set(trajets.flatMap(t => [t.depart, t.arrivee]))].sort((a, b) => a.localeCompare(b, 'fr'));
  const points = new Map(villes.map(v => [v, pointCarte(v)]));
  for (const t of trajets) {
    if (t.arriveeGps) points.set(t.arrivee, pointCarte(t.arrivee, t.arriveeGps));
  }

  const traces = [];
  const reperes = new Set();
  const fiches = [];
  for (const t of trajets) {
    const nom = echapper(`${t.depart} → ${t.arrivee}`);
    const href = `${baseFiches}${encodeURIComponent(t.slug)}.html`;
    const attributs = `data-depart="${echapper(t.depart)}" data-arrivee="${echapper(t.arrivee)}"`;
    fiches.push(`<li ${attributs}><a href="${href}">${nom}</a></li>`);
    const a = points.get(t.depart), b = points.get(t.arrivee);
    if (!a || !b) continue;
    const d = `M${a.x} ${a.y} L${b.x} ${b.y}`;
    traces.push({
      longueur: Math.hypot(b.x - a.x, b.y - a.y),
      html: `<a href="${href}" ${attributs} aria-label="${nom}"><title>${nom}</title><path class="zone-trait" d="${d}"/><path class="trait" d="${d}"/></a>`,
    });
    reperes.add(t.depart);
    reperes.add(t.arrivee);
  }
  // Les petites liaisons restent accessibles au-dessus des longues aux abords des villes.
  traces.sort((a, b) => b.longueur - a.longueur);
  const marqueurs = [...reperes].map(v => {
    const { x, y } = points.get(v);
    const offset = etiquettes[v];
    const label = offset ? `<text x="${offset[0]}" y="${offset[1]}" text-anchor="${offset[0] < 0 ? 'end' : 'start'}">${echapper(v)}</text>` : '';
    return `<g data-ville="${echapper(v)}" transform="translate(${x} ${y})"><circle r="${offset ? 3.4 : 2.2}"/>${label}</g>`;
  }).join('\n');
  return `<section class="explorateur card" aria-labelledby="titre-carte">
    <div class="barre-carte">
      <h2 id="titre-carte">Carte des trajets</h2>
      <label id="filtre-ville" hidden>Départ ou arrivée
        <select id="ville-carte"><option value="">Toutes les villes</option>${villes.map(v => `<option>${echapper(v)}</option>`).join('')}</select>
      </label>
    </div>
    <div class="annuaire-carte">
      <figure class="atlas">
        <a class="saut-liste" href="#liste-trajets">Aller à la liste des trajets</a>
        <svg class="carte-france" viewBox="0 0 640 580" role="group" aria-label="Liaisons entre les villes en France métropolitaine et à Genève">
          <image href="./fond-france.svg" width="640" height="580" aria-hidden="true"/>
          <g class="liaisons">${traces.map(t => t.html).join('\n')}</g>
          <path id="trait-actif" aria-hidden="true"/>
          <g class="villes-carte" aria-hidden="true">${marqueurs}</g>
        </svg>
        <figcaption><span id="legende-carte">Choisissez un trait pour ouvrir sa fiche.</span>
          <small>Liaisons à vol d’oiseau · Fond <a href="https://www.naturalearthdata.com/">Natural Earth</a></small>
        </figcaption>
      </figure>
      <div class="fiches-carte">
        <h3 id="liste-trajets" tabindex="-1" aria-live="polite">${trajets.length} ${trajets.length === 1 ? 'trajet' : 'trajets'}</h3>
        <ul class="liste-carte">${fiches.join('\n')}</ul>
      </div>
    </div>
  </section>`;
}

module.exports = { renderCarte };
