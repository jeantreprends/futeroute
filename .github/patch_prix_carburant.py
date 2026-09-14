from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

css_marker = "    /* Prix moyen actuel : une ligne, alignée avec le champ Carburant */\n"
css = '''    /* Prix personnalisé : option secondaire sous le prix moyen. */
    .prix-perso-wrap { margin-top: 12px; padding-top: 12px; border-top: 1px solid #d9e1e8; }
    .prix-perso-toggle {
      display: flex; align-items: center; gap: 9px; width: 100%;
      border: 0; background: none; padding: 0; cursor: pointer;
      font: inherit; color: #607080; text-align: left;
    }
    .prix-perso-toggle .prix-perso-title { font-size: 12.5px; font-weight: 600; }
    .prix-perso-checkbox {
      width: 18px; height: 18px; flex: 0 0 18px; border-radius: 5px;
      border: 1.5px solid #b8c5d3; background: #fff; position: relative;
      transition: border-color .15s, background .15s;
    }
    .prix-perso-toggle.on .prix-perso-checkbox { border-color: #e2971a; background: #e2971a; }
    .prix-perso-toggle.on .prix-perso-checkbox::after {
      content: ''; position: absolute; left: 5px; top: 2px; width: 5px; height: 9px;
      border: solid #fff; border-width: 0 2px 2px 0; transform: rotate(45deg);
    }
    .prix-perso-panel { display: none; margin-top: 10px; }
    .prix-perso-panel.open { display: block; }
    .prix-perso-line { width: 100%; }
    .prix-perso-roulette {
      position: relative; width: 100%; height: 54px; overflow: hidden;
      border-radius: 10px; background: rgba(255,255,255,.72);
      border: 1px solid #ead7ae; touch-action: none; user-select: none;
    }
    .prix-perso-track { position: absolute; height: 100%; left: 0; top: 0; will-change: transform; }
    .prix-perso-major { position: absolute; top: 11px; width: 1px; height: 15px; background: #c7b27f; }
    .prix-perso-major span {
      position: absolute; top: 20px; left: 0; transform: translateX(-50%);
      font-size: 9px; font-weight: 600; color: #8e7a4f; white-space: nowrap;
    }
    .prix-perso-center {
      position: absolute; left: 50%; top: 7px; bottom: 7px; width: 2px;
      transform: translateX(-1px); background: #e2971a; border-radius: 2px;
      pointer-events: none;
    }
    .prix-perso-value { display: flex; align-items: center; justify-content: center; gap: 4px; margin-top: 6px; }
    .prix-perso-val-input {
      width: 58px; border: 0; background: transparent; text-align: right;
      font: inherit; font-size: 14px; font-weight: 800; color: #1a2433; outline: none;
    }
    .prix-perso-unit { font-size: 12px; font-weight: 700; color: #607080; white-space: nowrap; }
    .prix-perso-arrow {
      display: none; align-items: center; justify-content: center;
      width: 32px; height: 32px; border-radius: 50%; border: 0;
      background: #eef2f6; color: #1976d2; font-size: 20px; font-weight: 700;
      cursor: pointer; line-height: 1;
    }
    @media (min-width: 481px) {
      .prix-perso-line { display: flex; align-items: center; justify-content: flex-start; gap: 8px; }
      .prix-perso-roulette { display: none; }
      .prix-perso-arrow { display: inline-flex; }
      .prix-perso-value { margin-top: 0; min-width: 92px; }
      .prix-perso-val-input { cursor: text; }
    }

'''
if css_marker not in s:
    raise SystemExit('CSS marker not found')
s = s.replace(css_marker, css + css_marker, 1)

