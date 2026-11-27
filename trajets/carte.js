(() => {
  const carte = document.querySelector('.explorateur');
  const select = document.getElementById('ville-carte');
  const liens = Array.from(carte.querySelectorAll('.liaisons a'));
  const fiches = Array.from(carte.querySelectorAll('.liste-carte li'));
  const points = Array.from(carte.querySelectorAll('[data-ville]'));
  const parUrl = new Map(liens.map(a => [a.getAttribute('href'), a]));
  const surbrillance = document.getElementById('trait-actif');
  const legende = document.getElementById('legende-carte');
  const instruction = legende.textContent;
  let survole = null;
  let focus = null;
  let sansTrace = false;

  function montrerTrajet() {
    const ligne = parUrl.get((survole || focus)?.getAttribute('href'));
    surbrillance.setAttribute('d', ligne?.querySelector('.trait').getAttribute('d') || '');
    legende.textContent = ligne?.getAttribute('aria-label') ||
      (sansTrace ? 'Consultez la fiche dans la liste des trajets.' : instruction);
  }

  function filtrer() {
    const ville = select.value;
    const visibles = new Set();
    const correspond = el => !ville || el.dataset.depart === ville || el.dataset.arrivee === ville;
    for (const a of liens) {
      const visible = correspond(a);
      a.toggleAttribute('hidden', !visible);
      if (visible) {
        visibles.add(a.dataset.depart);
        visibles.add(a.dataset.arrivee);
      }
    }
    for (const p of points) p.toggleAttribute('hidden', !visibles.has(p.dataset.ville));
    let nombre = 0;
    for (const fiche of fiches) {
      fiche.hidden = !correspond(fiche);
      if (!fiche.hidden) nombre++;
    }
    document.getElementById('liste-trajets').textContent = nombre + (nombre === 1 ? ' trajet' : ' trajets');
    carte.querySelector('.liste-carte').scrollTop = 0;
    sansTrace = !visibles.size;
    survole = focus = null;
    montrerTrajet();
  }

  function lienTrajet(noeud) {
    return noeud?.closest?.('.liaisons a, .liste-carte a') || null;
  }
  carte.addEventListener('pointerover', e => {
    survole = lienTrajet(e.target);
    montrerTrajet();
  });
  carte.addEventListener('pointerleave', () => {
    survole = null;
    montrerTrajet();
  });
  carte.addEventListener('focusin', e => {
    survole = null;
    focus = lienTrajet(e.target);
    montrerTrajet();
  });
  carte.addEventListener('focusout', e => {
    focus = lienTrajet(e.relatedTarget);
    montrerTrajet();
  });
  select.addEventListener('change', filtrer);
  window.addEventListener('pageshow', filtrer);
  document.getElementById('filtre-ville').hidden = false;
  filtrer();
})();
