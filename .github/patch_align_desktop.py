from pathlib import Path

p = Path('index.html')
s = p.read_text(encoding='utf-8')

old = """    .prix-perso-wrap { margin-top: 12px; padding-top: 12px; border-top: 1px solid #d9e1e8; }
    .prix-perso-panel { display: none; margin-top: 10px; }
"""
new = """    .prix-perso-wrap { margin-top: 12px; padding-top: 12px; border-top: 1px solid #d9e1e8; }
    /* Desktop : aligne « Je connais le prix… » sur « Optimiser mes pleins ».
       Le bloc est imbriqué dans .param-input : on compense les 94 px du
       libellé + les 10 px de gap de .param-row. Mobile inchangé. */
    @media (min-width: 481px) {
      .carburant-row .prix-perso-wrap {
        margin-left: -104px;
        width: calc(100% + 104px);
      }
    }
    .prix-perso-panel { display: none; margin-top: 10px; }
"""

if old not in s:
    raise SystemExit('Bloc .prix-perso-wrap attendu introuvable')

p.write_text(s.replace(old, new, 1), encoding='utf-8')