html_old = '        <div class="prix-actuel">Prix moyen actuel : <span id="prixAffiche">Chargement…</span></div>'
html_new = '''        <div class="prix-actuel">Prix moyen actuel : <span id="prixAffiche">Chargement…</span></div>
        <div class="prix-perso-wrap">
          <button type="button" class="prix-perso-toggle" id="prixPersoToggle" role="checkbox" aria-checked="false" onclick="setPrixPersoActive(!prixPersoActive)">
            <span class="prix-perso-checkbox" aria-hidden="true"></span>
            <span class="prix-perso-title">Je connais le prix de mon carburant</span>
          </button>
          <div class="prix-perso-panel" id="prixPersoPanel">
            <input type="hidden" id="prixPerso" value="1.50">
            <div class="prix-perso-line">
              <div class="prix-perso-roulette" id="prixPersoRoulette" role="slider" aria-label="Prix du carburant" aria-valuemin="0.10" aria-valuemax="5.00" tabindex="0">
                <div class="prix-perso-track" id="prixPersoTrack"></div>
                <div class="prix-perso-center"></div>
              </div>
              <button type="button" class="prix-perso-arrow" id="prixPersoMinus" aria-label="Diminuer le prix du carburant">−</button>
              <div class="prix-perso-value"><input type="text" id="prixPersoVal" class="prix-perso-val-input" value="1,50" inputmode="decimal" readonly aria-label="Prix personnalisé du carburant"> <span class="prix-perso-unit" id="prixPersoUnit">€/L</span></div>
              <button type="button" class="prix-perso-arrow" id="prixPersoPlus" aria-label="Augmenter le prix du carburant">+</button>
            </div>
          </div>
        </div>'''
if s.count(html_old) != 1:
    raise SystemExit(f'Expected one price display, found {s.count(html_old)}')
s = s.replace(html_old, html_new, 1)

js_marker = 'let prixActuel = null;\n'
js = '''

// Prix carburant personnalisé : le prix moyen reste visible, mais le calcul
// peut utiliser la valeur connue par l'utilisateur. Pas de 0,01 €/L.
let prixPersoActive = false;
let prixPersoInitialise = false;
const PRIX_PERSO_MIN = 0.10, PRIX_PERSO_MAX = 5.00, PRIX_PERSO_PX_PAR_CENTIME = 4;
function prixPersoValeur() {
  const el = document.getElementById('prixPerso');
  const v = el ? parseFloat(el.value) : NaN;
  return isFinite(v) ? v : null;
}
function prixCarburantUtilise() {
  const perso = prixPersoValeur();
  return prixPersoActive && perso !== null ? perso : prixActuel;
}
function majUnitePrixPerso() {
  const unit = document.getElementById('prixPersoUnit');
  if (!unit) return;
  unit.textContent = document.getElementById('carburant').value === 'electrique' ? '€/kWh' : '€/L';
}
function prixPersoSet(v, doReset) {
  v = Math.min(PRIX_PERSO_MAX, Math.max(PRIX_PERSO_MIN, Math.round(v * 100) / 100));
  const hidden = document.getElementById('prixPerso');
  if (hidden) hidden.value = v.toFixed(2);
  const disp = document.getElementById('prixPersoVal');
  if (disp) disp.value = v.toFixed(2).replace('.', ',');
  const track = document.getElementById('prixPersoTrack');
  const box = document.getElementById('prixPersoRoulette');
  if (track && box && box.clientWidth) {
    const center = box.clientWidth / 2;
    const cents = Math.round((v - PRIX_PERSO_MIN) * 100);
    track.style.transform = `translateX(${center - cents * PRIX_PERSO_PX_PAR_CENTIME}px)`;
  }
  if (box) box.setAttribute('aria-valuenow', v.toFixed(2));
  if (doReset) resetResultat();
}
function setPrixPersoActive(on) {
  prixPersoActive = !!on;
  const toggle = document.getElementById('prixPersoToggle');
  const panel = document.getElementById('prixPersoPanel');
  if (toggle) {
    toggle.classList.toggle('on', prixPersoActive);
    toggle.setAttribute('aria-checked', prixPersoActive ? 'true' : 'false');
  }
  if (panel) panel.classList.toggle('open', prixPersoActive);
  if (prixPersoActive && !prixPersoInitialise) {
    prixPersoInitialise = true;
    prixPersoSet(isFinite(prixActuel) ? prixActuel : 1.50, false);
  }
  if (prixPersoActive) requestAnimationFrame(() => prixPersoSet(prixPersoValeur() || 1.50, false));
  resetResultat();
}
function prixPersoInit() {
  const track = document.getElementById('prixPersoTrack');
  const box = document.getElementById('prixPersoRoulette');
  if (!track || !box) return;
  let html = '';
  for (let cents = 10; cents <= 500; cents += 10) {
    const left = (cents - 10) * PRIX_PERSO_PX_PAR_CENTIME;
    html += `<div class="prix-perso-major" style="left:${left}px"><span>${(cents / 100).toFixed(1).replace('.', ',')}</span></div>`;
  }
  track.style.width = ((PRIX_PERSO_MAX - PRIX_PERSO_MIN) * 100 * PRIX_PERSO_PX_PAR_CENTIME + 1) + 'px';
  track.innerHTML = html;

  let dragging = false, startX = 0, startVal = 1.50;
  box.addEventListener('pointerdown', e => {
    dragging = true; startX = e.clientX; startVal = prixPersoValeur() || 1.50;
    box.setPointerCapture(e.pointerId); e.preventDefault();
  });
  box.addEventListener('pointermove', e => {
    if (!dragging) return;
    const delta = (e.clientX - startX) / (PRIX_PERSO_PX_PAR_CENTIME * 100);
    prixPersoSet(startVal - delta, true);
  });
  const end = () => { dragging = false; };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
  box.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft') { prixPersoSet((prixPersoValeur() || 1.50) - 0.01, true); e.preventDefault(); }
    if (e.key === 'ArrowRight') { prixPersoSet((prixPersoValeur() || 1.50) + 0.01, true); e.preventDefault(); }
  });
  window.addEventListener('resize', () => { if (prixPersoActive) prixPersoSet(prixPersoValeur() || 1.50, false); });

  const minus = document.getElementById('prixPersoMinus');
  const plus = document.getElementById('prixPersoPlus');
  holdRepeat(minus, () => prixPersoSet((prixPersoValeur() || 1.50) - 0.01, true));
  holdRepeat(plus, () => prixPersoSet((prixPersoValeur() || 1.50) + 0.01, true));

  const input = document.getElementById('prixPersoVal');
  const syncEditable = () => { if (input) input.readOnly = !window.matchMedia('(min-width: 481px)').matches; };
  syncEditable();
  window.addEventListener('resize', syncEditable);
  if (input) {
    input.addEventListener('focus', () => { if (!input.readOnly) input.select(); });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') input.blur(); });
    input.addEventListener('blur', () => {
      if (input.readOnly) return;
      const parsed = parseFloat(input.value.replace(',', '.'));
      prixPersoSet(isNaN(parsed) ? (prixPersoValeur() || 1.50) : parsed, true);
    });
  }
  majUnitePrixPerso();
  prixPersoSet(prixPersoValeur() || 1.50, false);
}
prixPersoInit();
'''
if js_marker not in s:
    raise SystemExit('prixActuel marker not found')
