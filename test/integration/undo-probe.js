/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* What Ctrl+Z does to a composer whose nodes were moved by script.
 *
 * The switch of the extension cannot be driven from here: it goes through tabs.sendMessage
 * towards another extension. What is reproduced instead is the mechanism under it, on the
 * composer Thunderbird just opened: type, move the quote, undo once. Two ways of moving:
 *
 *   dom     straight DOM calls. Not recorded by the editor, so a Ctrl+Z eats the typed text
 *           and leaves the quote where it was put. That is the reported bug, kept here as a
 *           witness: the day Gecko records these, this case turns green and compose-script.js
 *           can go back to something simpler.
 *   replay  what compose-script.js does: arrange the DOM, rewind, and let the editor put the
 *           rearranged body back with selectAll + insertHTML, which is one transaction.
 *
 * Also counts the internal attributes Thunderbird sets but never serializes: going through
 * innerHTML drops them, and only the MIME check can say whether that changes the message.
 *
 * Injected by scripting.executeScript: the value of the last expression is returned.
 */

(async () => {
  const MARKER = "TYPED-BY-THE-HARNESS";
  const pristine = document.body.innerHTML;

  const order = () =>
    [...document.body.children]
      .map((n) => (n.className ? `.${n.className.split(" ")[0]}` : n.tagName.toLowerCase()))
      .join(" · ");

  const internalAttributes = () =>
    [...document.body.querySelectorAll("*")].filter(
      (n) => n.hasAttribute("_moz_quote") || n.hasAttribute("_moz_dirty"),
    ).length;

  const state = () => ({
    order: order(),
    text: document.body.textContent.includes(MARKER),
    internals: internalAttributes(),
  });

  const caretInto = (node, offset = 0) => {
    const selection = window.getSelection();
    selection.removeAllRanges();
    const range = document.createRange();
    range.setStart(node, offset);
    range.collapse(true);
    selection.addRange(range);
  };

  /* Types the way a person would: through the editor, so it records a transaction. In plain
   * text there is no paragraph to enter, the writing area being bare <br> nodes. */
  const type = () => {
    const paragraph = [...document.body.children].find((n) => n.tagName === "P" && !n.className);
    caretInto(paragraph ?? document.body, 0);
    return document.execCommand("insertText", false, MARKER);
  };

  /* Sends the quote to the far end, so the move always shows in the order. The quote is the
   * cite prefix and whatever follows it: a blockquote in HTML, a pre-wrap span in plain
   * text. */
  const rearrange = () => {
    const prefix = document.body.querySelector(".moz-cite-prefix");
    const quote = prefix?.nextElementSibling;
    if (!prefix || !quote) return false;
    document.body.appendChild(prefix);
    document.body.appendChild(quote);
    return true;
  };

  const moves = {
    dom: () => rearrange(),

    replay() {
      const original = document.body.innerHTML;
      if (!rearrange()) return false;
      const rearranged = document.body.innerHTML;
      document.body.innerHTML = original;
      return (
        document.execCommand("selectAll") &&
        document.execCommand("insertHTML", false, rearranged)
      );
    },
  };

  const run = (name, { restore = true } = {}) => {
    /* Restoring by innerHTML wipes the internal attributes itself, so the scenario whose
     * effect on them is being measured has to run first, on the body as Thunderbird built
     * it. The other one only measures the undo stack, where the restore does no harm. */
    if (restore) {
      document.body.innerHTML = pristine;
    }
    const typed = type();
    const afterTyping = state();
    const moved = moves[name]();
    const afterMove = state();
    document.execCommand("undo");
    const afterUndo = state();
    return {
      typed,
      moved,
      afterTyping,
      afterMove,
      afterUndo,
      /* What a person expects from one Ctrl+Z: the text still there, the order back. */
      undoUndidTheMove: afterUndo.order === afterTyping.order,
      undoKeptTheText: afterUndo.text,
    };
  };

  const internalsAtStart = internalAttributes();
  const replay = run("replay", { restore: false });

  return {
    initialOrder: order(),
    internalsAtStart,
    internalsAfterReplay: replay.afterMove.internals,
    replay,
    dom: run("dom"),
  };
})();
