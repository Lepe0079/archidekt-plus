// Runs in the PAGE's own JS context (injected via <script src> by content.js),
// not the extension's isolated content-script world. This is required because
// we need to patch the exact `window.fetch` that Archidekt's own React/Next.js
// bundle calls -- a content script's `window` is a separate object in Firefox,
// so patching fetch there would never see the page's real requests.
(() => {
  if (window.__archidektSearchPlusHooked) return;
  window.__archidektSearchPlusHooked = true;

  const OTAG_INPUT_ID = "archidekt-search-plus-otag-input";
  const SORT_SELECT_ID = "archidekt-search-plus-sort-select";

  // Read the extension's controls straight off the DOM at request time,
  // rather than content.js pushing state over via a CustomEvent -- Firefox's
  // Xray vision makes an event `detail` object dispatched from an isolated
  // content script effectively unreadable here without extra ceremony
  // (`cloneInto`), whereas a plain DOM element's `.value` is a platform IDL
  // property with no such restriction, since content.js and this script
  // share the one real DOM even though their JS globals don't.
  function readState() {
    const otagEl = document.getElementById(OTAG_INPUT_ID);
    const sortEl = document.getElementById(SORT_SELECT_ID);
    return {
      otag: otagEl ? otagEl.value.trim() : "",
      sortReleaseDirection: sortEl ? sortEl.value : "",
    };
  }

  const originalFetch = window.fetch.bind(window);

  // Archidekt's "colors"/"rarity" params on /api/cards/v2/ default to *all*
  // values when the user hasn't narrowed anything -- so we only translate them
  // into Scryfall syntax clauses when they're a genuine subset (an intentional
  // filter), otherwise we'd needlessly constrain the rebuilt query.
  const ALL_COLORS = ["White", "Blue", "Black", "Red", "Green"];
  const COLOR_CODES = { White: "w", Blue: "u", Black: "b", Red: "r", Green: "g" };
  const ALL_RARITIES = ["common", "uncommon", "rare", "mythic", "special"];

  function buildScryfallSearch(originalUrl, state) {
    const name = originalUrl.searchParams.get("name") || "";
    const colorsParam = originalUrl.searchParams.get("colors");
    const rarityParam = originalUrl.searchParams.get("rarity");

    const clauses = [];
    if (name) clauses.push(name);
    if (state.otag) clauses.push(`otag:"${state.otag.replace(/"/g, "")}"`);

    if (colorsParam) {
      const chosen = colorsParam.split(",").filter(Boolean);
      if (chosen.length && chosen.length < ALL_COLORS.length) {
        const codes = chosen.map((c) => COLOR_CODES[c]).filter(Boolean).join("");
        if (codes) clauses.push(`id<=${codes}`);
      }
    }

    if (rarityParam) {
      const chosen = rarityParam.split(",").filter(Boolean);
      if (chosen.length && chosen.length < ALL_RARITIES.length) {
        clauses.push("(" + chosen.map((r) => `rarity:${r}`).join(" or ") + ")");
      }
    }

    // Archidekt's own "Syntax search" tab always appends this for the default
    // game filter, so we match that behavior for consistency.
    clauses.push("game:paper");

    if (state.sortReleaseDirection) {
      clauses.push("order:released");
      clauses.push(`direction:${state.sortReleaseDirection}`);
    }

    return clauses.join(" ");
  }

  window.fetch = function (input, init) {
    try {
      const urlStr = typeof input === "string" ? input : input && input.url;
      const state = readState();
      if (urlStr && (state.otag || state.sortReleaseDirection)) {
        const url = new URL(urlStr, window.location.origin);
        // Only the deck-builder's live card-search-results call looks like
        // this (has orderBy + is not the bulk oracleCardIds lookup used to
        // render cards already in the deck, nor the small nameSearch
        // autocomplete call).
        if (
          url.pathname === "/api/cards/v2/" &&
          url.searchParams.has("orderBy") &&
          !url.searchParams.has("oracleCardIds")
        ) {
          const page = url.searchParams.get("page") || "1";
          const search = buildScryfallSearch(url, state);
          const newUrl = `${window.location.origin}/api/cards/scryfall/?search=${encodeURIComponent(
            search
          )}&page=${page}&includeExtras=1`;
          return originalFetch(newUrl, init);
        }
      }
    } catch (err) {
      console.error("[archidekt-search-plus] fetch hook failed, falling back to the original request", err);
    }
    return originalFetch(input, init);
  };
})();
