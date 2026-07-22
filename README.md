# Archidekt Plus (Firefox extension)

Adds two things to Archidekt's in-deck "Card search" panel (the "Archidekt
search" tab, under **Filter & Sort**), which natively supports neither:

- **Oracle tag search** — a searchable field backed by the ~5,300 tags
  documented at [scryfall.com/docs/tagger-tags](https://scryfall.com/docs/tagger-tags)
  (the `otag:`/`function:` operator).
- **Sort by release date** — oldest-first or newest-first.

## How it works

Archidekt's deck-builder search box has two modes, both discovered by
watching the network tab while using the site:

- **"Archidekt search"** (the default, friendly-filter tab) calls
  `GET /api/cards/v2/?name=...&colors=...&rarity=...&orderBy=...&page=...`.
  This endpoint has no tag-search parameter at all, and its `orderBy`
  whitelist doesn't include a release-date option.
- **"Syntax search"** (a second tab, raw text query) calls
  `GET /api/cards/scryfall/?search=<scryfall-syntax-query>&page=...&includeExtras=1`.
  This one forwards directly to Scryfall's own query syntax and *does*
  support `otag:` and `order:released direction:asc|desc` — that's also
  exactly what powers the public `archidekt.com/search/cards` page.

Rather than trying to bolt new fields onto Archidekt's own React-managed
"Archidekt search" form (fragile — it's a controlled component with hashed
class names that can change on any deploy), the extension:

1. Injects small "Oracle tag" and "Sort by" controls directly beneath the
   native Filter & Sort panel (found by matching visible text — the "Sort
   by:" label plus a submit button — not by CSS class, so it keeps working
   across Archidekt redeploys).
2. Patches `window.fetch` in the page's own JS context so that when the
   user clicks the native **Search** button, any outgoing call to
   `/api/cards/v2/` that matches the search-results shape gets rewritten
   into an equivalent `/api/cards/scryfall/?search=...` call with the
   typed name, plus `otag:"<tag>"` and/or `order:released direction:...`
   appended, if either extension control is set.
3. Returns that response in place of the original — since both endpoints
   return the same `{count, next, results: [...]}` shape, the app's own
   React state update runs exactly as it would have otherwise, so the
   results just render normally.
4. When neither control is set, every request passes through untouched —
   this is purely opt-in and never changes default behavior.

Color and rarity filters are preserved on a best-effort basis: they're only
translated into the rebuilt query (as `id<=...` / `(rarity:x or rarity:y)`
clauses) when the user has actually narrowed them from "all selected" —
Archidekt's UI always sends the full list when nothing's been narrowed, so
there's nothing meaningful to translate in the common case.

## Installing (temporary, for development)

Firefox only loads unsigned extensions temporarily (until restart):

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Select `manifest.json` in this folder.
4. Go to any Archidekt deck (or [archidekt.com/sandbox](https://archidekt.com/sandbox)),
   open **Add card → Card search**, expand **Filter & Sort**, and the two
   new controls will appear right below it.

## Known limitations

- One oracle tag at a time (no multi-tag OR search yet).
- The oracle-tag field is a native HTML `<datalist>` — it suggests from the
  bundled list but doesn't hard-block free text, so typos won't be caught
  client-side (Archidekt/Scryfall will just return 0 results).
- `data/otags.json` is a point-in-time scrape of Scryfall's tag list; new
  tags added to Tagger after this scrape won't appear as suggestions (but
  can still be typed manually and will work, since the query is just text).
- Verified against the endpoints as of 2026-07-22; Archidekt is a fast-moving
  Next.js app, so if `/api/cards/v2/`'s param names or the Filter & Sort
  panel's visible label text change, the interception/injection may need
  updating.

## Changelog

- **0.1.1** — Fixed the extension controls having no effect on search
  results. The controls were relaying their values from `content.js`
  (isolated world) to `page-hook.js` (page world) via a `CustomEvent`, but
  Firefox's Xray vision makes an event `detail` object dispatched from a
  content script effectively unreadable on the page side without
  `cloneInto()`, which wasn't being used — so the fetch patch never saw
  otag/sort changes. Fixed by having `page-hook.js` read the controls'
  values directly off the DOM (`document.getElementById(...).value`) at
  request time instead, since that's a platform property with no such
  restriction.
- **0.1.0** — Initial version.
