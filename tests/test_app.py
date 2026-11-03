import copy
import json
import http.client
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path
from app import Handler, HTTPServer, Store, available, parse_csv


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

    def test_csv_quoted_bom_aliases(self):
        rows = parse_csv('\ufeffSet Name,Card Number,Card Name,Qty\r\nBase Set,004/102,"Charizard, special",2\r\n')
        self.assertEqual(rows[0]['name'], 'Charizard, special')
        self.assertEqual(rows[0]['quantity'], 2)
        self.assertEqual(rows[0]['set'], 'Base Set')

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
                    self.assertFalse(json.load(response)['canEdit'])
                for route in ['/', '/app.js', '/style.css']:
                    with urllib.request.urlopen(base+route) as response:
                        self.assertEqual(response.status, 200)
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
