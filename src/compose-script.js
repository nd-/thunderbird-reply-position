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

  const applyPlan = async () => {
    const plan = await browser.runtime.sendMessage({ type: "plan" });
    if (!plan?.act) {
      return plan;
    }
    const result = Layout.apply(document, plan.target, {
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
          Layout.apply(document, message.target, {
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
