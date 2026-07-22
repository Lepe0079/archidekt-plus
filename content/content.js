// Runs in the extension's isolated content-script world. Responsible for:
//   1. Injecting page-hook.js into the page's own JS context ASAP so it can
//      patch window.fetch before Archidekt's bundle starts issuing requests.
//   2. Building the "Oracle tag" + "Sort by release date" controls and
//      docking them beneath the deck-builder's native "Filter & Sort" panel.
//
// page-hook.js reads these controls' values directly off the DOM (by fixed
// element id) at request time rather than receiving them via a CustomEvent.
// An earlier version relayed state through `document.dispatchEvent(new
// CustomEvent(..., {detail}))`, but in Firefox a content script's `detail`
// object is subject to Xray vision when read from the page's own (unprivileged)
// listener -- it needs `cloneInto()` to be usable there, which that version
// didn't do, so the page-side hook silently never saw otag/sort changes.
// Reading plain DOM element properties (`.value`) has no such restriction,
// since it's a platform IDL property, not a JS object handed across the
// isolated/page world boundary -- so that's what both sides rely on instead.
(() => {
  const MARKER_ATTR = "data-archidekt-search-plus";
  const OTAG_INPUT_ID = "archidekt-search-plus-otag-input";
  const SORT_SELECT_ID = "archidekt-search-plus-sort-select";

  function injectPageHook() {
    const script = document.createElement("script");
    script.src = browser.runtime.getURL("content/page-hook.js");
    script.addEventListener("load", () => script.remove());
    (document.head || document.documentElement).appendChild(script);
  }
  injectPageHook();

  let otagList = [];
  fetch(browser.runtime.getURL("data/otags.json"))
    .then((r) => r.json())
    .then((list) => {
      otagList = list;
    })
    .catch((err) => console.error("[archidekt-search-plus] failed to load otags.json", err));

  const DATALIST_ID = "archidekt-search-plus-otag-list";

  function buildPanel() {
    const wrap = document.createElement("div");
    wrap.setAttribute(MARKER_ATTR, "true");
    wrap.style.cssText =
      "margin:8px 0;padding:8px 10px;border:1px dashed currentColor;border-radius:4px;" +
      "opacity:0.92;font-size:13px;display:flex;flex-direction:column;gap:8px;max-width:480px;";

    const title = document.createElement("div");
    title.textContent = "Search+ extension";
    title.style.cssText = "font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:0.04em;opacity:0.7;";
    wrap.appendChild(title);

    // --- Oracle tag row ---
    const tagRow = document.createElement("label");
    tagRow.style.cssText = "display:flex;align-items:center;gap:6px;";

    const tagLabelText = document.createElement("span");
    tagLabelText.textContent = "Oracle tag:";
    tagLabelText.style.cssText = "min-width:90px;flex-shrink:0;";

    const tagInput = document.createElement("input");
    tagInput.id = OTAG_INPUT_ID;
    tagInput.type = "text";
    tagInput.placeholder = "e.g. ramp, wheel, extra-combat...";
    tagInput.setAttribute("list", DATALIST_ID);
    tagInput.setAttribute("autocomplete", "off");
    tagInput.style.cssText = "flex:1;min-width:0;padding:4px 6px;";

    const clearTagBtn = document.createElement("button");
    clearTagBtn.type = "button";
    clearTagBtn.textContent = "×";
    clearTagBtn.title = "Clear oracle tag filter";
    clearTagBtn.style.cssText = "flex-shrink:0;padding:2px 9px;";
    clearTagBtn.addEventListener("click", () => {
      tagInput.value = "";
    });

    tagRow.appendChild(tagLabelText);
    tagRow.appendChild(tagInput);
    tagRow.appendChild(clearTagBtn);
    wrap.appendChild(tagRow);

    const datalist = document.createElement("datalist");
    datalist.id = DATALIST_ID;
    wrap.appendChild(datalist);

    const fillDatalist = () => {
      if (!otagList.length) {
        setTimeout(fillDatalist, 100);
        return;
      }
      const frag = document.createDocumentFragment();
      for (const tag of otagList) {
        const opt = document.createElement("option");
        opt.value = tag;
        frag.appendChild(opt);
      }
      datalist.appendChild(frag);
    };
    fillDatalist();

    const tagHint = document.createElement("div");
    tagHint.textContent = `Pick from ${otagList.length || "5,298"} known Scryfall Oracle tags, or type your own.`;
    tagHint.style.cssText = "font-size:11px;opacity:0.65;margin-top:-4px;";
    wrap.appendChild(tagHint);

    // --- Release date sort row ---
    const sortRow = document.createElement("label");
    sortRow.style.cssText = "display:flex;align-items:center;gap:6px;";

    const sortLabelText = document.createElement("span");
    sortLabelText.textContent = "Sort by:";
    sortLabelText.style.cssText = "min-width:90px;flex-shrink:0;";

    const sortSelect = document.createElement("select");
    sortSelect.id = SORT_SELECT_ID;
    sortSelect.style.cssText = "flex:1;padding:4px 6px;";
    const options = [
      ["", "(use native Sort by above)"],
      ["asc", "Release date — oldest first"],
      ["desc", "Release date — newest first"],
    ];
    for (const [value, label] of options) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      sortSelect.appendChild(opt);
    }

    sortRow.appendChild(sortLabelText);
    sortRow.appendChild(sortSelect);
    wrap.appendChild(sortRow);

    return wrap;
  }

  // The native "Filter & Sort" panel is a <form> containing a "Sort by:"
  // label (with the colon -- the deck's own unrelated "Sort by" grouping
  // control has no colon) alongside a submit button. Matching on visible
  // text rather than class names keeps this resilient to Archidekt's
  // (hashed/CSS-module) class names changing across deploys.
  function findFilterSortForm() {
    const forms = document.querySelectorAll("form");
    for (const form of forms) {
      const text = form.textContent || "";
      if (text.includes("Sort by:") && form.querySelector('button[type="submit"]')) {
        return form;
      }
    }
    return null;
  }

  function tryInject() {
    const form = findFilterSortForm();
    if (!form) return;
    const next = form.nextElementSibling;
    if (next && next.hasAttribute(MARKER_ATTR)) return; // already injected for this form
    form.insertAdjacentElement("afterend", buildPanel());
  }

  const observer = new MutationObserver(() => tryInject());
  const startObserving = () => {
    observer.observe(document.documentElement, { childList: true, subtree: true });
    tryInject();
  };

  if (document.documentElement) {
    startObserving();
  } else {
    document.addEventListener("DOMContentLoaded", startObserving);
  }
})();