s = s.replace(js_marker, js_marker + js, 1)

setcarb_old = """  document.getElementById('carburant').value = value;
  document.querySelectorAll('#carbChoices .carb-choice').forEach(b => b.classList.toggle('active', b === btn));
  resetResultat(keepScope);
  chargerPrix();
"""
setcarb_new = """  document.getElementById('carburant').value = value;
  document.querySelectorAll('#carbChoices .carb-choice').forEach(b => b.classList.toggle('active', b === btn));
  resetResultat(keepScope);
  majUnitePrixPerso();
  chargerPrix();
"""
if s.count(setcarb_old) != 1:
    raise SystemExit(f'setCarburant block mismatch: {s.count(setcarb_old)}')
s = s.replace(setcarb_old, setcarb_new, 1)

guard_old = "if (!prixActuel) return showError('⚠️ Le prix du carburant n\\'a pas pu être chargé. Vérifiez votre connexion.');"
guard_new = "const prixPourCalcul = prixCarburantUtilise();\n  if (!prixPourCalcul) return showError('⚠️ Le prix du carburant n\\'a pas pu être chargé. Vérifiez votre connexion.');"
if s.count(guard_old) != 1:
    raise SystemExit(f'price guard mismatch: {s.count(guard_old)}')
s = s.replace(guard_old, guard_new, 1)

calc_old = 'coutA: litresA * prixActuel'
calc_new = 'coutA: litresA * prixPourCalcul'
if s.count(calc_old) != 1:
    raise SystemExit(f'route price calculation mismatch: {s.count(calc_old)}')
s = s.replace(calc_old, calc_new, 1)

p.write_text(s, encoding='utf-8')
