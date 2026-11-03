"""Pocket Binder: dependency-free Sandstorm collection and deck manager."""
import csv
import io
import http.client
import hashlib
import json
import os
import re
import sqlite3
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import urlsplit, quote

TYPES = ['Grass', 'Fire', 'Water', 'Lightning', 'Psychic', 'Fighting', 'Darkness', 'Metal', 'Dragon', 'Fairy', 'Colorless']
DATA = Path(os.environ.get('DATA_DIR', '/var/pocket-binder'))
PUBLIC = Path(__file__).parent / 'public'

def bridge_request(url, data=None, token=None, limit=8000000):
    proxy = urlsplit(os.environ.get('HTTP_PROXY', os.environ.get('http_proxy', '')))
    require(proxy.hostname, 'Sandstorm HTTP bridge is unavailable.')
    connection = http.client.HTTPConnection(proxy.hostname, proxy.port or 80, timeout=25)
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    try:
        connection.request('POST' if data is not None else 'GET', url, json.dumps(data).encode() if data is not None else None, headers)
        response = connection.getresponse()
        body = response.read(limit + 1)
        require(200 <= response.status < 300, f'Card source returned HTTP {response.status}. Check the card ID, or reconnect the source if access was revoked.')
        require(len(body) <= limit, 'Card source response is too large.')
        return body
    finally:
        connection.close()



def require(condition, message):
    if not condition:
        raise ValueError(message)


def integer(value, minimum=0, maximum=100000):
    require(type(value) is int and minimum <= value <= maximum, 'Invalid quantity.')
    return value


def parse_csv(text):
    reader = csv.DictReader(io.StringIO(text.lstrip('\ufeff')), strict=True)
    require(reader.fieldnames, 'CSV is empty.')
    aliases = {'cardid': 'id', 'card': 'name', 'cardname': 'name', 'energy': 'name', 'setid': 'set', 'setname': 'set', 'cardnumber': 'number', 'collectorno': 'number', 'localid': 'number', 'qty': 'quantity', 'count': 'quantity', 'sourcephoto': 'source'}
    keys = [aliases.get(re.sub('[^a-z0-9]', '', k.lower()), re.sub('[^a-z0-9]', '', k.lower())) for k in reader.fieldnames]
    require(len(keys) == len(set(keys)), 'Duplicate CSV column names.')
    energy_sheet = 'Energy' in reader.fieldnames and 'type' in keys
    scope = '' if 'inventorycategory' in keys else 'Energy' if energy_sheet else 'Trainer' if 'category' in keys else 'Pokemon' if 'hp' in keys else ''
    require(energy_sheet or 'id' in keys or ('set' in keys and 'number' in keys), 'Include card_id or both set and card_number columns, or Energy,Qty,Type.')
    rows = []
    for line, raw in enumerate(reader, 2):
        require(None not in raw, f'Row {line}: too many columns.')
        row = {key: (value or '').strip() for key, value in zip(keys, raw.values())}
        pooled = energy_sheet or row.get('printingstatus') == 'representative'
        row_scope = row.get('inventorycategory', scope)
        require(row_scope in ('', 'Pokemon', 'Trainer', 'Energy'), f'Row {line}: invalid inventory category.')
        pending = bool(row.get('name') and ('pending' in row.get('idstatus', '').lower() or row.get('printingstatus') == 'unresolved'))
        require(row.get('id') or (row.get('set') and row.get('number')) or (pooled and row.get('name')) or pending, f'Row {line}: missing card ID or set/number.')
        quantity = row.get('quantity', '1')
        require(quantity.isdigit() and 1 <= int(quantity) <= 100000, f'Row {line}: quantity must be a positive whole number.')
        identity = '|'.join(row.get(k, '').lower() for k in ('name', 'set', 'number'))
        local_id = ('energy-' if pooled else 'unresolved-') + hashlib.sha256(identity.encode()).hexdigest()[:20]
        rows.append({**row, 'quantity': int(quantity), 'line': line, 'scope': row_scope, 'pooled': pooled, 'pending': pending, 'localKey': local_id})
    require(0 < len(rows) <= 5000, 'Import between 1 and 5,000 rows at a time.')
    return rows


