/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Analysis and rearrangement of the body of a message being composed.
 *
 * Pure functions in the sense that matters here: they take a document and never call
 * browser.*. They can therefore be tested under jsdom, against the fixtures captured in
 * Thunderbird by test/integration/. That is where the regression risk lies, the composer
 * DOM not being a stable API.
 *
 * The file is injected before compose-script.js and exposes its API on `Layout`.
 */

var Layout = (() => {
  const ELEMENT = 1;
  const TEXT = 3;
  const COMMENT = 8;

  const isElement = (node) => node?.nodeType === ELEMENT;

  const hasClass = (node, className) =>
    isElement(node) && node.classList.contains(className);

  /* A line break between two nodes, or a comment, belongs to nobody: neither to the quote
   * nor to the writing area. Non-empty text, on the other hand, is already something the
   * user typed and counts as writing area. */
  const isNeutral = (node) =>
    node?.nodeType === COMMENT ||
    (node?.nodeType === TEXT && node.textContent.trim() === "");

  /* Bounds of the quote block among the direct children of body.
   *
   * Three shapes captured in TB 153: `.moz-forward-container` alone for a forward;
   * `.moz-cite-prefix` followed by `blockquote[type="cite"]` in HTML; `.moz-cite-prefix`
   * followed by a `span` in plain text. That span carries `_moz_quote="true"`, but the
   * attribute does not show up in innerHTML: the usable marker is adjacency to the
   * prefix. */
  const quoteBounds = (children) => {
    const forward = children.findIndex((n) => hasClass(n, "moz-forward-container"));
    if (forward !== -1) {
      return { start: forward, end: forward };
    }

    const prefix = children.findIndex((n) => hasClass(n, "moz-cite-prefix"));
    if (prefix !== -1) {
      const next = children[prefix + 1];
      return { start: prefix, end: isElement(next) ? prefix + 1 : prefix };
    }

    const quote = children.findIndex(
      (n) => isElement(n) && n.matches('blockquote[type="cite"]'),
    );
    return quote === -1 ? null : { start: quote, end: quote };
  };

  /* Who the signature belongs to: the writing block, or the bottom of the message.
   *
   * Adjacency is not enough to decide. As soon as the writing area sits below the quote,
   * the body reads [prefix, quote, writing area, signature] whether the signature follows
   * the writing area (sig_bottom false) or closes the message (sig_bottom true): both
   * settings produce exactly the same DOM, and sig_bottom is not readable by an extension.
   * So a conclusion is drawn only when the body is unambiguous, and "unknown" is returned
   * the rest of the time. It is then up to the caller to supply the anchor captured when
   * the composer opened, or the user's setting. */
  const signatureAnchorOf = (signature, quote, position) => {
    if (signature === null) return null;
    if (!quote) return "unknown";
    if (signature < quote.start) {
      return position === "below" ? "unknown" : "reply";
    }
    return position === "above" ? "bottom" : "unknown";
  };

  /* Describes the body without modifying it. `position` is "absent" when there is no
   * writing area at all, which is the case of the "select the quote" mode: two children
   * only, and the quote entirely selected. */
  const analyze = (document) => {
    const body = document.body;
    const children = [...body.childNodes];
    const quote = quoteBounds(children);

    const signature = children.findIndex((n) => hasClass(n, "moz-signature"));
    const signatureLast =
      signature !== -1 &&
      children.slice(signature + 1).every((n) => isNeutral(n));

    const writingArea = children
      .map((node, index) => ({ node, index }))
      .filter(
        ({ node, index }) =>
          !isNeutral(node) &&
          index !== signature &&
          (!quote || index < quote.start || index > quote.end),
      );

    let position = "absent";
    if (writingArea.length) {
      position = !quote || writingArea[0].index < quote.start ? "above" : "below";
    }

    const signatureIndex = signature === -1 ? null : signature;

    return {
      quote,
      signature: signatureIndex,
      signatureLast,
      signatureAnchor: signatureAnchorOf(signatureIndex, quote, position),
      writingArea: writingArea.map(({ index }) => index),
      position,
      children,
    };
  };

  const CERTAIN = ["reply", "bottom"];

  /* What the body shows right now if it is unambiguous, otherwise what it showed when the
   * composer opened, otherwise the setting. The setting therefore only decides for
   * composers opened with the writing area below the quote, the only ones whose anchor was
   * never observable. */
  const resolveAnchor = (current, original, setting) => {
    if (CERTAIN.includes(current)) return current;
    if (CERTAIN.includes(original)) return original;
    return setting === "bottom" ? "bottom" : "reply";
  };

  const quoteNodes = (analysis) =>
    analysis.children.slice(analysis.quote.start, analysis.quote.end + 1);

  /* Rearranges by moving the quote block, never the writing area: it is the only group
   * whose bounds are certain. Everything else keeps its relative order, which gives the
   * right result for both signature placements without having to read `sig_bottom`.
   *
   * `anchor` says who the signature belongs to, the node order not always being enough to
   * tell: "bottom" for a signature that closes the message, "reply" for a signature that
   * goes along with the reply text. */
  const moveQuote = (document, analysis, target, anchor) => {
    const body = document.body;
    const block = quoteNodes(analysis);

    if (target === "below") {
      body.insertBefore(
        block.reduce((fragment, node) => {
          fragment.appendChild(node);
          return fragment;
        }, document.createDocumentFragment()),
        body.firstChild,
      );
      return;
    }

    const remainingChildren = [...body.childNodes];
    const signature = remainingChildren.findIndex((n) => hasClass(n, "moz-signature"));

    /* Signature closing the message: the quote slips in before it. Signature belonging to
     * the writing block: the quote goes after it, but before whatever follows. In plain
     * text a leftover <br> trails after the signature, and Thunderbird leaves it behind
     * the quote too. */
    let anchorNode = null;
    if (signature !== -1) {
      anchorNode =
        anchor === "bottom"
          ? remainingChildren[signature]
          : (remainingChildren[signature + 1] ?? null);
    }

    for (const node of block) {
      body.insertBefore(node, anchorNode);
    }
  };

  /* Creates a writing area when there is none, the case of the "select the quote" mode. In
   * HTML Thunderbird uses a `<p><br></p>`; in plain text, a bare `<br>`, the body being in
   * white-space: pre-wrap. */
  const createWritingArea = (document, plainText) => {
    if (plainText) {
      return document.createElement("br");
    }
    const paragraph = document.createElement("p");
    paragraph.appendChild(document.createElement("br"));
    return paragraph;
  };

  /* Places the cursor in the writing area and collapses the selection.
   *
   * Collapsing is essential in the "select the quote" mode: the selection covers the whole
   * body there, and the first keystroke would wipe out the quote that the move has just
   * arranged.
   *
   * In HTML the cursor goes into the writing paragraph, as Thunderbird does. In plain text
   * there is no node to enter: the captures show an anchor on `body` with an index offset,
   * which is what is reproduced here. */
  const placeCursor = (document, index) => {
    const body = document.body;
    const target = body.childNodes[index];
    const selection = document.defaultView.getSelection();
    if (!selection) return null;

    selection.removeAllRanges();
    const range = document.createRange();

    if (isElement(target) && target.tagName === "P") {
      range.setStart(target, 0);
    } else {
      range.setStart(body, Math.min(index, body.childNodes.length));
    }
    range.collapse(true);
    selection.addRange(range);

    if (typeof target?.scrollIntoView === "function") {
      target.scrollIntoView({ block: "nearest" });
    }
    return range;
  };

  /* Brings the body to the wanted position. Returns what was done, so that the caller can
   * log it and the popup can display the real state.
   *
   * `anchor` is the `signatureAnchor` captured when the composer opened, before any
   * modification: it is what makes it possible to give the signature back to the writing
   * block after a first swap, which left the body ambiguous. `signature` is the user
   * setting, the last resort when nothing was ever observable. */
  const apply = (
    document,
    target,
    { plainText = false, anchor = null, signature = "reply" } = {},
  ) => {
    const before = analyze(document);

    if (target !== "above" && target !== "below") {
      return { changed: false, before: before.position, after: before.position, reason: "target" };
    }
    if (!before.quote) {
      /* Reply to a message with no quote: there is nothing to rearrange. */
      return { changed: false, before: before.position, after: before.position, reason: "no-quote" };
    }
    if (before.position === target) {
      return { changed: false, before: before.position, after: before.position, reason: "already" };
    }

    const chosenAnchor = resolveAnchor(before.signatureAnchor, anchor, signature);

    if (before.position !== "absent") {
      moveQuote(document, before, target, chosenAnchor);
    }

    /* After the move, the writing area is whatever borders the quote on the right side.
     * When it does not exist, it is created: that is the "select the quote" mode, where
     * the recipient rule wins over the identity setting. */
    const after = analyze(document);
    let index;
    if (after.position === "absent") {
      const writingArea = createWritingArea(document, plainText);
      if (target === "above") {
        document.body.insertBefore(writingArea, document.body.firstChild);
        index = 0;
      } else {
        const next = document.body.childNodes[after.quote.end + 1] ?? null;
        document.body.insertBefore(writingArea, next);
        index = after.quote.end + 1;
      }
    } else {
      index = target === "above" ? after.writingArea[0] : after.quote.end + 1;
    }

    placeCursor(document, index);

    return {
      changed: true,
      before: before.position,
      after: analyze(document).position,
      anchor: chosenAnchor,
      /* Where the cursor belongs, so that a caller which replays the rearrangement through
       * the editor can put it back without deciding anything itself. See compose-script.js. */
      cursorIndex: index,
      reason: null,
    };
  };

  return {
    analyze,
    apply,
    placeCursor,
    createWritingArea,
  };
})();
