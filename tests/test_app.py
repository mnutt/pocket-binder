import copy
import csv
import io
import json
import http.client
import tempfile
import threading
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request
from pathlib import Path
from app import Handler, HTTPServer, Store, available, parse_csv, export_csv, inventory_print_html


class CollectionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = Store(Path(self.tmp.name))
        self.card = {'id': 'base1-4', 'name': 'Charizard', 'quantity': 8}
        self.state = self.store.mutate('import', {'revision': 0, 'mode': 'add', 'cards': [self.card]})

    def tearDown(self):
        self.store.db.close()
        self.tmp.cleanup()

    def deck(self, id, quantity, exclusions=()):
        return {'id': id, 'name': id, 'types': ['Fire'], 'exclusions': list(exclusions), 'cards': {'base1-4': quantity}}

    def save(self, decks):
        return self.store.mutate('decks', {'revision': self.store.read()['revision'], 'decks': decks})

    def test_exclusions_sum_physical_copies(self):
        decks = [self.deck('a', 2), self.deck('b', 3), self.deck('c', 3, ['a', 'b'])]
        state = copy.deepcopy(self.save(decks))
        self.assertEqual(available(state, decks[2], 'base1-4'), 0)
        decks[2]['cards']['base1-4'] = 4
        with self.assertRaisesRegex(ValueError, 'not enough'):
            self.save(decks)
        self.assertEqual(self.store.read(), state)

    def test_modifying_reserved_deck_cannot_invalidate_other_deck(self):
        decks = [self.deck('a', 4), self.deck('b', 4, ['a'])]
        self.save(decks)
        decks[0]['cards']['base1-4'] = 5
        with self.assertRaisesRegex(ValueError, 'not enough'):
            self.save(decks)

    def test_unexcluded_alternative_decks_can_share_copies(self):
        self.save([self.deck('a', 8), self.deck('b', 8)])

    def test_duplicate_exclusions_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate excluded'):
            self.save([self.deck('a', 2), self.deck('b', 2, ['a', 'a'])])

    def test_snapshot_cannot_strand_deck(self):
        self.save([self.deck('a', 5)])
        before = self.store.read()
        with self.assertRaisesRegex(ValueError, 'not enough'):
            self.store.mutate('import', {'revision': before['revision'], 'mode': 'replace', 'cards': [{**self.card, 'quantity': 2}]})
        self.assertEqual(self.store.read(), before)

    def test_duplicate_rows_and_snapshot(self):
        payload = {'revision': 1, 'mode': 'replace', 'cards': [{**self.card, 'quantity': 2}, {**self.card, 'quantity': 3}]}
        self.assertEqual(self.store.mutate('import', payload)['cards']['base1-4']['quantity'], 5)
        payload['revision'] = 2
        self.assertEqual(self.store.mutate('import', payload)['cards']['base1-4']['quantity'], 5)
        payload.update(revision=3, mode='add')
        self.assertEqual(self.store.mutate('import', payload)['cards']['base1-4']['quantity'], 10)

    def test_stale_writes_rejected(self):
        with self.assertRaisesRegex(ValueError, 'another tab'):
            self.store.mutate('decks', {'revision': 0, 'decks': []})

    def test_restart(self):
        self.save([self.deck('a', 2)])
        before = self.store.read()
        self.store.db.close()
        self.store = Store(Path(self.tmp.name))
        self.assertEqual(self.store.read(), before)

    def test_metadata_refresh_preserves_inventory_and_decks(self):
        self.save([self.deck('a', 2)])
        before = self.store.read()
        result = self.store.mutate('details', {'revision': before['revision'], 'id': self.card['id'], 'details': {'evolveFrom': 'Charmeleon', 'stage': 'Stage2', 'quantity': 999}})
        self.assertEqual(result['cards'][self.card['id']]['quantity'], 8)
        self.assertEqual(result['cards'][self.card['id']]['evolveFrom'], 'Charmeleon')
        self.assertEqual(result['decks'], before['decks'])

    def change_copies(self, action, quantity, **extra):
        return self.store.mutate(action, {'revision': self.store.read()['revision'],
                                         'id': self.card['id'], 'quantity': quantity, **extra})

    def test_remove_mistake_without_trade_record(self):
        state = self.change_copies('remove', 3)
        self.assertEqual(state['cards'][self.card['id']]['quantity'], 5)
        self.assertEqual(state.get('trades', []), [])
        state = self.change_copies('remove', 5)
        self.assertEqual(state['cards'][self.card['id']]['quantity'], 0)

    def test_trade_archive_survives_reimport_and_restart(self):
        state = self.change_copies('trade', 3, note='  Traded with Alex for Eevee  ')
        trade = copy.deepcopy(state['trades'][0])
        self.assertEqual(trade['note'], 'Traded with Alex for Eevee')
        self.assertEqual(trade['status'], 'archived')
        self.assertEqual(trade['card']['quantity'], 3)
        self.assertTrue(trade['date'])
        self.assertEqual(state['cards'][self.card['id']]['quantity'], 5)
        self.change_copies('trade', 5, note='Another trade')
        self.store.mutate('import', {'revision': self.store.read()['revision'], 'mode': 'add', 'cards': [self.card]})
        self.store.db.close()
        self.store = Store(Path(self.tmp.name))
        self.assertEqual(self.store.read()['trades'][0], trade)
        self.assertEqual(len(self.store.read()['trades']), 2)
        self.assertEqual(self.store.read()['cards'][self.card['id']]['quantity'], 8)

    def test_invalid_removals_and_trades_are_atomic(self):
        before = self.store.read()
        for action in ('remove', 'trade'):
            for quantity in (0, -1, 9, 1.5, True):
                with self.subTest(action=action, quantity=quantity), self.assertRaises(ValueError):
                    self.change_copies(action, quantity, note='Trade')
        for note in (None, '', '  ', 'x' * 2001, 42):
            with self.subTest(note=note), self.assertRaises(ValueError):
                self.change_copies('trade', 1, note=note)
        with self.assertRaisesRegex(ValueError, 'Unknown card'):
            self.store.mutate('remove', {'revision': before['revision'], 'id': 'missing', 'quantity': 1})
        with self.assertRaisesRegex(ValueError, 'another tab'):
            self.store.mutate('trade', {'revision': 0, 'id': self.card['id'], 'quantity': 1, 'note': 'Trade'})
        self.assertEqual(self.store.read(), before)

    def test_removal_and_trade_respect_deck_reservations(self):
        self.save([self.deck('a', 3), self.deck('b', 3, ['a'])])
        before = self.store.read()
        for action in ('remove', 'trade'):
            with self.assertRaisesRegex(ValueError, 'not enough'):
                self.change_copies(action, 3, note='Trade')
            self.assertEqual(self.store.read(), before)
        state = self.change_copies('trade', 2, note='Spare copies')
        self.assertEqual(available(state, state['decks'][1], self.card['id']), 0)

    def test_add_copies_preserves_existing_notes(self):
        self.store.mutate('import', {'revision': 1, 'mode': 'add', 'cards': [{**self.card, 'inventory': {'notes': 'Original note'}}]})
        state = self.store.mutate('import', {'revision': 2, 'mode': 'add', 'cards': [{**self.card, 'quantity': 1}]})
        self.assertEqual(state['cards'][self.card['id']]['quantity'], 17)
        self.assertEqual(state['cards'][self.card['id']]['inventory']['notes'], 'Original note')

    def test_csv_quoted_bom_aliases(self):
        rows = parse_csv('\ufeffSet Name,Card Number,Card Name,Qty\r\nBase Set,004/102,"Charizard, special",2\r\n')
        self.assertEqual(rows[0]['name'], 'Charizard, special')
        self.assertEqual(rows[0]['quantity'], 2)
        self.assertEqual(rows[0]['set'], 'Base Set')

    def test_csv_accepts_set_codes_or_name_and_printed_number(self):
        row = parse_csv('name,card_number,quantity\nHypno,097/165,1')[0]
        self.assertEqual(row['name'], 'Hypno')
        self.assertEqual(row['number'], '097/165')
        row = parse_csv('set_code,card_number,quantity\nMEW,097/165,2')[0]
        self.assertEqual(row['setcode'], 'MEW')
        self.assertEqual(row['quantity'], 2)

    def test_export_preserves_unicode_quotes_and_multiline_notes(self):
        card = {**self.card, 'name': 'Pokémon "special", edition', 'set': {'name': 'Base Set'},
                'localId': '004', 'category': 'Pokemon', 'inventory': {'notes': 'First line\nSecond, "quoted" line'}}
        exported = export_csv([card])
        row = list(csv.DictReader(io.StringIO(exported)))[0]
        self.assertEqual(row['name'], card['name'])
        self.assertEqual(row['notes'], card['inventory']['notes'])
        self.assertEqual(parse_csv(exported)[0]['quantity'], 8)

    def test_export_preserves_unresolved_and_pooled_cards(self):
        cards = [
            {'id': 'unknown', 'name': 'Fletchling', 'quantity': 1, 'category': 'Pokemon', 'unresolved': True},
            {'id': 'energy', 'name': 'Fire Energy', 'quantity': 5, 'category': 'Energy', 'representative': True, 'energyType': 'Normal'},
        ]
        rows = parse_csv(export_csv(cards))
        self.assertTrue(rows[0]['pending'])
        self.assertTrue(rows[1]['pooled'])
        self.assertEqual(rows[1]['type'], 'Basic')

    def test_print_inventory_escapes_data_and_excludes_unowned_cards(self):
        page = inventory_print_html([
            {**self.card, 'name': '<script>alert(1)</script>', 'inventory': {'notes': 'A & B\nTrade note'}, 'unresolved': True},
            {'name': 'Traded away', 'quantity': 0},
        ])
        self.assertIn('&lt;script&gt;alert(1)&lt;/script&gt;', page)
        self.assertNotIn('A &amp; B', page)
        self.assertNotIn('>Notes</th>', page)
        self.assertIn('class="print-columns"', page)
        self.assertIn('Unresolved printing', page)
        self.assertNotIn('Traded away', page)
        self.assertIn('8 copies · 1 entries', page)
        self.assertIn('<thead>', page)
        self.assertIn('No cards in your inventory.', inventory_print_html([]))

    def test_deck_print_title_totals_and_category_order(self):
        deck = {'id': 'my-deck', 'name': 'Fire & "Friends"'}
        cards = [
            {'name': 'Fire Energy', 'quantity': 12, 'category': 'Energy'},
            {'name': 'Switch', 'quantity': 4, 'category': 'Trainer'},
            {**self.card, 'quantity': 2, 'category': 'Pokemon'},
        ]
        page = inventory_print_html(cards, deck)
        self.assertIn('<h1>Fire &amp; &quot;Friends&quot;</h1>', page)
        self.assertIn('18 / 60 cards · 2 Pokémon · 4 Trainers · 12 Energy', page)
        self.assertLess(page.index('<td>Charizard</td>'), page.index('<td>Switch</td>'))
        self.assertEqual(page.count('<td>Charizard</td>'), 1)
        self.assertEqual(page.count('<td>Switch</td>'), 1)
        self.assertEqual(page.count('<td>Fire Energy</td>'), 1)
        self.assertEqual(page.count('<th scope="col">Card</th>'), 2)
        self.assertIn('<td colspan="5"></td>', page)
        self.assertIn('./#deck=my-deck', page)
        self.assertIn('No cards in this deck.', inventory_print_html([], deck))

    def test_csv_rejects_ambiguous_and_invalid_rows(self):
        for text in ['name,quantity\nPikachu,1', 'card_id,qty\nbase1-4,-1', 'card_id,qty\nbase1-4,1.5', 'card_id,qty\n,1', 'id,card_id\na,b', 'id,qty\na,1,extra']:
            with self.subTest(text=text), self.assertRaises(ValueError):
                parse_csv(text)

    def test_extracted_workbook_formats(self):
        root = Path(__file__).resolve().parents[1] / 'data' / 'extracted'
        for name, category, count, copies in [('pokemon', 'Pokemon', 109, 111), ('trainers', 'Trainer', 27, 52), ('energy', 'Energy', 10, 111)]:
            rows = parse_csv((root / (name + '.csv')).read_text())
            self.assertEqual(len(rows), count)
            self.assertEqual(sum(r['quantity'] for r in rows), copies)
            self.assertTrue(all(r['scope'] == category for r in rows))
        pokemon = parse_csv((root / 'pokemon.csv').read_text())
        self.assertEqual({(r['setcode'], r['number'], r['quantity']) for r in pokemon if r['name'] == 'Eevee'}, {('SHF', '052/072', 1), ('PGO', '054/078', 1)})
        pending = [r for r in pokemon if r['pending']]
        self.assertEqual([r['name'] for r in pending], ['Fletchling'])
        self.assertIn('Japanese', pending[0]['notes'])
        self.assertEqual(pokemon[0]['number'], '044/198')
        energy = parse_csv((root / 'energy.csv').read_text())
        self.assertTrue(all(r['pooled'] for r in energy))

    def test_category_snapshot_preserves_other_categories(self):
        for category in ('Pokemon', 'Trainer', 'Energy'):
            card = {'id': category, 'name': category, 'category': category, 'quantity': 10, 'inventory': {'notes': 'original notes'}}
            self.store.mutate('import', {'revision': self.store.read()['revision'], 'mode': 'replace', 'scope': category, 'cards': [card]})
        state = self.store.read()
        self.assertEqual([state['cards'][c]['quantity'] for c in ('Pokemon', 'Trainer', 'Energy')], [10, 10, 10])
        self.assertEqual(state['cards']['Trainer']['inventory']['notes'], 'original notes')
        with self.assertRaisesRegex(ValueError, 'category'):
            self.store.mutate('import', {'revision': state['revision'], 'mode': 'replace', 'scope': 'Trainer', 'cards': [{'id': 'wrong', 'name': 'Wrong', 'category': 'Pokemon', 'quantity': 1}]})