def available(state, deck, card_id):
    reserved = sum(d['cards'].get(card_id, 0) for d in state['decks'] if d['id'] in set(deck['exclusions']))
    return state['cards'].get(card_id, {}).get('quantity', 0) - reserved - deck['cards'].get(card_id, 0)


def validate_decks(state):
    decks = state['decks']
    require(isinstance(decks, list) and len(decks) <= 200, 'Too many decks.')
    ids = [d['id'] for d in decks]
    require(len(ids) == len(set(ids)), 'Duplicate deck IDs.')
    for deck in decks:
        require(isinstance(deck['id'], str) and re.fullmatch(r'[a-zA-Z0-9-]{1,80}', deck['id']), 'Invalid deck ID.')
        require(isinstance(deck['name'], str) and 0 < len(deck['name'].strip()) <= 100, 'Give each deck a name of up to 100 characters.')
        require(isinstance(deck['types'], list) and all(t in TYPES for t in deck['types']), 'Invalid energy types.')
        require(isinstance(deck['exclusions'], list) and all(e in ids and e != deck['id'] for e in deck['exclusions']), 'Invalid excluded deck.')
        require(len(deck['exclusions']) == len(set(deck['exclusions'])), 'Duplicate excluded deck.')
        require(isinstance(deck['cards'], dict), 'Invalid deck cards.')
        for card_id, qty in deck['cards'].items():
            integer(qty, 1)
            require(card_id in state['cards'], 'Deck contains a card outside your collection.')
            require(available(state, deck, card_id) >= 0, f'{deck["name"]}: not enough copies of {state["cards"][card_id]["name"]} after holding back excluded decks.')


class Store:
    def __init__(self, directory):
        directory.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(directory / 'collection.sqlite3')
        self.db.execute('CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS connections (kind TEXT PRIMARY KEY, token TEXT NOT NULL)')
        self.db.execute('CREATE TABLE IF NOT EXISTS images (id TEXT PRIMARY KEY, data BLOB NOT NULL)')
        self.db.execute('INSERT OR IGNORE INTO state VALUES (1, ?)', (json.dumps({'revision': 0, 'cards': {}, 'decks': []}),))
        self.db.commit()

    def token(self, kind):
        row = self.db.execute('SELECT token FROM connections WHERE kind=?', (kind,)).fetchone()
        require(row, 'Connect the card source first.')
        return row[0]

    def read(self):
        return json.loads(self.db.execute('SELECT value FROM state WHERE id=1').fetchone()[0])

    def mutate(self, action, payload):
        state = self.read()
        require(payload.get('revision') == state['revision'], 'The collection changed in another tab. Reload and try again.')
        if action == 'decks':
            state['decks'] = payload['decks']
        elif action == 'details':
            card = state['cards'].get(payload['id'])
            require(card and not card.get('unresolved'), 'Cannot refresh an unidentified card.')
            details = payload['details']
            for key in ('evolveFrom', 'retreat', 'suffix', 'stage', 'attacks', 'abilities', 'effect'):
                if key in details:
                    card[key] = details[key]
            card['detailsVersion'] = 1
        elif action == 'import':
            require(payload.get('mode') in ('add', 'replace'), 'Invalid import mode.')
            scope = payload.get('scope', '')
            require(scope in ('', 'Pokemon', 'Trainer', 'Energy'), 'Invalid import scope.')
            rows = payload['cards']
            require(isinstance(rows, list) and 0 < len(rows) <= 5000, 'Invalid import size.')
            quantities = {}
            for card in rows:
                card_id = card['id']
                require(isinstance(card_id, str) and re.fullmatch(r'[a-zA-Z0-9.-]{1,100}', card_id), 'Invalid card ID.')
                require(isinstance(card.get('name'), str) and 0 < len(card['name']) <= 200, 'Invalid card name.')
                qty = integer(card['quantity'], 1)
                quantities[card_id] = quantities.get(card_id, 0) + qty
                old = state['cards'].get(card_id, {})
                # Store JSON metadata only; images use a separate bounded endpoint.
                require(not scope or card.get('category') == scope, 'Card does not match this import category.')
                clean = {k: card[k] for k in ('id', 'name', 'set', 'localId', 'category', 'types', 'hp', 'stage', 'evolveFrom', 'retreat', 'suffix', 'detailsVersion', 'attacks', 'abilities', 'effect', 'rarity', 'energyType', 'trainerType', 'regulationMark', 'legal', 'image', 'inventory', 'unresolved', 'representative', 'representativeCardId') if k in card}
                state['cards'][card_id] = {**clean, 'quantity': old.get('quantity', 0)}
            if payload['mode'] == 'replace':
                for card in state['cards'].values():
                    if not scope or card.get('category') == scope:
                        card['quantity'] = 0
            for card_id, qty in quantities.items():
                state['cards'][card_id]['quantity'] += qty
                integer(state['cards'][card_id]['quantity'])
        else:
            raise ValueError('Unknown action.')
        validate_decks(state)
        state['revision'] += 1
        with self.db:
            self.db.execute('UPDATE state SET value=? WHERE id=1', (json.dumps(state),))
        return state


