// Runs entirely in the extension's isolated content-script world -- unlike
// page-hook.js, this feature needs no page-context injection and never
// touches window.fetch. It calls Archidekt's own /api/decks/<id>/cards/
// endpoint directly (an ordinary same-origin fetch, which carries the
// viewer's session cookies automatically) to read each deck card's
// Scryfall Oracle tags, which Archidekt already computes and attaches to
// every card object it serves. Adds a "Oracle tags in this deck" section
// to the deck view, letting the user pick a tag and see which cards in the
// deck carry it.
(() => {
  const MARKER_ATTR = "data-archidekt-otag-browser";
  const DECK_ID_RE = /^\/decks\/(\d+)/;

  let currentDeckId = null;
  let deckCards = null;
  let tagIndex = null; // Map<tag, Array<{name, quantity, categories}>>
  let loadError = null;
  let selectedTag = null;
  let panelEl = null;

  function getDeckIdFromLocation() {
    const match = DECK_ID_RE.exec(location.pathname);
    return match ? match[1] : null;
  }

  async function fetchDeckCards(deckId) {
    const res = await fetch(`/api/decks/${deckId}/cards/`);
    if (!res.ok) throw new Error(`unexpected status ${res.status}`);
    return res.json();
  }

  // oTags are tags directly assigned to a card; inheritedTags are additional
  // tags it inherits via Scryfall's tag parent/child hierarchy. Both are
  // already human-readable labels. We merge them into one flat set rather
  // than showing two separate lists -- simplest useful version, and this is
  // about finding cards, not teaching the tag taxonomy.
  function buildTagIndex(cards) {
    const index = new Map();
    for (const entry of cards) {
      const oracleCard = entry.card && entry.card.oracleCard;
      if (!oracleCard) continue;
      const tags = new Set([...(oracleCard.oTags || []), ...(oracleCard.inheritedTags || [])]);
      const cardInfo = {
        name: oracleCard.name,
        quantity: entry.quantity,
        categories: entry.categories || [],
      };
      for (const tag of tags) {
        if (!index.has(tag)) index.set(tag, []);
        index.get(tag).push(cardInfo);
      }
    }
    return index;
  }

  async function refreshDeckTags(deckId) {
    loadError = null;
    renderPanel();
    try {
      deckCards = await fetchDeckCards(deckId);
      tagIndex = buildTagIndex(deckCards);
    } catch (err) {
      console.error("[archidekt-deck-tags] failed to load deck cards", err);
      loadError = err;
      tagIndex = null;
    }
    renderPanel();
  }

  function renderCardList(container, cards) {
    container.innerHTML = "";
    const sorted = [...cards].sort((a, b) => a.name.localeCompare(b.name));
    for (const card of sorted) {
      const row = document.createElement("div");
      const categoryText = card.categories.length ? card.categories.join(", ") : "no category";
      row.textContent = `${card.quantity}x ${card.name} — ${categoryText}`;
      row.style.cssText = "padding:2px 0;";
      container.appendChild(row);
    }
  }

  function renderTagList(listEl, cardListEl) {
    listEl.innerHTML = "";
    if (!tagIndex) return;
    const tags = [...tagIndex.keys()].sort((a, b) => {
      const diff = tagIndex.get(b).length - tagIndex.get(a).length;
      return diff !== 0 ? diff : a.localeCompare(b);
    });
    for (const tag of tags) {
      const cards = tagIndex.get(tag);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = `${tag} (${cards.length})`;
      btn.style.cssText =
        "text-align:left;padding:3px 6px;border:1px solid transparent;background:none;cursor:pointer;" +
        (tag === selectedTag ? "font-weight:600;border-color:currentColor;" : "");
      btn.addEventListener("click", () => {
        selectedTag = selectedTag === tag ? null : tag;
        renderTagList(listEl, cardListEl);
        if (selectedTag) {
          cardListEl.style.display = "";
          renderCardList(cardListEl, tagIndex.get(selectedTag));
        } else {
          cardListEl.style.display = "none";
          cardListEl.innerHTML = "";
        }
      });
      listEl.appendChild(btn);
    }
  }

  function buildTagPanel() {
    const wrap = document.createElement("div");
    wrap.setAttribute(MARKER_ATTR, "true");
    wrap.style.cssText =
      "margin:8px 0;padding:8px 10px;border:1px dashed currentColor;border-radius:4px;" +
      "opacity:0.92;font-size:13px;max-width:100%;box-sizing:border-box;";

    const headerRow = document.createElement("div");
    headerRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;";

    const title = document.createElement("div");
    title.textContent = "Oracle tags in this deck";
    title.style.cssText = "font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;opacity:0.7;";
    headerRow.appendChild(title);

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.textContent = "Refresh";
    refreshBtn.style.cssText = "flex-shrink:0;padding:2px 8px;";
    refreshBtn.addEventListener("click", () => {
      if (currentDeckId) refreshDeckTags(currentDeckId);
    });
    headerRow.appendChild(refreshBtn);

    wrap.appendChild(headerRow);

    const body = document.createElement("div");
    body.style.cssText = "margin-top:6px;";

    if (loadError) {
      const errEl = document.createElement("div");
      errEl.textContent = "Couldn't load tags for this deck.";
      errEl.style.cssText = "font-size:11px;opacity:0.65;";
      body.appendChild(errEl);
    } else if (!tagIndex) {
      const loadingEl = document.createElement("div");
      loadingEl.textContent = "Loading tags…";
      loadingEl.style.cssText = "font-size:11px;opacity:0.65;";
      body.appendChild(loadingEl);
    } else if (tagIndex.size === 0) {
      const emptyEl = document.createElement("div");
      emptyEl.textContent = "No tagged cards found in this deck.";
      emptyEl.style.cssText = "font-size:11px;opacity:0.65;";
      body.appendChild(emptyEl);
    } else {
      const listEl = document.createElement("div");
      listEl.style.cssText = "display:flex;flex-direction:column;max-height:220px;overflow-y:auto;";

      const cardListEl = document.createElement("div");
      cardListEl.style.cssText =
        "margin-top:6px;padding-top:6px;border-top:1px solid currentColor;opacity:0.85;" +
        "max-height:220px;overflow-y:auto;display:none;";

      renderTagList(listEl, cardListEl);

      body.appendChild(listEl);
      body.appendChild(cardListEl);
    }

    wrap.appendChild(body);
    return wrap;
  }

  function renderPanel() {
    if (!panelEl || !panelEl.isConnected) return;
    const fresh = buildTagPanel();
    panelEl.replaceWith(fresh);
    panelEl = fresh;
  }

  // Matches on visible text rather than any class name, consistent with
  // content.js's approach to Archidekt's frequently-reshuffled
  // hashed/CSS-module class names.
  function findDeckHeaderAnchor() {
    const els = document.querySelectorAll("*");
    for (const el of els) {
      if (el.children.length === 0 && (el.textContent || "").trim() === "Add card") {
        // "Add card" labels the filter/toolbar row (Add card | View as |
        // Group by | Sort by | Local filter) above the card grid, in the
        // page's normal document flow. Its grandparent is that whole row
        // -- the anchor we want. (Deliberately not anchoring near "Est
        // cost:" in the deck-info sidebar: that sidebar is
        // `position: fixed`, which made inserted content behave
        // unpredictably regardless of its own width.)
        return el.parentElement && el.parentElement.parentElement;
      }
    }
    return null;
  }

  function removeExistingPanel() {
    const existing = document.querySelector(`[${MARKER_ATTR}]`);
    if (existing) existing.remove();
    panelEl = null;
  }

  // The filter bar hydrates asynchronously, so the "Add card" anchor may
  // not exist in the DOM yet on the first few attempts. Keep retrying
  // (driven by the MutationObserver below, which fires on every DOM
  // mutation) without setting the marker attribute -- and therefore without
  // committing to the fixed-position fallback -- until either the anchor
  // shows up or ANCHOR_TIMEOUT_MS has passed since we started looking for
  // this deck.
  const ANCHOR_TIMEOUT_MS = 5000;
  let anchorSearchStartedAt = null;

  function tryInject() {
    if (document.querySelector(`[${MARKER_ATTR}]`)) return;
    const anchor = findDeckHeaderAnchor();
    if (!anchor && Date.now() - anchorSearchStartedAt < ANCHOR_TIMEOUT_MS) return;
    panelEl = buildTagPanel();
    if (anchor) {
      anchor.insertAdjacentElement("afterend", panelEl);
    } else {
      panelEl.style.position = "fixed";
      panelEl.style.bottom = "12px";
      panelEl.style.right = "12px";
      panelEl.style.background = "Canvas";
      panelEl.style.zIndex = "2147483647";
      document.body.appendChild(panelEl);
    }
  }

  function checkDeckIdChanged() {
    const deckId = getDeckIdFromLocation();
    if (deckId === currentDeckId) return;
    currentDeckId = deckId;
    selectedTag = null;
    deckCards = null;
    tagIndex = null;
    loadError = null;
    anchorSearchStartedAt = Date.now();
    removeExistingPanel();
    if (deckId) {
      tryInject();
      refreshDeckTags(deckId);
    }
  }

  const observer = new MutationObserver(() => {
    if (currentDeckId && !document.querySelector(`[${MARKER_ATTR}]`)) tryInject();
  });

  function start() {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    checkDeckIdChanged();
    setInterval(checkDeckIdChanged, 500);
  }

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener("DOMContentLoaded", start);
  }
})();