class HTTPTests(unittest.TestCase):
    def test_permission_and_csrf_boundaries(self):
        # The server and SQLite connection run on the same worker, as in production.
        with tempfile.TemporaryDirectory() as directory:
            server = HTTPServer(('127.0.0.1', 0), Handler)
            def run():
                server.store = Store(Path(directory))
                server.serve_forever()
                server.store.db.close()
            thread = threading.Thread(target=run)
            thread.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                for headers, expected in [({}, 403), ({'X-Sandstorm-Permissions': 'edit'}, 403), ({'X-Sandstorm-Permissions': 'edit', 'X-Requested-With': 'PocketBinder'}, 200), ({'X-Sandstorm-Permissions': 'view', 'X-Requested-With': 'PocketBinder'}, 403)]:
                    request = urllib.request.Request(base+'/api/decks', json.dumps({'revision': 0, 'decks': []}).encode(), headers)
                    try:
                        with urllib.request.urlopen(request) as response:
                            status = response.status
                    except urllib.error.HTTPError as error:
                        status = error.code
                    self.assertEqual(status, expected)
                with urllib.request.urlopen(base+'/api/state') as response:
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                    self.assertFalse(json.load(response)['canEdit'])
                for action in ('remove', 'trade'):
                    request = urllib.request.Request(base+'/api/'+action, b'{}', {'X-Requested-With': 'PocketBinder'})
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        urllib.request.urlopen(request)
                    self.assertEqual(caught.exception.code, 403)
                    caught.exception.close()
                headers = {'X-Sandstorm-Permissions': 'edit', 'X-Requested-With': 'PocketBinder'}
                # Preview an unowned printing without changing collection state.
                face = b'RIFF\x04\x00\x00\x00WEBP'
                preview_request = urllib.request.Request(base+'/api/preview-image', json.dumps({'id': 'base1-58'}).encode(), headers)
                with patch.object(Store, 'token', return_value='test-token'), patch('app.bridge_request', side_effect=[
                    json.dumps({'id': 'base1-58', 'image': 'https://assets.tcgdex.net/en/base/base1/58'}).encode(), face,
                ]) as bridge:
                    with urllib.request.urlopen(preview_request) as response:
                        self.assertTrue(json.load(response)['ok'])
                    self.assertEqual(bridge.call_count, 2)
                    with urllib.request.urlopen(preview_request) as response:
                        self.assertTrue(json.load(response)['ok'])
                    self.assertEqual(bridge.call_count, 2)  # Cached previews need no network.
                with urllib.request.urlopen(base+'/images/base1-58') as response:
                    self.assertEqual(response.read(), face)
                    self.assertEqual(response.headers['Cache-Control'], 'private, max-age=86400')
                    etag = response.headers['ETag']
                    self.assertTrue(etag.startswith('"') and etag.endswith('"'))
                for validator in (etag, 'W/' + etag, '"old", ' + etag, '*'):
                    request = urllib.request.Request(base+'/images/base1-58', headers={'If-None-Match': validator})
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        urllib.request.urlopen(request)
                    with caught.exception as response:
                        self.assertEqual(response.code, 304)
                        self.assertEqual(response.read(), b'')
                        self.assertEqual(response.headers['ETag'], etag)
                        self.assertEqual(response.headers['Cache-Control'], 'private, max-age=86400')
                        self.assertIsNone(response.headers['Content-Length'])
                request = urllib.request.Request(base+'/images/base1-58', headers={'If-None-Match': '"old"'})
                with urllib.request.urlopen(request) as response:
                    self.assertEqual(response.status, 200)
                    self.assertEqual(response.read(), face)
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(base+'/images/missing')
                with caught.exception as response:
                    self.assertEqual(response.code, 404)
                    self.assertEqual(response.headers['Cache-Control'], 'no-store')
                with urllib.request.urlopen(base+'/api/state') as response:
                    preview_state = json.load(response)
                    self.assertEqual(preview_state['cards'], {})
                    self.assertEqual(preview_state['revision'], 1)
                bad_request = urllib.request.Request(base+'/api/preview-image', json.dumps({'id': 'base1-59'}).encode(), headers)
                with patch.object(Store, 'token', return_value='test-token'), patch('app.bridge_request', return_value=json.dumps({'id': 'base1-59', 'image': 'https://example.com/face'}).encode()) as bridge:
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        urllib.request.urlopen(bad_request)
                    self.assertEqual(caught.exception.code, 400)
                    caught.exception.close()
                    self.assertEqual(bridge.call_count, 1)
                operations = [
                    ('import', {'revision': 1, 'mode': 'add', 'cards': [{'id': 'base1-4', 'name': 'Charizard', 'quantity': 3}]}),
                    ('remove', {'revision': 2, 'id': 'base1-4', 'quantity': 1}),
                    ('trade', {'revision': 3, 'id': 'base1-4', 'quantity': 2, 'note': 'For Eevee'}),
                ]
                for action, payload in operations:
                    request = urllib.request.Request(base+'/api/'+action, json.dumps(payload).encode(), headers)
                    with urllib.request.urlopen(request) as response:
                        result = json.load(response)
                self.assertEqual(result['cards']['base1-4']['quantity'], 0)
                self.assertEqual(result['trades'][0]['note'], 'For Eevee')
                # Downloads and print views are available to viewers, without blobs.
                with urllib.request.urlopen(base+'/api/export/collection') as response:
                    self.assertEqual(response.headers.get_content_type(), 'text/csv')
                    self.assertEqual(response.headers['Content-Disposition'], 'attachment; filename="collection.csv"')
                    self.assertEqual(list(csv.DictReader(io.StringIO(response.read().decode()))), [])
                for action, payload in [
                    ('import', {'revision': 4, 'mode': 'add', 'cards': [{'id': 'base1-4', 'name': 'Charizard', 'quantity': 3, 'set': {'name': 'Base Set'}, 'localId': '004'}]}),
                    ('decks', {'revision': 5, 'decks': [{'id': 'test', 'name': 'Deck "one"\r\n', 'types': [], 'exclusions': [], 'cards': {'base1-4': 2}}]}),
                ]:
                    request = urllib.request.Request(base+'/api/'+action, json.dumps(payload).encode(), headers)
                    with urllib.request.urlopen(request) as response:
                        self.assertEqual(response.status, 200)
                for route, quantity in [('collection', '3'), ('deck/test', '2')]:
                    with urllib.request.urlopen(base+'/api/export/'+route) as response:
                        self.assertTrue(response.headers['Content-Disposition'].startswith('attachment; filename="'))
                        rows = list(csv.DictReader(io.StringIO(response.read().decode())))
                        self.assertEqual(rows[0]['quantity'], quantity)
                        self.assertEqual(rows[0]['name'], 'Charizard')
                with urllib.request.urlopen(base+'/print-inventory') as response:
                    page = response.read().decode()
                    self.assertIn('3 copies', page)
                    self.assertIn('Charizard', page)
                    self.assertNotIn('For Eevee', page)
                with urllib.request.urlopen(base+'/print-deck?id=test') as response:
                    page = response.read().decode()
                    self.assertIn('<h1>Deck &quot;one&quot;', page)
                    self.assertIn('2 / 60 cards', page)
                    self.assertIn('<td>2</td>', page)
                    self.assertNotIn('<td>3</td>', page)
                    self.assertIn('Back to deck', page)
                for route in ['/print-deck', '/print-deck?id=missing']:
                    with self.assertRaises(urllib.error.HTTPError) as caught:
                        urllib.request.urlopen(base+route)
                    self.assertEqual(caught.exception.code, 404)
                    caught.exception.close()
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    urllib.request.urlopen(base+'/api/export/deck/missing')
                self.assertEqual(caught.exception.code, 404)
                caught.exception.close()
                for route in ['/', '/app.js', '/lookup.js', '/style.css', '/navigation.js', '/print.js', '/print.css']:
                    with urllib.request.urlopen(base+route) as response:
                        self.assertEqual(response.status, 200)
                with urllib.request.urlopen(base+'/fonts/Oxanium.ttf') as response:
                    self.assertEqual(response.headers.get_content_type(), 'font/ttf')
                    self.assertIn("font-src 'self'", response.headers['Content-Security-Policy'])
                    self.assertEqual(response.read()[:4], b'\x00\x01\x00\x00')
                with urllib.request.urlopen(base+'/fonts/OFL-Oxanium.txt') as response:
                    self.assertIn(b'SIL OPEN FONT LICENSE', response.read())
                connection = http.client.HTTPConnection('127.0.0.1', server.server_port)
                body = json.dumps({'csv': 'card_id,quantity\nbase1-4,2'}).encode()
                connection.request('POST', '/api/preview', iter([body[:10], body[10:]]), {'X-Sandstorm-Permissions': 'edit', 'X-Requested-With': 'PocketBinder'}, encode_chunked=True)
                response = connection.getresponse()
                self.assertEqual(response.status, 200)
                self.assertEqual(json.loads(response.read())['rows'][0]['quantity'], 2)
                connection.close()
            finally:
                server.shutdown()
                thread.join()
                server.server_close()


if __name__ == '__main__':
    unittest.main()
