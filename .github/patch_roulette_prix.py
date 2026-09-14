from pathlib import Path
import re

p = Path('index.html')
s = p.read_text(encoding='utf-8')

# 1) La roulette de prix ne doit pas avoir sa propre apparence : elle réutilise
# exactement le composant de consommation. On ne garde ici que l'habillage de
# la case à cocher et du panneau qui se déplie.
css_pattern = re.compile(
    r"    /\* Prix personnalisé : option secondaire sous le prix moyen\. \*/.*?(?=    /\* Prix moyen actuel : une ligne, alignée avec le champ Carburant \*/)",
    re.S,
)
css_repl = '''    /* Prix personnalisé : option secondaire sous le prix moyen.\n       La roulette elle-même réutilise exactement le composant consommation. */\n    .prix-perso-wrap { margin-top: 12px; padding-top: 12px; border-top: 1px solid #d9e1e8; }\n    .prix-perso-toggle {\n      display: flex; align-items: center; gap: 9px; width: 100%;\n      border: 0; background: none; padding: 0; cursor: pointer;\n      font: inherit; color: #607080; text-align: left;\n    }\n    .prix-perso-toggle .prix-perso-title { font-size: 12.5px; font-weight: 600; }\n    .prix-perso-checkbox {\n      width: 18px; height: 18px; flex: 0 0 18px; border-radius: 5px;\n      border: 1.5px solid #b8c5d3; background: #fff; position: relative;\n      transition: border-color .15s, background .15s;\n    }\n    .prix-perso-toggle.on .prix-perso-checkbox { border-color: #e2971a; background: #e2971a; }\n    .prix-perso-toggle.on .prix-perso-checkbox::after {\n      content: ''; position: absolute; left: 5px; top: 2px; width: 5px; height: 9px;\n      border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg);\n    }\n    .prix-perso-panel { display: none; margin-top: 10px; }\n    .prix-perso-panel.open { display: block; }\n\n'''
s, n = css_pattern.subn(css_repl, s, count=1)
if n != 1:
    raise SystemExit(f'Bloc CSS prix perso introuvable: {n}')

# Le champ texte du prix doit aussi reprendre au pixel près le style du champ
# valeur de la consommation sur desktop.
s = s.replace(
    '#consoVal.conso-val-input {',
    '#consoVal.conso-val-input,\n    #prixPersoVal.conso-val-input {',
    1,
)
s = s.replace(
    '#consoVal.conso-val-input:focus {',
    '#consoVal.conso-val-input:focus,\n    #prixPersoVal.conso-val-input:focus {',
    1,
)
s = s.replace(
    '#consoVal.conso-val-input[readonly] { cursor: default; }',
    '#consoVal.conso-val-input[readonly], #prixPersoVal.conso-val-input[readonly] { cursor: default; }',
    1,
)

# 2) Même DOM que la consommation : mêmes classes, mêmes graduations, même
# centre, mêmes boutons +/- ; seuls les IDs et l'unité changent.
html_pattern = re.compile(
    r'''            <div class="prix-perso-line">\n              <div class="prix-perso-roulette" id="prixPersoRoulette".*?\n            </div>''',
    re.S,
)
html_repl = '''            <div class="conso-line">\n              <div class="conso-roulette" id="prixPersoRoulette" role="slider" aria-label="Prix du carburant" aria-valuemin="0.10" aria-valuemax="5.00" tabindex="0">\n                <div class="roulette-viewport"><div class="roulette-track" id="prixPersoTrack"></div></div>\n                <div class="roulette-center"></div>\n              </div>\n              <button type="button" class="conso-arrow" id="prixPersoMinus" aria-label="Diminuer le prix du carburant">−</button>\n              <div class="conso-value"><input type="text" id="prixPersoVal" class="conso-val-input" value="1,50" inputmode="decimal" readonly aria-label="Prix personnalisé du carburant"> <span class="roulette-unit" id="prixPersoUnit">€/L</span></div>\n              <button type="button" class="conso-arrow" id="prixPersoPlus" aria-label="Augmenter le prix du carburant">+</button>\n            </div>'''
s, n = html_pattern.subn(html_repl, s, count=1)
if n != 1:
    raise SystemExit(f'Bloc HTML roulette prix introuvable: {n}')

# 3) Un centime = 6 px : donc une graduation majeure tous les 0,10 € tombe
# exactement tous les 60 px, comme les entiers de la roulette consommation.
s = s.replace(
    'const PRIX_PERSO_MIN = 0.10, PRIX_PERSO_MAX = 5.00, PRIX_PERSO_PX_PAR_CENTIME = 4;',
    'const PRIX_PERSO_MIN = 0.10, PRIX_PERSO_MAX = 5.00, PRIX_PERSO_PX_PAR_CENTIME = 6;',
    1,
)

