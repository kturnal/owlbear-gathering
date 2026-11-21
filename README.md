# Gathering — an Owlbear Rodeo extension

A gathering attempt for mining, herbalism or fishing in one button: Gather rolls the d100 and the d4s
it earns, and shows the haul and the new skill to the whole table.

## Install

In Owlbear Rodeo, add it as a custom extension with this manifest URL, then enable it for the room:

```
https://kturnal.github.io/owlbear-gathering/manifest.json
```

The **Gathering** button then appears at the top left of the room.

## The rules

| d100 | Value |
|---|---|
| 1–20 | 1d4 |
| 21–40 | 2d4 |
| 41–60 | 3d4 |
| 61–80 | 4d4 |
| 81–100 | 5d4 |

- **Primary** (stone) = Value
- **Secondary** (ore) = Value ÷ 2, rounded up
- **Rare** (gems) = Value − 14, never below 0 — so only on a Value of 15 or more
- **Skill** rises by Value

Pressed Gather by mistake? **Undo** under your latest entry in *Recent gathers* removes it and takes
back the skill it added. Press it again to undo the one before.

## Changing the rules

Every number and name is in [`rules.json`](rules.json): the bands, the die sizes, each formula, and
the professions with their three material names. A new profession is one more entry in
`professions`. **The herbalism and fishing material names are placeholders** — replace them with the
DM's. Set `typeInCheck` to `true` to show a d100 box, for a d100 rolled in Owlbear's own dice tray;
left empty, Gather still rolls it.

A change goes live a minute or so after it is pushed to `main`, but browsers may keep the old copy
for up to 10 minutes (GitHub Pages' cache). `rules.json` is always re-checked. After changing
`app.js` or `style.css`, bump the `?v=` on them in `index.html`.

## Where the numbers are kept

Each player's skill and last five gathers sit in the **room's** metadata under that player's own key,
so they follow the room between sessions and everyone sees them. A copy stays in the browser as a
backup. The GM can correct anyone's skill from the party list; players edit only their own.

## Files

| | |
|---|---|
| `manifest.json` | What Owlbear reads to install the extension |
| `index.html`, `style.css`, `app.js` | The popover |
| `gathering.js` | The rules as pure functions |
| `rules.json` | The numbers |
| `gathering.test.mjs` | Tests: `node --test gathering.test.mjs` (also run by GitHub Actions) |
| `serve.mjs` | Local server for trying changes before pushing |

There is no build step: GitHub Pages serves this repository's `main` branch as it is.

## Try a change locally

```bash
node serve.mjs
```

Open <http://localhost:5173/owlbear-gathering/> for the page on its own (it keeps its numbers in the
browser), or add `http://localhost:5173/owlbear-gathering/manifest.json` as a custom extension in a
test room. That only works in your own browser.

The paths in `manifest.json` start with `/owlbear-gathering/` because that is where GitHub Pages
serves this repository. Hosting it elsewhere, or renaming the repository, means changing those three
paths to match.