class Handler(BaseHTTPRequestHandler):
    def read_body(self, limit=16000000):
        # WebSession streams large POSTs; the HTTP bridge forwards them chunked.
        self.connection.settimeout(30)
        if self.headers.get('Transfer-Encoding', '').lower() == 'chunked':
            result = bytearray()
            while True:
                line = self.rfile.readline(128)
                require(line.endswith(b'\r\n'), 'Invalid chunk header.')
                size = int(line.split(b';', 1)[0].strip(), 16)
                require(size >= 0 and len(result) + size <= limit, 'Request too large.')
                if size == 0:
                    # Bound trailers as well as the body.
                    for _ in range(100):
                        trailer = self.rfile.readline(8192)
                        require(trailer.endswith(b'\r\n'), 'Invalid request trailer.')
                        if trailer == b'\r\n':
                            return bytes(result)
                    raise ValueError('Too many request trailers.')
                chunk = self.rfile.read(size)
                require(len(chunk) == size and self.rfile.read(2) == b'\r\n', 'Incomplete request chunk.')
                result.extend(chunk)
        length = int(self.headers.get('Content-Length', 0))
        require(0 < length <= limit, 'Request too large or empty.')
        body = self.rfile.read(length)
        require(len(body) == length, 'Incomplete request body.')
        return body

    def send(self, status, body, content_type='application/json'):
        if isinstance(body, (dict, list)):
            body = json.dumps(body).encode()
        elif isinstance(body, str):
            body = body.encode()
        self.send_response(status)
        self.send_header('Content-Type', content_type)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'self'")
        self.end_headers()
        self.wfile.write(body)

    def can_edit(self):
        return 'edit' in [p.strip() for p in self.headers.get('X-Sandstorm-Permissions', '').split(',')]

    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/api/connections':
            descriptors = json.loads((PUBLIC / 'powerbox.json').read_text())
            saved = {row[0] for row in self.server.store.db.execute('SELECT kind FROM connections')}
            return self.send(200, {kind: {'query': query, 'connected': kind in saved} for kind, query in descriptors.items()})
        if path == '/api/state':
            return self.send(200, {**self.server.store.read(), 'canEdit': self.can_edit()})
        if path.startswith('/images/'):
            row = self.server.store.db.execute('SELECT data FROM images WHERE id=?', (path[8:],)).fetchone()
            return self.send(200, row[0], 'image/webp') if row else self.send(404, {'error': 'Image not cached.'})
        files = {'/': ('index.html', 'text/html; charset=utf-8'), '/app.js': ('app.js', 'text/javascript'), '/style.css': ('style.css', 'text/css'), '/guide.js': ('guide.js', 'text/javascript')}
        if path in files:
            name, mime = files[path]
            return self.send(200, (PUBLIC / name).read_bytes(), mime)
        self.send(404, {'error': 'Not found.'})

    def do_POST(self):
        if not self.can_edit():
            return self.send(403, {'error': 'This shared collection is read-only.'})
        if self.headers.get('X-Requested-With') != 'PocketBinder':
            return self.send(403, {'error': 'Invalid request.'})
        try:
            payload = json.loads(self.read_body())
            path = urlsplit(self.path).path
            if path == '/api/preview':
                rows = parse_csv(payload['csv'])
                scopes = {row['scope'] for row in rows}
                return self.send(200, {'rows': rows, 'scope': scopes.pop() if len(scopes) == 1 else ''})
            if path == '/api/connect':
                kind = payload['kind']
                require(kind in ('details', 'images'), 'Invalid card source.')
                session = self.headers.get('X-Sandstorm-Session-Id', '')
                require(session, 'Open the app in Sandstorm to connect a card source.')
                result = json.loads(bridge_request('http://http-bridge/session/' + quote(session, safe='') + '/claim', {'requestToken': payload['token'], 'requiredPermissions': ['edit']}))
                require(isinstance(result.get('cap'), str) and result['cap'], 'Could not claim card source.')
                with self.server.store.db:
                    self.server.store.db.execute('INSERT OR REPLACE INTO connections VALUES (?, ?)', (kind, result['cap']))
                return self.send(200, {'ok': True})
            if path == '/api/lookup':
                route = payload['path']
                require(isinstance(route, str) and re.fullmatch(r'(sets|cards)(/[a-zA-Z0-9.%_-]+)?', route), 'Invalid card lookup.')
                data = bridge_request('http://tcgdex/' + route, token=self.server.store.token('details'))
                return self.send(200, json.loads(data))
            if path == '/api/refresh-card':
                card = self.server.store.read()['cards'].get(payload['id'])
                require(card and not card.get('unresolved'), 'Cannot refresh an unidentified card.')
                source_id = card.get('representativeCardId', card['id'])
                details = json.loads(bridge_request('http://tcgdex/cards/' + quote(source_id, safe=''), token=self.server.store.token('details')))
                require(details.get('id') == source_id, 'Card source returned a different printing.')
                return self.send(200, self.server.store.mutate('details', {'revision': payload['revision'], 'id': card['id'], 'details': details}))
            if path == '/api/cache-image':
                card = self.server.store.read()['cards'].get(payload['id'])
                require(card, 'Unknown card.')
                if self.server.store.db.execute('SELECT 1 FROM images WHERE id=?', (card['id'],)).fetchone():
                    return self.send(200, {'ok': True})
                url = urlsplit(card.get('image', ''))
                require(url.scheme == 'https' and url.netloc == 'assets.tcgdex.net', 'This card has no supported face image.')
                data = bridge_request('http://tcgdex' + url.path + '/high.webp', token=self.server.store.token('images'), limit=2000000)
                require(data[:4] == b'RIFF' and data[8:12] == b'WEBP', 'Invalid WebP image.')
                with self.server.store.db:
                    self.server.store.db.execute('INSERT OR REPLACE INTO images VALUES (?, ?)', (card['id'], data))
                return self.send(200, {'ok': True})
            require(path in ('/api/import', '/api/decks'), 'Unknown action.')
            self.send(200, self.server.store.mutate(path.removeprefix('/api/'), payload))
        except (ValueError, KeyError, TypeError, AttributeError, csv.Error, OSError, http.client.HTTPException) as error:
            self.send(400, {'error': str(error) or 'Invalid request.'})


if __name__ == '__main__':
    server = HTTPServer(('127.0.0.1', int(os.environ.get('PORT', '8000'))), Handler)
    server.store = Store(DATA)
    server.serve_forever()
