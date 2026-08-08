/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Compose script of the harness: describes the body of the message being composed without
 * touching it. Derived from spike/dump.js, whose capture format it keeps.
 *
 * Injected by scripting.executeScript: the value of the last expression of the file is
 * returned to the caller, and a promise is awaited.
 */

(async () => {
  const describe = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent.trim();
      return text ? `#text "${text.slice(0, 60)}"` : "#text (empty)";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return `nodeType=${node.nodeType}`;
    }
    const attributes = [...node.attributes]
      .map((a) => `${a.name}="${a.value.slice(0, 60)}"`)
      .join(" ");
    const text = node.textContent.trim().slice(0, 60);
    return `<${node.tagName.toLowerCase()}${attributes ? " " + attributes : ""}> "${text}"`;
  };

  const selection = () => {
    const sel = window.getSelection();
    if (!sel) return null;
    return {
      rangeCount: sel.rangeCount,
      isCollapsed: sel.isCollapsed,
      text: sel.toString().slice(0, 200),
      anchorNode: sel.anchorNode ? describe(sel.anchorNode) : null,
      anchorOffset: sel.anchorOffset,
      focusNode: sel.focusNode ? describe(sel.focusNode) : null,
      focusOffset: sel.focusOffset,
    };
  };

  const capture = () => ({
    readyState: document.readyState,
    textLength: document.body.textContent.trim().length,
    children: [...document.body.childNodes].map(describe),
    selection: selection(),
    presence: {
      citePrefix: document.querySelectorAll(".moz-cite-prefix").length,
      blockquoteCite: document.querySelectorAll('blockquote[type="cite"]').length,
      signature: document.querySelectorAll(".moz-signature").length,
      forwardContainer: document.querySelectorAll(".moz-forward-container").length,
      preWrap: document.querySelectorAll("pre").length,
    },
    innerHTML: document.body.innerHTML,
  });

  if (document.readyState !== "complete") {
    await new Promise((resolve) =>
      window.addEventListener("load", resolve, { once: true }),
    );
  }

  /* Two captures spaced apart: the spike concluded that the DOM was stable from injection
   * time, the second capture is there to confirm it on the cases still unexplored. If both
   * innerHTML differ, a MutationObserver will be needed in the extension. */
  const immediate = capture();
  await new Promise((resolve) => setTimeout(resolve, 400));
  const delayed = capture();

  return {
    immediate,
    delayed,
    stable: immediate.innerHTML === delayed.innerHTML,
  };
})();
