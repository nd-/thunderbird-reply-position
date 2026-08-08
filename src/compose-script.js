/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Wiring on the composer side: asks for the plan, applies lib/layout.js, answers the
 * switches coming from the popup. No decision here.
 *
 * Injected after lib/layout.js, in the same global scope: `Layout` is therefore defined.
 */

(() => {
  /* The script can be injected twice into the same composer: once by registerScripts when
   * it opens, once by the background when the extension is reloaded during development.
   * The second time must not replay the move. */
  if (window.__replyPositionInstalled) {
    return;
  }
  window.__replyPositionInstalled = true;

  /* Captured once, on the body as Thunderbird produced it: once the quote has moved, the
   * node order no longer says whether the signature belongs to the reply text or to the
   * bottom of the message. This is not a decision, it is an observation made by
   * `Layout.analyze` and kept for the following switches. */
  const initialAnchor = Layout.analyze(document).signatureAnchor;

  /* Rearranges, then replays the result through the editor so that Ctrl+Z undoes it.
   *
   * Nodes moved by plain DOM calls never reach the undo stack: the editor only knows the
   * transactions it performed itself. Measured in TB 153 by test/integration/undo-probe.js —
   * after typing, switching and undoing, the typed text was lost and the quote stayed where
   * the switch had put it, which is what a user reported. Of the three ways measured, only
   * one behaves: select everything and insert the rearranged body in a single command, which
   * the editor records as one transaction. Deleting the quote then inserting it elsewhere
   * makes two, and a single Ctrl+Z then leaves the message without its quote.
   *
   * `Layout.apply` still does the arranging on the real DOM, unchanged and testable under
   * jsdom. What happens here is only the replay: rewind to the original markup, then let the
   * editor put the rearranged one back.
   *
   * The cost, to weigh at the MIME check: going through innerHTML drops the internal
   * attributes Thunderbird sets but does not serialize, `_moz_quote` and `_moz_dirty`. */
  const applyUndoable = (target, options) => {
    const body = document.body;
    const original = body.innerHTML;

    const result = Layout.apply(document, target, options);
    if (!result.changed) {
      return result;
    }

    const rearranged = body.innerHTML;
    body.innerHTML = original;

    const replayed =
      typeof document.execCommand === "function" &&
      document.execCommand("selectAll") &&
      document.execCommand("insertHTML", false, rearranged);

    if (!replayed) {
      /* Editor refused: keep the rearrangement rather than the original, and lose only the
       * ability to undo it. */
      body.innerHTML = rearranged;
    }
    Layout.placeCursor(document, result.cursorIndex);

    return { ...result, undoable: Boolean(replayed) };
  };

  const applyPlan = async () => {
    const plan = await browser.runtime.sendMessage({ type: "plan" });
    if (!plan?.act) {
      return plan;
    }
    const result = applyUndoable(plan.target, {
      plainText: plan.plainText,
      anchor: initialAnchor,
      signature: plan.signature,
    });
    return { ...plan, result };
  };

  browser.runtime.onMessage.addListener((message) => {
    switch (message?.type) {
      case "state":
        /* The popup needs the real position, the one of the DOM: it can differ from the
         * rule if the user has already switched by hand. */
        return Promise.resolve({
          position: Layout.analyze(document).position,
        });

      case "place":
        return Promise.resolve(
          applyUndoable(message.target, {
            plainText: message.plainText,
            anchor: initialAnchor,
            signature: message.signature,
          }),
        );

      default:
        return undefined;
    }
  });

  applyPlan().catch((e) => console.error("Reply position:", e.message));
})();
