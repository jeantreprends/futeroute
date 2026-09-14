from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

old = '''    /* Desktop : Carburant devient un vrai titre au-dessus des choix sans
       casser la largeur de la carte. Le contenu principal reste centré et
       l'option de prix personnalisé garde le même bord gauche que
       « Optimiser mes pleins ». */
    @media (min-width: 481px) {
      .carburant-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 10px;
        align-items: stretch;
      }
      .carburant-row .param-label,
      .carburant-row .carb-choices,
      .carburant-row .prix-actuel {
        width: min(420px, 100%);
        max-width: 100%;
        margin-left: auto;
        margin-right: auto;
      }
      .carburant-row .param-label {
        margin-bottom: 0;
      }
      .carburant-row .param-input {
        width: auto;
        min-width: 0;
      }
      .carburant-row .prix-perso-wrap {
        margin-left: 0;
        width: 100%;
        max-width: 100%;
      }
    }
'''

new = '''    /* Desktop : dans le calcul de trajet, le réglage carburant ouvert doit
       être un vrai bloc vertical. La règle générique .carburant-row.ouvert
       repasse sinon la ligne en flex et remet le titre à gauche des boutons. */
    @media (min-width: 481px) {
      #modeCout .carburant-row.ouvert {
        display: block;
      }
      #modeCout .carburant-row .param-label {
        width: 100%;
        margin: 0 0 12px;
      }
      #modeCout .carburant-row .param-input {
        width: 100%;
        min-width: 0;
      }
      #modeCout .carburant-row .carb-choices {
        width: min(420px, 100%);
        max-width: 100%;
        margin-left: auto;
        margin-right: auto;
      }
      #modeCout .carburant-row .prix-actuel {
        width: min(420px, 100%);
        max-width: 100%;
        margin: 8px auto 0;
      }
      #modeCout .carburant-row .prix-perso-wrap {
        margin-left: 0;
        width: 100%;
        max-width: 100%;
      }
    }
'''

if old not in s:
    raise SystemExit('Bloc desktop carburant attendu introuvable')

p.write_text(s.replace(old, new, 1), encoding='utf-8')
