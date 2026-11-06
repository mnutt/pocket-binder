# Pocket Binder

A Sandstorm app for a Pokémon card collection and multiple decks. One grain holds a collection and its decks. Python's standard library and SQLite power the server; the interface has no runtime JavaScript dependencies.

## Import a collection

Choose **Import CSV**, select a file, then **Look up cards**. The primary format is:

```csv
name,set,card_number,quantity
Charizard,Base Set,4,2
Charmander,Base Set,46,4
Fire Energy,Base Set,98,20
```

Sets accept TCGdex's English names, IDs such as `base1`, and common printed codes such as `MEW` (Scarlet & Violet—151), `SVI`, `PAL`, `SHF`, and `PGO`. Codes from the collection workbook are supported, ignoring case; CSV files may use a `set_code` column. Card numbers accept leading zeros and a printed total (`004/102`). A `name,card_number,quantity` CSV can omit the set when the exact name and full printed number/total identify a unique printing. The printed denominator is checked against the official set size, including for secret rare numbers above that size. Ambiguous matches require a set or explicit card ID. Names are checked against the resolved printing. A mismatch, missing set, or ambiguous number is shown in the preview and can be resolved by entering a specific TCGdex card ID. Imports are atomic: every row must either resolve or be explicitly retained as unresolved before committing. Rows already marked pending in the workbook remain unresolved automatically. Duplicate printings are combined. An alternative `card_id,quantity` format is supported. See [examples/collection.csv](examples/collection.csv).

**Replace collection quantities** is the default. The workbook’s recognized Pokémon, Trainer, and Energy formats replace only their own category, so the three files can be imported sequentially. Generic CSV files replace the entire collection. Printings absent from the snapshot’s scope become zero. Reimporting the same snapshot does not add copies. **Add these copies** adds quantities to existing inventory. Imports that would invalidate a saved deck are rejected; remove those copies from the affected decks first.

