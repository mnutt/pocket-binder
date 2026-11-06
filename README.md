# Pocket Binder

Keep track of your Pokémon cards and build decks from the cards you own.

Pocket Binder runs on [Sandstorm](https://sandstorm.org). Each grain is a separate collection, with its own decks, trade history, and saved card artwork. Share it with friends as viewers or editors.

## What you can do

- Browse your collection as a card gallery.
- Find exact card printings by name, set, and number.
- Import a collection from CSV or add cards one at a time.
- Build decks, with guidance on Pokémon, Trainers, and Energy.
- Reserve cards for other decks so you don't count the same copies twice.
- Record trades, export CSV files, and print collection or deck lists.

## Start a collection

Create a **Pocket Binder** grain in Sandstorm, then choose **Add card** or **Import CSV**.

For individual cards, search by name or enter a set and printed card number. Browse the matching printings, check the artwork, and choose how many copies to add. Cards without artwork can still be added.

For a larger collection, import a CSV like this:

```csv
name,set,card_number,quantity
Charizard,Base Set,4,2
Charmander,Base Set,46,4
Fire Energy,Base Set,98,20
```

Set names and common set codes are accepted. You can also use `card_id,quantity` if you already know the TCGdex IDs. See the [example CSV](examples/collection.csv).

Choose **Look up cards**, review the matches, and resolve any uncertain cards before importing. You can keep unidentified cards as unresolved.

**Check the import mode:** **Replace collection quantities** treats a regular CSV as your complete inventory. Choose **Add these copies** to add to what you already own. An import won't remove copies needed by a saved deck.

The first lookup asks you to connect the card database and artwork sources through Sandstorm. No API key is needed. Saved card details and downloaded artwork remain available offline; **Fetch missing faces** retries missing images.

## Build a deck

Create a deck and follow the steps for an attacker, supporting Pokémon, Trainers, Energy, and review. Choose **Browse all cards** whenever you want to explore beyond the suggestions.

Use **Hold back cards** to reserve copies for decks you want to keep assembled. Otherwise, decks can share cards as alternative builds.

The deck review helps with card counts, evolution lines, and consistency. It is intended for casual play and does **not** check tournament legality or every special card rule. **Allow draft additions** lets you experiment beyond the usual building limits while still respecting reserved copies.

## Manage and share

Open a card to change its quantity. **Remove mistaken copies** fixes inventory errors; **Archive trade** records outgoing cards with a trade note. Past trades stay in the **Trade archive** even after you no longer own the card.

Use the print button beside the collection or deck title for a printable list. CSV exports can be imported again later.

Sandstorm handles access and backups. Viewers can browse and export; editors can change the collection and decks. Grain backups include your collection, decks, trade history, and cached artwork.

## Development

The server uses Python's standard library and SQLite. The frontend has no runtime JavaScript dependencies.

With `spktool` and Lima installed, start the development environment:

```sh
spktool vm up
spktool dev
```

Open the URL printed by `spktool dev` and create a grain. This repository already has an app identity, so there is no need to run `spktool init`.

`spktool dev` runs the Python tests before starting. Run the standalone JavaScript tests with:

```sh
node tests/guide.test.cjs
node tests/lookup.test.cjs
```

Package configuration and runtime scripts live in [`.sandstorm/`](.sandstorm/). After configuration changes, run `spktool upgradevm`; after changing guest dependencies, run `spktool vm provision`.

To build a package, exercise the app in dev mode, then stop dev mode so the traced file list is saved:

```sh
spktool pack pocket-binder.spk
spktool verify pocket-binder.spk
```

Persistent data lives in `/var/pocket-binder/collection.sqlite3` inside the grain. The Python server relies on Sandstorm for authentication and should stay behind `sandstorm-http-bridge`.

## Credits and license

Pocket Binder is [MIT licensed](LICENSE). It uses the bundled [Oxanium font](https://fonts.google.com/specimen/Oxanium), licensed under the [SIL Open Font License](public/fonts/OFL-Oxanium.txt).

Card data and artwork come from [TCGdex](https://tcgdex.dev) and retain their respective rights; they are not covered by the app's MIT license.

This is an unofficial app, not affiliated with The Pokémon Company, Nintendo, Game Freak, or Creatures.
