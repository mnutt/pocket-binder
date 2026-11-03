"""Extract inventory sheets losslessly using only Python's standard library."""
import csv
import json
import re
import sys
import zipfile
from pathlib import Path
import xml.etree.ElementTree as ET

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def extract(workbook, output):
    output.mkdir(parents=True, exist_ok=True)
    results = []
    correction_path = workbook.with_name('inventory-corrections.json')
    corrections = json.loads(correction_path.read_text()) if correction_path.exists() else []
    with zipfile.ZipFile(workbook) as archive:
        strings = [''.join(t.text or '' for t in node.findall('.//s:t', NS)) for node in ET.fromstring(archive.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in archive.namelist() else []
        relationships = {r.get('Id'): r.get('Target') for r in ET.fromstring(archive.read('xl/_rels/workbook.xml.rels'))}
        sheets = ET.fromstring(archive.read('xl/workbook.xml')).findall('s:sheets/s:sheet', NS)
        for sheet in sheets:
            if sheet.get('name') not in ('Pokemon', 'Trainers', 'Energy'):
                continue
            target = relationships[sheet.get(REL)]
            target = target.lstrip('/') if target.startswith('/') else 'xl/' + target
            rows = []
            for row in ET.fromstring(archive.read(target)).findall('s:sheetData/s:row', NS):
                values = {}
                for cell in row.findall('s:c', NS):
                    letters = re.match('[A-Z]+', cell.get('r')).group()
                    index = 0
                    for letter in letters:
                        index = index * 26 + ord(letter) - 64
                    value = cell.find('s:v', NS)
                    text = value.text or '' if value is not None else ''.join(t.text or '' for t in cell.findall('.//s:t', NS))
                    if cell.get('t') == 's':
                        text = strings[int(text)]
                    values[index - 1] = text
                if values and any(values.values()):
                    rows.append([values.get(i, '') for i in range(max(values) + 1)])
            width = len(rows[0])
            rows = [r + [''] * (width - len(r)) for r in rows]
            for correction in corrections:
                if correction['sheet'] != sheet.get('name'):
                    continue
                matches = [row for row in rows[1:] if all(row[rows[0].index(key)] == value for key, value in correction['match'].items())]
                if len(matches) != 1:
                    raise ValueError(f'Correction must match exactly one row: {correction}')
                for key, value in correction['values'].items():
                    matches[0][rows[0].index(key)] = value
            name = sheet.get('name').lower() + '.csv'
            with (output / name).open('w', newline='', encoding='utf-8') as file:
                csv.writer(file).writerows(rows)
            quantity_index = rows[0].index('Qty')
            results.append({'sheet': sheet.get('name'), 'file': name, 'rows': len(rows)-1, 'copies': sum(int(row[quantity_index]) for row in rows[1:]), 'columns': rows[0]})
    return results


if __name__ == '__main__':
    workbook = Path(sys.argv[1] if len(sys.argv)>1 else 'data/pokemon_master_inventory.xlsx')
    output = Path(sys.argv[2] if len(sys.argv)>2 else 'data/extracted')
    print(json.dumps(extract(workbook, output), indent=2, ensure_ascii=False))
