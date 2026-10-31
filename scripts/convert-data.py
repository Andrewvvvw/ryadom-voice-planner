"""Reproducible conversion of the supplied BOM CSV, preserving all original values."""
import csv
import json
from pathlib import Path
root = Path(__file__).resolve().parent.parent
rows = list(csv.DictReader((root / 'data/events.csv').open(encoding='utf-8-sig')))
assert len(rows) == 1000 and len({r['id'] for r in rows}) == 1000
(root / 'data/events.json').write_text(json.dumps(rows, ensure_ascii=False, indent=2) + '\n')
print(f'Converted {len(rows)} rows')
