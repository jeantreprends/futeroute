const assert = require('node:assert/strict');
const test = require('node:test');
const { renderPage, renderComparatif, comparaisonPeages } = require('../scripts/generate-trajets');

const trajet = { depart: 'Lyon', arrivee: 'Annecy', slug: 'lyon-annecy' };
const rapide = { distanceKm: 150, dureeSec: 5400, coutCarburant: 20 };
const zero = { distanceKm: 160, coutCarburant: 23, dureeSec: 7200 };

function fiche(coutPeage, alternative) {
  const html = renderPage(trajet, { ...rapide, coutPeage, zero: alternative }, []);
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  for (const question of schema.mainEntity) {
    assert.ok(html.includes(`<summary>${question.name}</summary><p>${question.acceptedAnswer.text}</p>`));
  }
  return html;
}

test('un péage inconnu conserve les deux mesures disponibles et laisse le total rapide inconnu', () => {
  for (const valeur of [null, undefined, NaN, -1]) {
    const html = fiche(valeur, zero);
    assert.match(html, /Péages<\/th><td>Tarif inconnu<\/td><td>0,00 €/);
    assert.match(html, /Total<\/th><td>Indisponible<\/td><td>23,00 €/);
    assert.match(html, /name="description" content="[^"]*20,00 € de carburant[^"]*tarif inconnu/);
    assert.match(html, /property="og:title" content="[^"]*20,00 € de carburant \(hors péages\)/);
    assert.match(html, /<p>Comptez environ 20,00 € de carburant [^<]*tarif des péages est inconnu/);
    assert.match(html, /Temps de route en plus<\/dt><dd>30 min/);
    assert.doesNotMatch(html, /fait économiser|NaN|Infinity/);
  }
});

test('le rapide gratuit est lui-même une option sans péages', () => {
  const html = fiche(0, null);
  assert.match(html, /Total<\/th><td>20,00 €<\/td><td>20,00 €/);
  assert.match(html, /déjà sans péage/);
  assert.match(html, /Économie par heure de détour<\/dt><dd>Aucun détour/);
  assert.doesNotMatch(html, /inconnu|hors péages/);
});

test('le tarif payant entre au total, avec ou sans alternative', () => {
  const html = fiche(8, zero);
  assert.match(html, /Total<\/th><td>28,00 €<\/td><td>23,00 €/);
  assert.match(html, /Éviter les péages fait économiser 5,00 €/);
  assert.match(html, /Économie par heure de détour<\/dt><dd>10,00 €\/h/);
  const sansAlternative = fiche(8, null);
  assert.match(sansAlternative, /Total<\/th><td>28,00 €<\/td><td>Indisponible/);
  assert.match(sansAlternative, /sans péage n’est pas disponible pour cette comparaison/);
  assert.doesNotMatch(sansAlternative, /tarif des péages est inconnu/);
});

test('petite économie, surcoût, égalité de coût et détour nul ou négatif', () => {
  for (const [carburant, sec, gain, taux] of [
    [27.75, 7200, 0.25, 0.5], [30, 7200, -2, -4], [28, 7200, 0, 0],
    [22, 5400, 6, null], [22, 5340, 6, null],
  ]) {
    const c = comparaisonPeages({ ...rapide, coutPeage: 8, zero: { coutCarburant: carburant, dureeSec: sec } });
    assert.equal(c.gain, gain);
    assert.equal(c.taux, taux);
    assert.equal(c.detour, sec - rapide.dureeSec);
  }
});

test('le classement trie sur le taux, départage les ex æquo et isole les gains sans détour', () => {
  const item = (slug, coutPeage, detour, gain) => ({
    ...trajet, slug, r: { ...rapide, coutPeage, zero: { ...zero, coutCarburant: 20 + coutPeage - gain, dureeSec: 5400 + detour } },
  });
  const html = renderComparatif([
    item('meilleur-taux', 20, 600, 8), item('gros-gain', 30, 3600, 24),
    item('petit-gain', 10, 900, 6), item('sans-detour', 10, 0, 3),
    item('surcout', 10, 600, -1), item('inconnu', null, 600, 5),
  ], '27 novembre 2026');
  const lignes = html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1];
  assert.deepEqual([...lignes.matchAll(/href="\.\/(.*?)\.html"/g)].map(m => m[1]), ['meilleur-taux', 'gros-gain', 'petit-gain']);
  assert.match(html, /Moins cher sans détour[\s\S]*href="\.\/sans-detour.html"/);
  assert.doesNotMatch(html, /surcout\.html|inconnu\.html|Infinity|NaN/);
  assert.match(renderComparatif([], '27 novembre 2026'), /Aucun trajet de ce relevé/);
});

test('la publication relie le comparatif aux fiches recalculées et garde les anciennes fiches dans l’annuaire', t => {
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { publierPages } = require('../scripts/generate-trajets');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'futeroute-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'trajets'));
  const ancien = { depart: 'Nice', arrivee: 'Cannes', slug: 'nice-cannes' };
  const page = nom => path.join(dir, 'trajets', nom + '.html');
  fs.writeFileSync(page(ancien.slug), 'Fiche du relevé précédent');
  publierPages([{ ...trajet, r: { ...rapide, coutPeage: 8, zero } }], [trajet, ancien], dir, '27 novembre 2026');
  assert.equal(fs.readFileSync(page(ancien.slug), 'utf8'), 'Fiche du relevé précédent');
  const lire = slug => fs.readFileSync(page(slug), 'utf8');
  assert.match(lire('index'), /nice-cannes\.html/);
  assert.match(lire('index'), /comparatif-sans-peages\.html/);
  assert.match(lire(trajet.slug), /href=".\/comparatif-sans-peages\.html"/);
  const classement = lire('comparatif-sans-peages');
  assert.match(classement, /href=".\/lyon-annecy\.html"/);
  assert.doesNotMatch(classement, /nice-cannes\.html/);
  assert.match(fs.readFileSync(path.join(dir, 'sitemap.xml'), 'utf8'), /https:\/\/futeroute\.fr\/trajets\/comparatif-sans-peages\.html/);
});

test('le recalcul de Lyon–Genève reprend le point suisse utilisé par la fiche', () => {
  const geneve = require('../trajets/trajets.json').find(t => t.slug === 'lyon-geneve');
  const html = renderPage(geneve, { ...rapide, coutPeage: 8, zero, peageSource: 'vinci' }, []);
  const cta = html.match(/class="cta" href="([^"]+)"/)[1];
  const lien = new URL(cta.replaceAll('&amp;', '&'), 'https://futeroute.fr');
  assert.equal(lien.searchParams.get('to'), geneve.arriveeGps);
  assert.match(html, /vignette suisse/);
});
