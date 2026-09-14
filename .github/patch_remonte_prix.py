from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

old = """    .carburant-row { padding: 15px 0 33px; }
    .carburant-row .param-input { position: relative; }
    .carburant-row .prix-actuel {
      position: absolute;
      top: calc(100% + 5px);
      left: 2px;
      margin: 0;
    }
"""
new = """    .carburant-row { padding: 15px 0; }
    .carburant-row .param-input { position: relative; }
    /* Le prix moyen reste dans le flux, juste sous les boutons carburant.
       L'ancien positionnement absolu le repoussait sous la nouvelle case
       « Je connais le prix de mon carburant ». */
    .carburant-row .prix-actuel {
      position: static;
      margin-top: 8px;
      padding-left: 2px;
    }
"""

if old not in s:
    raise SystemExit('Bloc CSS carburant attendu introuvable')

p.write_text(s.replace(old, new, 1), encoding='utf-8')