# 4) Même gestuelle que la consommation : glissement + inertie, clavier,
# boutons maintenus sur desktop, saisie directe sur desktop. Seul le pas est
# différent : 0,01 €.
js_pattern = re.compile(r'function prixPersoInit\(\) \{.*?\n\}\nprixPersoInit\(\);', re.S)
js_repl = r'''function prixPersoInit() {
  const track = document.getElementById('prixPersoTrack');
  const box = document.getElementById('prixPersoRoulette');
  if (!track || !box) return;

  // Même densité visuelle que la conso : 60 px entre deux valeurs légendées.
  // Ici une valeur légendée tous les 0,10 €, avec un cran fin chaque centime.
  let html = '';
  for (let cents = 10; cents <= 500; cents += 10) {
    html += `<div class="rt-major" style="left:${(cents - 10) * PRIX_PERSO_PX_PAR_CENTIME}px"><span>${(cents / 100).toFixed(1).replace('.', ',')}</span></div>`;
  }
  track.innerHTML = html;

  let dragging = false, startX = 0, startVal = 1.50;
  let lastX = 0, lastT = 0, velocity = 0, momentumFrame = null;
  function stopMomentum() {
    if (momentumFrame) { cancelAnimationFrame(momentumFrame); momentumFrame = null; }
  }
  box.addEventListener('pointerdown', e => {
    stopMomentum();
    dragging = true; startX = e.clientX; startVal = prixPersoValeur() || 1.50;
    lastX = e.clientX; lastT = performance.now(); velocity = 0;
    track.style.transition = 'none';
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  box.addEventListener('pointermove', e => {
    if (!dragging) return;
    const now = performance.now();
    const dt = now - lastT;
    if (dt >= 8) {
      const instVel = -(e.clientX - lastX) / (PRIX_PERSO_PX_PAR_CENTIME * 100) / dt;
      const MAX_VEL = 0.004;
      velocity = velocity * 0.7 + Math.max(-MAX_VEL, Math.min(MAX_VEL, instVel)) * 0.3;
      lastX = e.clientX; lastT = now;
    }
    prixPersoSet(startVal - (e.clientX - startX) / (PRIX_PERSO_PX_PAR_CENTIME * 100), true);
  });
  function startMomentum() {
    if (Math.abs(velocity) < 0.0008) { track.style.transition = 'transform 0.15s ease-out'; return; }
    let v = velocity;
    let lastTime = performance.now();
    const step = (now) => {
      const dt = now - lastTime;
      lastTime = now;
      v *= Math.pow(0.08, dt / 1000);
      prixPersoSet((prixPersoValeur() || 1.50) + v * dt, true);
      const val = prixPersoValeur() || 1.50;
      const atBound = val <= PRIX_PERSO_MIN || val >= PRIX_PERSO_MAX;
      if (Math.abs(v) > 0.00008 && !atBound) {
        momentumFrame = requestAnimationFrame(step);
      } else {
        momentumFrame = null;
        track.style.transition = 'transform 0.15s ease-out';
      }
    };
    momentumFrame = requestAnimationFrame(step);
  }
  const end = () => {
    if (!dragging) return;
    dragging = false;
    startMomentum();
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft')  { prixPersoSet((prixPersoValeur() || 1.50) - 0.01, true); e.preventDefault(); }
    if (e.key === 'ArrowRight') { prixPersoSet((prixPersoValeur() || 1.50) + 0.01, true); e.preventDefault(); }
  });
  window.addEventListener('resize', () => { if (prixPersoActive) prixPersoSet(prixPersoValeur() || 1.50, false); });
  prixPersoSet(prixPersoValeur() || 1.50, false);

  const minusBtn = document.getElementById('prixPersoMinus');
  const plusBtn = document.getElementById('prixPersoPlus');
  holdRepeat(minusBtn, () => prixPersoSet((prixPersoValeur() || 1.50) - 0.01, true));
  holdRepeat(plusBtn, () => prixPersoSet((prixPersoValeur() || 1.50) + 0.01, true));

  const valInput = document.getElementById('prixPersoVal');
  const isDesktop = () => window.matchMedia('(min-width: 481px)').matches;
  const syncEditable = () => { if (valInput) valInput.readOnly = !isDesktop(); };
  syncEditable();
  window.addEventListener('resize', syncEditable);
  if (valInput) {
    valInput.addEventListener('focus', () => { if (!valInput.readOnly) valInput.select(); });
    valInput.addEventListener('keydown', e => { if (e.key === 'Enter') valInput.blur(); });
    valInput.addEventListener('blur', () => {
      if (valInput.readOnly) return;
      const parsed = parseFloat(valInput.value.replace(',', '.'));
      prixPersoSet(isNaN(parsed) ? (prixPersoValeur() || 1.50) : parsed, true);
    });
  }
  majUnitePrixPerso();
}
prixPersoInit();'''
s, n = js_pattern.subn(js_repl, s, count=1)
if n != 1:
    raise SystemExit(f'Bloc JS roulette prix introuvable: {n}')

# 5) Le prix personnalisé doit aussi être utilisé pour le verdict économique
# "éviter les péages", pas seulement dans le total carburant affiché.
s = s.replace(
    '* (prixActuel || 0);',
    '* (prixCarburantUtilise() || 0);',
)

p.write_text(s, encoding='utf-8')
