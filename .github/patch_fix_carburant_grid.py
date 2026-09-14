from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

old = """    /* Desktop : le titre Carburant devient un vrai titre au-dessus des choix,
       et les boutons carburant sont centrés dans le bloc. L'option de prix
       personnalisé reste alignée avec « Optimiser mes pleins ». */
    @media (min-width: 481px) {
      .carburant-row {
        display: block;
      }
      .carburant-row .param-label {
        width: min(820px, 100%);
        margin: 0 auto 10px;
      }
      .carburant-row .param-input {
        width: 100%;
      }
      .carburant-row .carb-choices,
      .carburant-row .prix-actuel {
        width: min(820px, 100%);
        margin-left: auto;
        margin-right: auto;
      }
      .carburant-row .prix-perso-wrap {
        margin-left: 0;
        width: 100%;
      }
    }
"""

new = """    /* Desktop : Carburant devient un vrai titre au-dessus des choix sans
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
"""

if old not in s:
    raise SystemExit('Bloc desktop carburant attendu introuvable')

p.write_text(s.replace(old, new, 1), encoding='utf-8')
