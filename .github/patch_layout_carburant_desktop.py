from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

old = """    /* Desktop : aligne « Je connais le prix… » sur « Optimiser mes pleins ».
       Le bloc est imbriqué dans .param-input : on compense les 94 px du
       libellé + les 10 px de gap de .param-row. Mobile inchangé. */
    @media (min-width: 481px) {
      .carburant-row .prix-perso-wrap {
        margin-left: -104px;
        width: calc(100% + 104px);
      }
    }
"""

new = """    /* Desktop : le titre Carburant devient un vrai titre au-dessus des choix,
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

if old not in s:
    raise SystemExit('Bloc desktop attendu introuvable')

p.write_text(s.replace(old, new, 1), encoding='utf-8')
