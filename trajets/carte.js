(() => {
  const onglets = document.querySelector('.onglets-vues');
  const liste = document.getElementById('vue-liste');
  const panneau = document.getElementById('vue-carte');
  const support = document.getElementById('carte-routiere');
  const etat = document.getElementById('etat-carte');
  const choix = document.getElementById('choix-trajet');
  const fiche = document.getElementById('fiche-carte');
  const reessayer = document.getElementById('reessayer-carte');
  const lignes = new Map();
  const boutons = [...onglets.querySelectorAll('[role="tab"]')];
  let carte, groupe, chargement, ressources;

  function chargerRessource(element) {
    return new Promise((resolve, reject) => {
      element.crossOrigin = 'anonymous';
      element.onload = resolve;
      element.onerror = () => { element.remove(); reject(new Error('Leaflet indisponible')); };
      document.head.appendChild(element);
    });
  }

  function chargerLeaflet() {
    if (!ressources) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      css.integrity = 'sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY=';
      const js = document.createElement('script');
      js.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
      js.integrity = 'sha256-20nQCchB9co0qIjJZRGuk2/Z9VM+kNiyxNV1lvTlZBo=';
      ressources = Promise.all([chargerRessource(css), chargerRessource(js)]).catch(err => {
        css.remove(); js.remove(); ressources = null; throw err;
      });
    }
    return ressources;
  }

  async function chargerTraces() {
    const reponse = await fetch('./traces-routiers.json');
    if (!reponse.ok) throw new Error('Tracés indisponibles');
    return reponse.json();
  }

  function cadrer() {
    const seul = lignes.get(choix.value);
    groupe.clearLayers();
    for (const entree of seul ? [seul] : lignes.values()) groupe.addLayer(entree.ligne);
    if (seul) fiche.href = seul.lien.href;
    fiche.hidden = !seul;
    carte.closePopup();
    carte.fitBounds(groupe.getBounds(), { padding: [16, 16], maxZoom: 14, animate: false });
  }

  function ouvrirTroncon(e) {
    const point = carte.latLngToLayerPoint(e.latlng);
    const rayon = e.originalEvent?.pointerType === 'touch' || window.matchMedia('(pointer: coarse)').matches ? 12 : 7;
    const liens = [];
    // Plusieurs fiches peuvent emprunter la même autoroute. On propose toutes
    // les lignes qui passent sous le pointeur, y compris celles recouvertes.
    for (const { ligne, lien } of lignes.values()) {
      if (!groupe.hasLayer(ligne)) continue;
      const proche = ligne.closestLayerPoint(point);
      if (proche && proche.distance <= rayon) liens.push({ distance: proche.distance, lien });
    }
    if (!liens.length) return;
    liens.sort((a, b) => a.distance - b.distance);
    const contenu = document.createElement('div');
    contenu.className = 'fiches-trace';
    for (const { lien } of liens) {
      const a = document.createElement('a');
      a.href = lien.href;
      a.textContent = lien.textContent;
      contenu.appendChild(a);
    }
    L.popup({ maxHeight: 190 }).setLatLng(e.latlng).setContent(contenu).openOn(carte);
  }

  async function initialiser() {
    let traces;
    try {
      [, traces] = await Promise.all([chargerLeaflet(), chargerTraces()]);
      const liens = liste.querySelectorAll('[data-trajet]');
      for (const lien of liens) {
        const slug = lien.dataset.trajet;
        if (!traces[slug]) continue;
        const points = decodePolyline(traces[slug], 5);
        if (points.length < 2) continue;
        const ligne = L.polyline(points, { color: '#1167a5', weight: 3.5, opacity: .85, smoothFactor: .6 });
        lignes.set(slug, { lien, ligne });
        choix.add(new Option(lien.textContent, slug));
      }
      if (!lignes.size) throw new Error('Aucun tracé');
      support.hidden = false;
      carte = L.map(support, { minZoom: 3, maxZoom: 19, zoomSnap: .25, scrollWheelZoom: true });
      carte.zoomControl.setPosition('topleft');
      const zoom = support.querySelector('.leaflet-control-zoom');
      for (const [i, a] of [...zoom.querySelectorAll('a')].entries()) {
        a.title = i === 0 ? 'Zoomer' : 'Dézoomer';
        a.setAttribute('aria-label', a.title);
      }
      const fond = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · Itinéraires <a href="https://openrouteservice.org/">OpenRouteService</a>',
      }).addTo(carte);
      let fondVisible = false;
      fond.on('tileload', () => {
        if (!fondVisible) { fondVisible = true; etat.textContent = ''; }
      });
      fond.on('load', () => {
        if (!fondVisible) etat.textContent = 'Le fond OpenStreetMap est indisponible. Les tracés routiers restent consultables.';
      });
      groupe = L.featureGroup().addTo(carte);
      carte.on('click', ouvrirTroncon);
      panneau.querySelector('.outils-carte').hidden = false;
      etat.textContent = '';
      if (!panneau.hidden) cadrer();
    } catch {
      if (carte) carte.remove();
      carte = null;
      lignes.clear();
      choix.length = 1;
      support.hidden = true;
      panneau.querySelector('.outils-carte').hidden = true;
      etat.textContent = 'La carte n’a pas pu se charger. Les fiches sont disponibles en vue liste.';
      reessayer.hidden = false;
    } finally {
      chargement = null;
    }
  }

  function ouvrirCarte() {
    if (carte) {
      carte.invalidateSize();
      if (!groupe.getLayers().length) cadrer();
    } else if (!chargement) {
      reessayer.hidden = true;
      etat.textContent = 'Chargement de la carte…';
      chargement = initialiser();
    }
  }

  function afficher(vueCarte) {
    liste.hidden = vueCarte;
    panneau.hidden = !vueCarte;
    for (const [i, bouton] of boutons.entries()) {
      const actif = (i === 1) === vueCarte;
      bouton.tabIndex = actif ? 0 : -1;
      bouton.setAttribute('aria-selected', String(actif));
    }
    if (vueCarte) ouvrirCarte();
  }

  function activer(vueCarte) {
    history.replaceState(null, '', vueCarte ? '#carte' : '#liste');
    afficher(vueCarte);
  }
  for (const [i, bouton] of boutons.entries()) {
    bouton.addEventListener('click', () => activer(i === 1));
    bouton.addEventListener('keydown', e => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
      e.preventDefault();
      const suivant = e.key === 'Home' ? 0 : e.key === 'End' ? 1 : 1 - i;
      boutons[suivant].focus();
      activer(suivant === 1);
    });
  }
  document.querySelector('#invitation-carte a').addEventListener('click', e => {
    e.preventDefault(); activer(true); boutons[1].focus();
  });
  choix.addEventListener('change', cadrer);
  document.getElementById('recentrer').addEventListener('click', () => { choix.value = ''; cadrer(); });
  reessayer.addEventListener('click', ouvrirCarte);
  window.addEventListener('hashchange', () => afficher(location.hash === '#carte'));
  onglets.hidden = false;
  document.getElementById('invitation-carte').hidden = false;
  afficher(location.hash === '#carte');
})();
