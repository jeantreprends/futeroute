const fs = require('node:fs');
const path = require('node:path');

function echapper(s) {
  return s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

// Une fiche conservée après un échec de calcul garde aussi son dernier tracé.
function publierTraces(reussis, publiables, outDir) {
  const fichier = path.join(outDir, 'traces-routiers.json');
  const anciens = fs.existsSync(fichier) ? JSON.parse(fs.readFileSync(fichier, 'utf8')) : {};
  const calculs = new Map(reussis.map(t => [t.slug, t.r.polyline]));
  const traces = {};
  for (const { slug } of publiables) {
    const polyline = calculs.has(slug) ? calculs.get(slug) : anciens[slug];
    if (typeof polyline === 'string' && polyline.length) traces[slug] = polyline;
  }
  fs.writeFileSync(fichier, JSON.stringify(traces, null, 2) + '\n');
}

function renderAnnuaire(trajets, baseFiches) {
  const fiches = trajets.map(t => {
    const slug = encodeURIComponent(t.slug);
    return `<li><a data-trajet="${slug}" href="${baseFiches}${slug}.html">${echapper(t.depart)} → ${echapper(t.arrivee)}</a></li>`;
  });
  return `<div class="onglets-vues" role="tablist" aria-label="Affichage des trajets" hidden>
    <button type="button" role="tab" id="onglet-liste" aria-controls="vue-liste" aria-selected="true">Vue liste</button>
    <button type="button" role="tab" id="onglet-carte" aria-controls="vue-carte" aria-selected="false" tabindex="-1">Vue carte</button>
  </div>
  <section class="card panneau-vue" id="vue-liste" role="tabpanel" aria-labelledby="onglet-liste">
    <p>Choisissez un trajet pour comparer son coût avec et sans péages.<span id="invitation-carte" hidden> Vous pouvez aussi <a href="#carte">le retrouver sur la carte</a>.</span></p>
    <ul class="annuaire">${fiches.join('\n')}</ul>
  </section>
  <section class="card panneau-vue" id="vue-carte" role="tabpanel" aria-labelledby="onglet-carte" hidden>
    <p>Zoomez ou déplacez la carte. Sélectionnez un tracé routier pour ouvrir une fiche.</p>
    <div class="outils-carte" hidden>
      <label for="choix-trajet">Trajet</label>
      <select id="choix-trajet"><option value="">Tous les trajets</option></select>
      <a id="fiche-carte" hidden>Voir la fiche</a>
      <button type="button" id="recentrer">Vue d’ensemble</button>
    </div>
    <p id="etat-carte" role="status"></p>
    <button type="button" id="reessayer-carte" hidden>Réessayer</button>
    <div id="carte-routiere" aria-label="Carte des itinéraires rapides" hidden></div>
  </section>`;
}

module.exports = { renderAnnuaire, publierTraces };