Card details come from the [TCGdex REST API](https://tcgdex.dev/rest/card), and faces use its [image API](https://tcgdex.dev/assets). Sandstorm asks for two outbound HTTP capabilities: one for the card database and one for image assets. The app redeems those grants through `sandstorm-http-bridge`, stores the durable tokens privately in SQLite, and fetches through the bridge proxy. The browser communicates only with its own grain; Sandstorm’s strict content security policy remains enabled. Reconnect either source from the import dialog if access is revoked. No API key is needed. The first lookup needs internet access; saved cards and images work offline. Failed image downloads can be retried with **Fetch missing faces**. Exact lookups currently use the English card database. Unidentified cards can be retained as unresolved with their original notes and no guessed face. Energy rows without a set/number are pooled by name and may use clearly labeled representative artwork. Quantities are tracked per printing (or pooled Energy name), without separate foil/condition inventories.

## Manage individual cards

Choose **Add card** to search TCGdex by name or card ID, or look up a set name/code and printed card number. You can leave the set blank and enter the name and printed number/total. If several printings match, use the arrows on either side of the card face to browse them; the counter and set details show which printing you are about to add. Name-only searches also use this face browser. Add card search results place printings with artwork first, preserving the existing order within each group. Cards without artwork remain available; check their name, set, and number and choose **Add without artwork**. If an image download fails, you can retry or add without artwork. Select the exact printing, check its card face and details, and enter the number of copies. Available faces are fetched before addition; missing or failed artwork does not prevent adding the card. Previewing does not change inventory. Existing copies and inventory notes are retained.

Open a card's face to manage owned copies. **Remove mistaken copies** corrects an inventory mistake without creating a trade record. **Archive trade** removes the specified copies from owned inventory and saves a required trade note, timestamp, and card details. **Trade archive** in the sidebar shows past trades, including cards you no longer own. Adding the same printing again or importing a snapshot preserves the trade archive. Collection exports contain only currently owned copies.

Both removal and trading reject changes that leave a saved deck short, including copies held back by exclusions. Adjust those decks first. Viewers can browse the trade archive; only editors can change inventory.

## Build decks

Create a deck, choose energy types, and add cards from the filtered collection. Colorless Pokémon, Trainers, and compatible Energy remain visible. Inspect a card to read its attacks and effects.

Select other decks under **Hold back cards** to reserve their copies. For each printing:

```
remaining = owned − copies in selected exclusion decks − copies in current deck
```

Exclusions persist per deck. Multiple excluded decks consume separate copies, even when they contain the same printing. Nonexcluded decks can share inventory as alternative builds. The server validates all saved decks after every change, including changes to a deck reserved by another deck. It refuses changes that would create shortages. Remove an exclusion if you want those decks to share copies again.

The deck panel counts toward 60 cards and flags missing Basic Pokémon and more than four copies of a name (except Basic Energy). These are casual building aids, not a tournament legality checker; special card rules and current format legality are not enforced. Collection and deck CSV exports can be reimported. Exports use same-origin attachment downloads so they work within Sandstorm’s content security policy. **Print** beside “Your collection” opens the inventory as a table with card names, sets, numbers, categories, and quantities, then opens the browser print dialog. The same button beside a deck’s title prints only that deck, using deck quantities and a Pokémon/Trainer/Energy breakdown. Printouts use two columns on landscape pages with compact text and row spacing; notes are omitted. Table headers repeat on each page; traded and other unowned copies are excluded.

## Sandstorm development

Install `spktool` and Lima, then:

```sh
spktool vm up
spktool init  # only for a fresh app identity; this repository already has one
spktool dev
```

Open the URL printed by `spktool dev` and create a **Pocket Binder** grain. The VM serves Sandstorm on port 6090. Package settings live in `.sandstorm/box.toml`; user-owned build and launcher scripts live beside it. Regenerate provider files with `spktool upgradevm` after changing configuration. Run `spktool vm provision` after changing guest dependencies. The launcher uses `/usr/bin/python3`; no pip dependencies are required.

Run tests inside the VM:

```sh
limactl shell --workdir /opt/app sandstorm-pokemon-deck-94ec1342 python3 -m unittest discover -s tests -v
```

`spktool dev` also runs these tests before starting. They cover CSV parsing, import modes, atomic failures, reservation math, stale writes, restart persistence, and HTTP permissions.

After exercising a grain, stop dev mode to flush the traced file list, then:

```sh
spktool pack pocket-binder.spk
spktool verify pocket-binder.spk
```

Explicit package inclusion covers the app, static assets, launcher, and Python standard library. The traced file list supplies the interpreter, bridge, and native libraries. Package signing keys remain in the host's Sandstorm keyring, outside this repository. App-market publication metadata and a distribution license have not been selected.

## Data and sharing

Persistent data and cached faces live in `/var/pocket-binder/collection.sqlite3`. Sandstorm grain backups preserve both, along with all decks. SQLite transactions make imports and deck changes atomic; revision checks prevent one tab from silently overwriting another. No background jobs are required.

Sandstorm provides authentication. Editors may import and change decks; viewers can browse and export. Mutating HTTP endpoints require the bridge's `edit` permission and a custom request header. The server binds only to loopback behind `sandstorm-http-bridge`. Do not expose the Python server directly to untrusted clients, which could forge Sandstorm headers.

## Workbook extracts

The original `data/pokemon_master_inventory.xlsx` is preserved. Recreate the extracts with:

```sh
python3 scripts/extract_inventory.py
```

| Extract | Rows | Copies |
| --- | ---: | ---: |
| `data/extracted/pokemon.csv` | 109 | 111 |
| `data/extracted/trainers.csv` | 27 | 52 |
| `data/extracted/energy.csv` | 10 | 111 |

Headers and values are preserved, with explicit user corrections applied from `data/inventory-corrections.json`. The Eevee previously labeled SWSH042 is corrected to Shining Fates 052/072; the Pokémon GO 054/078 Eevee remains unchanged. The extracts retain collector-number leading zeros, quantities, identification status, photo references, URLs, and notes. The importer recognizes `Collector No.`, `Qty`, `Source Photo`, and the Energy sheet's `Energy,Qty,Type` schema. The Japanese Fletchling remains unresolved. Basic Energy and Treasure Energy have no exact printings in this workbook, so their images are representative. Deck Notes contains descriptions rather than full card lists and is not turned into invented deck contents.

## Guided building

Each deck now has steps for a main attacker, supporting Pokémon, Trainers, Energy, and review. Recommendations use attack costs rather than Pokémon type alone. Off-type Ability support remains available. Select **Browse all cards** to leave the step filter.

Guided additions require a known, complete evolution chain already in the deck. **Add evolution line** previews and adds missing predecessors and the selected evolution together, using available printings after exclusions. Names match exactly (including regional forms); the app never treats missing evolution metadata as proof that a card is Basic. **Update card details** refreshes older imports without changing quantities, notes, faces, or decks.

**Allow draft additions** bypasses evolution and normal size/name limits for experimentation and special card effects. Reservations always remain enforced on the server. Evolution completeness is strategic guidance, not a deck-construction rule. The review separates construction issues from consistency advice; it does not certify tournament legality or implement all special card exceptions.

Trainer roles are conservative text-based hints, supplemented by explicit checks for several condition-dependent Trainers in this inventory. Recommendations explain themselves and ask you to inspect card conditions. Special Energy is not assumed to provide arbitrary types. The 16 Pokémon / 32 Trainers / 12 Energy suggestion is an adjustable starting point, not a requirement. Opening-hand probability uses the current draft size and confirmed Basic count; sample hands do not modify the deck.

Run the pure guidance tests with `node tests/guide.test.cjs` (no dependencies). These cover attack costs, multi-stage chains, reserved prerequisites, regional names, unknown data, four-copy counts across printings, draft overrides, and opening-hand probability.

Run the printing lookup tests with `node tests/lookup.test.cjs`. These cover set aliases, unique and ambiguous setless matches, printed totals, secret rares, and failed lookups.

The printer icon beside the collection or deck title opens its print view. Sandstorm’s page-path notifications preserve the current deck or print page when you reload.

## Fonts

The interface uses [Oxanium](https://fonts.google.com/specimen/Oxanium), distributed under the SIL Open Font License 1.1. The unmodified variable font and [license](public/fonts/OFL-Oxanium.txt) are bundled in the package and served from the grain; no external font service is used.

## License

Pocket Binder is licensed under the [MIT License](LICENSE). The bundled Oxanium font retains its SIL Open Font License. Third-party card data and artwork retain their respective rights and are not covered by the app’s MIT license.
