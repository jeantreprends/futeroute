const assert = require('node:assert/strict');
const test = require('node:test');
const { renderPage } = require('../scripts/generate-trajets');

const trajet = { depart: 'Lyon', arrivee: 'Annecy', slug: 'lyon-annecy' };
const rapide = { distanceKm: 150, dureeSec: 5400, coutCarburant: 20 };
const zero = { coutCarburant: 23, dureeSec: 7200 };

function fiche(coutPeage, alternative) {
  const html = renderPage(trajet, { ...rapide, coutPeage, zero: alternative }, []);
  const schema = JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/)[1]);
  for (const question of schema.mainEntity) {
    assert.ok(html.includes(`<summary>${question.name}</summary><p>${question.acceptedAnswer.text}</p>`));
  }
  return html;
}

test('un péage inconnu ne produit ni total ni économie, même avec un trajet alternatif', () => {
  for (const valeur of [null, undefined, NaN]) {
    const html = fiche(valeur, zero);
    assert.match(html, /class="total">20,00 € de carburant \(hors péages\)/);
    assert.match(html, /class="chip-value">Tarif inconnu</);
    assert.match(html, /name="description" content="[^"]*20,00 € de carburant[^"]*tarif inconnu/);
    assert.match(html, /property="og:title" content="[^"]*20,00 € de carburant \(hors péages\)/);
    assert.match(html, /<p>Comptez environ 20,00 € de carburant [^<]*tarif des péages est inconnu/);
    assert.doesNotMatch(html, /au total|carburant \+ péages|class="verdict|fait économiser/);
  }
});

test('un péage à zéro donne un total complet et une FAQ cohérente', () => {
  const html = fiche(0, null);
  assert.match(html, /class="total">20,00 € au total/);
  assert.match(html, /class="chip-value">0,00 €</);
  assert.match(html, /déjà sans péage/);
  assert.doesNotMatch(html, /inconnu|hors péages/);
});

test('un péage payant entre dans le total, avec ou sans alternative', () => {
  const html = fiche(8, zero);
  assert.match(html, /class="total">28,00 € au total/);
  assert.match(html, /Éviter les péages fait économiser 5,00 €/);
  const sansAlternative = fiche(8, null);
  assert.match(sansAlternative, /class="total">28,00 € au total/);
  assert.match(sansAlternative, /sans péage n’est pas disponible pour cette comparaison/);
  assert.doesNotMatch(sansAlternative, /tarif des péages est inconnu|class="verdict/);
});
