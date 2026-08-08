/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Capture harness: imports the test messages, opens one composer per case of the matrix,
 * has probe.js describe the body, writes the report and quits Thunderbird.
 *
 * All output goes through the JSON report: nothing depends on reading a console, and an
 * error along the way is recorded then followed by a clean shutdown. Without that,
 * Thunderbird would stay alive having written nothing.
 */

const ID = "mail.identity.id1";

const SIGNATURE = "<div>-- <br>Test signature</div>";

/* Settings reset before every case: a case must never inherit from the previous one. */
const NEUTRAL_PREFS = {
  [`${ID}.compose_html`]: true,
  [`${ID}.reply_on_top`]: 1,
  [`${ID}.sig_on_reply`]: false,
  [`${ID}.sig_bottom`]: true,
  [`${ID}.attach_signature`]: false,
  [`${ID}.htmlSigText`]: "",
  [`${ID}.htmlSigFormat`]: true,
};

const MESSAGES = ["html-clean.eml", "html-dirty.eml", "plaintext.eml"];

const MATRIX = [
  {
    id: "reply-html-above",
    comment: "HTML reply, writing area above the quote",
    message: "html-clean.eml",
    action: "reply",
    prefs: { [`${ID}.reply_on_top`]: 1 },
  },
  {
    id: "reply-html-below",
    comment: "HTML reply, writing area below the quote",
    message: "html-clean.eml",
    action: "reply",
    prefs: { [`${ID}.reply_on_top`]: 0 },
  },
  {
    id: "reply-html-selection",
    comment: "HTML reply, quote selected",
    message: "html-clean.eml",
    action: "reply",
    prefs: { [`${ID}.reply_on_top`]: 2 },
  },
  {
    id: "reply-html-dirty",
    comment: "HTML reply to a message loaded with head tags",
    message: "html-dirty.eml",
    action: "reply",
    prefs: { [`${ID}.reply_on_top`]: 1 },
  },
  {
    id: "reply-plaintext",
    comment: "Plain text reply",
    message: "plaintext.eml",
    action: "reply",
    prefs: { [`${ID}.compose_html`]: false, [`${ID}.reply_on_top`]: 1 },
  },
  {
    id: "reply-plaintext-below",
    comment: "Plain text reply, writing area below the quote",
    message: "plaintext.eml",
    action: "reply",
    prefs: { [`${ID}.compose_html`]: false, [`${ID}.reply_on_top`]: 0 },
  },
  {
    id: "reply-plaintext-selection",
    comment: "Plain text reply, quote selected",
    message: "plaintext.eml",
    action: "reply",
    prefs: { [`${ID}.compose_html`]: false, [`${ID}.reply_on_top`]: 2 },
  },
  {
    id: "reply-plaintext-sig",
    comment: "Plain text reply with the signature below the quote",
    message: "plaintext.eml",
    action: "reply",
    prefs: {
      [`${ID}.compose_html`]: false,
      [`${ID}.reply_on_top`]: 1,
      [`${ID}.sig_on_reply`]: true,
      [`${ID}.sig_bottom`]: true,
      [`${ID}.htmlSigText`]: "-- \nTest signature",
      [`${ID}.htmlSigFormat`]: false,
    },
  },
  {
    id: "reply-plaintext-sig-top",
    comment: "Plain text reply, signature above the quote",
    message: "plaintext.eml",
    action: "reply",
    prefs: {
      [`${ID}.compose_html`]: false,
      [`${ID}.reply_on_top`]: 1,
      [`${ID}.sig_on_reply`]: true,
      [`${ID}.sig_bottom`]: false,
      [`${ID}.htmlSigText`]: "-- \nTest signature",
      [`${ID}.htmlSigFormat`]: false,
    },
  },
  {
    id: "forward-inline",
    comment: "Inline forward",
    message: "html-clean.eml",
    action: "forward",
    prefs: { [`${ID}.reply_on_top`]: 1 },
  },
  {
    id: "forward-inline-plaintext",
    comment: "Inline forward in plain text",
    message: "plaintext.eml",
    action: "forward",
    prefs: { [`${ID}.compose_html`]: false },
  },
  {
    id: "reply-html-sig-bottom",
    comment: "HTML reply, signature below the quote",
    message: "html-clean.eml",
    action: "reply",
    prefs: {
      [`${ID}.reply_on_top`]: 1,
      [`${ID}.sig_on_reply`]: true,
      [`${ID}.sig_bottom`]: true,
      [`${ID}.htmlSigText`]: SIGNATURE,
    },
  },
  {
    id: "reply-html-sig-top",
    comment: "HTML reply, signature above the quote",
    message: "html-clean.eml",
    action: "reply",
    prefs: {
      [`${ID}.reply_on_top`]: 1,
      [`${ID}.sig_on_reply`]: true,
      [`${ID}.sig_bottom`]: false,
      [`${ID}.htmlSigText`]: SIGNATURE,
    },
  },
  /* Writing area below the quote: that is where both values of sig_bottom produce the same
   * body, hence the ambiguity lib/layout.js has to handle. The four cases below mostly
   * serve to verify it: if they ever differ, some marker does exist. */
  {
    id: "reply-html-below-sig-bottom",
    comment:
      "HTML reply below the quote, signature at the bottom of the message",
    message: "html-clean.eml",
    action: "reply",
    prefs: {
      [`${ID}.reply_on_top`]: 0,
      [`${ID}.sig_on_reply`]: true,
      [`${ID}.sig_bottom`]: true,
      [`${ID}.htmlSigText`]: SIGNATURE,
    },
  },
  {
    id: "reply-html-below-sig-top",
    comment:
      "HTML reply below the quote, signature attached to the writing area",
    message: "html-clean.eml",
    action: "reply",
    prefs: {
      [`${ID}.reply_on_top`]: 0,
      [`${ID}.sig_on_reply`]: true,
      [`${ID}.sig_bottom`]: false,
      [`${ID}.htmlSigText`]: SIGNATURE,
    },
  },
  {
    id: "reply-plaintext-below-sig-bottom",
    comment:
      "Plain text reply below the quote, signature at the bottom of the message",
    message: "plaintext.eml",
    action: "reply",
    prefs: {
      [`${ID}.compose_html`]: false,
      [`${ID}.reply_on_top`]: 0,
      [`${ID}.sig_on_reply`]: true,
      [`${ID}.sig_bottom`]: true,
      [`${ID}.htmlSigText`]: "-- \nTest signature",
      [`${ID}.htmlSigFormat`]: false,
    },
  },
  {
    id: "reply-plaintext-below-sig-top",
    comment:
      "Plain text reply below the quote, signature attached to the writing area",
    message: "plaintext.eml",
    action: "reply",
    prefs: {
      [`${ID}.compose_html`]: false,
      [`${ID}.reply_on_top`]: 0,
      [`${ID}.sig_on_reply`]: true,
      [`${ID}.sig_bottom`]: false,
      [`${ID}.htmlSigText`]: "-- \nTest signature",
      [`${ID}.htmlSigFormat`]: false,
    },
  },
];

/* "verify" mode: the extension is installed and it is its result that gets checked, instead
 * of capturing what Thunderbird produces on its own.
 *
 * The rules target the senders of the test messages, who become the recipients of the
 * reply: camille is covered by a contact rule, the others by the domain rule. */
const VERIFY_RULES = {
  version: 1,
  rules: {
    "camille@sender.invalid": "below",
    "@sender.invalid": "above",
  },
  defaultAction: "none",
};

const CHECKS = [
  {
    id: "contact-rule-swaps",
    comment: 'Contact rule "below" on a composer opened above',
    message: "html-clean.eml",
    action: "reply",
    prefs: { [`${ID}.reply_on_top`]: 1 },
    expected: "below",
  },
  {
    id: "contact-rule-already-in-place",
    comment: 'Contact rule "below" on a composer already below',
    message: "html-clean.eml",
    action: "reply",
    prefs: { [`${ID}.reply_on_top`]: 0 },
    expected: "below",
  },
  {
    id: "domain-rule-already-in-place",
    comment: 'Domain rule "above" on a composer already above',
    message: "html-dirty.eml",
    action: "reply",
    prefs: { [`${ID}.reply_on_top`]: 1 },
    expected: "above",
  },
  {
    id: "domain-rule-swaps",
    comment: 'Domain rule "above" on a composer opened below',
    message: "html-dirty.eml",
    action: "reply",
    prefs: { [`${ID}.reply_on_top`]: 0 },
    expected: "above",
  },
  {
    id: "plaintext-swaps",
    comment: 'Domain rule "above" in plain text, composer below',
    message: "plaintext.eml",
    action: "reply",
    prefs: { [`${ID}.compose_html`]: false, [`${ID}.reply_on_top`]: 0 },
    expected: "above",
  },
  {
    id: "quote-selected",
    comment: 'Contact rule "below" with no original writing area',
    message: "html-clean.eml",
    action: "reply",
    prefs: { [`${ID}.reply_on_top`]: 2 },
    expected: "below",
  },
  {
    id: "forward-without-recipient",
    comment:
      "Forward opened without a recipient: nothing to decide, the extension stands aside",
    message: "html-clean.eml",
    action: "forward",
    prefs: { [`${ID}.reply_on_top`]: 1 },
    expected: "above",
  },
  {
    id: "forward-with-recipient",
    comment: 'Forward to a contact covered by a "below" rule',
    message: "html-clean.eml",
    action: "forward",
    recipients: ["Camille <camille@sender.invalid>"],
    prefs: { [`${ID}.reply_on_top`]: 1 },
    expected: "below",
  },
  {
    id: "signature-at-bottom",
    comment: 'Contact rule "below" with the signature under the quote',
    message: "html-clean.eml",
    action: "reply",
    prefs: {
      [`${ID}.reply_on_top`]: 1,
      [`${ID}.sig_on_reply`]: true,
      [`${ID}.sig_bottom`]: true,
      [`${ID}.htmlSigText`]: SIGNATURE,
    },
    expected: "below",
    expectedOutline: "prefix · quote · p · signature",
  },
  {
    id: "attached-signature-moves-down",
    comment:
      'Contact rule "below" with the signature attached to the writing area: it moves down with it',
    message: "html-clean.eml",
    action: "reply",
    prefs: {
      [`${ID}.reply_on_top`]: 1,
      [`${ID}.sig_on_reply`]: true,
      [`${ID}.sig_bottom`]: false,
      [`${ID}.htmlSigText`]: SIGNATURE,
    },
    expected: "below",
    expectedOutline: "prefix · quote · p · signature",
  },
  {
    id: "attached-signature-moves-back-up",
    comment:
      'Domain rule "above" on a composer opened below: ambiguous case, the default setting makes the signature follow',
    message: "html-dirty.eml",
    action: "reply",
    prefs: {
      [`${ID}.reply_on_top`]: 0,
      [`${ID}.sig_on_reply`]: true,
      [`${ID}.sig_bottom`]: false,
      [`${ID}.htmlSigText`]: SIGNATURE,
    },
    expected: "above",
    expectedOutline: "p · signature · prefix · quote",
  },
];

/* Position read straight from the capture, without going through lib/layout.js: a test that
 * checked the code against itself would prove nothing. */
const observedPosition = (children) => {
  const quote = children.findIndex(
    (e) => e.includes("moz-cite-prefix") || e.includes("moz-forward-container"),
  );
  if (quote === -1) return "no-quote";

  const end = children[quote].includes("moz-forward-container")
    ? quote
    : quote + 1;
  const meaningful = (list) => list.filter((e) => !e.includes("moz-signature"));

  if (meaningful(children.slice(0, quote)).length) return "above";
  if (meaningful(children.slice(end + 1)).length) return "below";
  return "absent";
};

/* Full order of the body children, signature included: `observedPosition` filters it out
 * and can therefore say nothing about its placement, which is precisely what was found
 * broken. Same vocabulary as the outline of the unit tests, so that both read alike. */
const outline = (children) =>
  children
    .filter((e) => e !== "#text (empty)")
    .map((e) => {
      if (e.includes("moz-cite-prefix")) return "prefix";
      if (e.includes("moz-signature")) return "signature";
      if (e.includes("moz-forward-container")) return "forward";
      if (e.startsWith("<blockquote")) return "quote";
      if (e.startsWith("<span")) return "plain-quote";
      const tag = /^<([a-z0-9]+)/.exec(e);
      return tag ? tag[1] : "text";
    })
    .join(" · ");

const T0 = Date.now();
const log = [];
const trace = (event, data = {}) =>
  log.push({ ms: Date.now() - T0, event, ...data });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const readFixture = async (name) => {
  const response = await fetch(browser.runtime.getURL(`fixtures/${name}`));
  return response.text();
};

const headerIdOf = (name) =>
  `${name.replace(/\.eml$/, "")}@reply-position.invalid`;

/* Imports the .eml files and returns, per fixture name, the WebExtension id of the message.
 * Indexing is not instant after the import: the query is retried. */
const importMessages = async () => {
  const messages = await Promise.all(
    MESSAGES.map(async (name) => ({ name, content: await readFixture(name) })),
  );
  await browser.testkit.importMessages(messages);
  trace("messages imported", { count: messages.length });

  const ids = {};
  for (const name of MESSAGES) {
    const headerMessageId = headerIdOf(name);
    for (let attempt = 1; attempt <= 25; attempt += 1) {
      const { messages: found } = await browser.messages.query({
        headerMessageId,
      });
      if (found.length) {
        ids[name] = found[0].id;
        trace("message found", { name, id: found[0].id, attempt });
        break;
      }
      await wait(200);
    }
    if (!(name in ids)) {
      throw new Error(`Message ${name} not found after import`);
    }
  }
  return ids;
};

/* The body counts as filled as soon as it carries the quote. In plain text there is neither
 * a .moz-cite-prefix nor a blockquote[type=cite] to wait for: the only marker is text. */
const bodyFilled = (probe, plainText) => {
  const presence = probe?.delayed?.presence;
  if (!presence) return false;
  if (plainText) return probe.delayed.textLength > 0;
  return presence.blockquoteCite > 0 || presence.forwardContainer > 0;
};

/* Injects the probe and retries as long as the body is not filled: the exact moment when
 * Thunderbird fills it is precisely part of what is being established. A body that never
 * fills is a capture, not a breakdown, and goes into the report. */
const probeComposer = async (tabId, plainText) => {
  let last = null;
  for (let attempt = 1; attempt <= 15; attempt += 1) {
    /* scripting.compose only exposes register/unregister/getRegisteredScripts; one-off
     * injection goes through the generic scripting namespace. */
    const [injection] = await browser.scripting.executeScript({
      target: { tabId },
      files: ["probe.js"],
    });
    last = injection?.result ?? null;
    if (bodyFilled(last, plainText)) {
      return { ...last, attempts: attempt, bodyFilled: true };
    }
    await wait(200);
  }
  return { ...last, attempts: 15, bodyFilled: false };
};

const runCase = async (testCase, ids) => {
  await browser.testkit.setPrefs({ ...NEUTRAL_PREFS, ...testCase.prefs });
  trace("preferences set", { case: testCase.id });

  const messageId = ids[testCase.message];
  const tab =
    testCase.action === "forward"
      ? await browser.compose.beginForward(messageId, "forwardInline")
      : await browser.compose.beginReply(messageId, "replyToSender");
  trace("composer opened", { case: testCase.id, tabId: tab.id });

  try {
    const details = await browser.compose.getComposeDetails(tab.id);
    const probe = await probeComposer(tab.id, details.isPlainText);
    return {
      id: testCase.id,
      comment: testCase.comment,
      message: testCase.message,
      action: testCase.action,
      prefs: { ...NEUTRAL_PREFS, ...testCase.prefs },
      details: {
        type: details.type,
        isPlainText: details.isPlainText,
        identityId: details.identityId,
        to: details.to,
        subject: details.subject,
      },
      probe,
    };
  } finally {
    await browser.tabs.remove(tab.id);
    trace("composer closed", { case: testCase.id });
  }
};

/* In verify mode, the capture has to happen after the extension has acted. Nothing signals
 * that moment: the body is probed until the expected position shows up, and a failure after
 * the attempts run out is a real failure, not a synchronisation problem. */
const runCheck = async (testCase, ids) => {
  await browser.testkit.setPrefs({ ...NEUTRAL_PREFS, ...testCase.prefs });

  const messageId = ids[testCase.message];
  /* A forward opens with no recipient; filling it in at opening time reproduces a forward
   * to a known contact, the only case where a rule can apply. */
  const openDetails = testCase.recipients
    ? { to: testCase.recipients }
    : undefined;
  const tab =
    testCase.action === "forward"
      ? await browser.compose.beginForward(
          messageId,
          "forwardInline",
          openDetails,
        )
      : await browser.compose.beginReply(
          messageId,
          "replyToSender",
          openDetails,
        );
  trace("composer opened", { case: testCase.id, tabId: tab.id });

  try {
    const details = await browser.compose.getComposeDetails(tab.id);
    let probe = null;
    let observed = null;

    let shape = null;

    for (let attempt = 1; attempt <= 20; attempt += 1) {
      probe = await probeComposer(tab.id, details.isPlainText);
      observed = observedPosition(probe.delayed.children);
      shape = outline(probe.delayed.children);
      const shapeOk =
        !testCase.expectedOutline || shape === testCase.expectedOutline;
      if (observed === testCase.expected && shapeOk) {
        trace("position reached", { case: testCase.id, attempt });
        break;
      }
      await wait(200);
    }

    const mismatches = [];
    if (observed !== testCase.expected) {
      mismatches.push(`position ${observed}, expected ${testCase.expected}`);
    }
    if (testCase.expectedOutline && shape !== testCase.expectedOutline) {
      mismatches.push(
        `body "${shape}", expected "${testCase.expectedOutline}"`,
      );
    }

    return {
      id: testCase.id,
      comment: testCase.comment,
      message: testCase.message,
      action: testCase.action,
      expected: testCase.expected,
      observed,
      expectedOutline: testCase.expectedOutline,
      outline: shape,
      ok: mismatches.length === 0,
      details: {
        type: details.type,
        isPlainText: details.isPlainText,
        to: details.to,
      },
      probe,
      error: mismatches.length ? mismatches.join(" ; ") : undefined,
    };
  } finally {
    await browser.tabs.remove(tab.id);
  }
};

/* Checks both interfaces where they live: the popup in the panel of the compose button, the
 * options page in a tab. The jsdom tests already cover their logic; what is at stake here is
 * what those cannot see: does the popup open, do its messages really reach the composer,
 * does the options page really write into the extension storage. */
const checkInterfaces = async (ids, extensionId) => {
  const results = [];
  const note = (id, ok, detail) => results.push({ id, ok, detail });

  /* — Compose button —
   *
   * The popup itself does not open from here: a toolbar button only obeys a trusted event,
   * which no API available to an Experiment produces. What can be checked, then, is that
   * Thunderbird did create the button and its panel out of the manifest. The content of the
   * popup is covered under jsdom by test/interfaces.test.js. */
  await browser.testkit.setPrefs({
    ...NEUTRAL_PREFS,
    [`${ID}.reply_on_top`]: 1,
  });
  const tab = await browser.compose.beginReply(
    ids["html-clean.eml"],
    "replyToSender",
  );
  await wait(1500);

  try {
    const button = await browser.testkit.inspectComposeAction(extensionId);
    trace("compose button", { button });

    note("button-present", Boolean(button.button), button.button);
    note("button-visible", button.visible, String(button.visible));
    note(
      "button-label-translated",
      Boolean(button.label) && !button.label.startsWith("__MSG"),
      button.label,
    );
  } catch (e) {
    note("button", false, e.message);
  } finally {
    await browser.tabs.remove(tab.id);
  }

  /* — The icon follows the theme —
   *
   * `ui.systemUsesDarkTheme` is what the desktop environment would set, and it drives
   * `prefers-color-scheme` both in the chrome and in the background page of the extension.
   *
   * This is not a formality: `theme_icons` never worked here, and background.js picks the file
   * by hand because of it (the reason is written down there). These two cases are what keeps
   * that workaround honest, and what will say whether a later Thunderbird fixes the
   * underlying bug. */
  for (const dark of [false, true]) {
    await browser.testkit.setPrefs({ "ui.systemUsesDarkTheme": dark ? 1 : 0 });
    const themedTab = await browser.compose.beginReply(
      ids["html-clean.eml"],
      "replyToSender",
    );
    await wait(1500);
    try {
      const button = await browser.testkit.inspectComposeAction(extensionId);
      trace(`compose button, dark=${dark}`, {
        icon: button.icon,
        prefersDark: button.prefersDark,
        root: button.rootAttributes,
        contextFill: button.contextFill,
        vars: button.iconVariables,
      });
      const expected = dark ? "compose-action-light.svg" : "compose-action.svg";
      const unexpected = dark
        ? "compose-action.svg"
        : "compose-action-light.svg";
      note(
        dark ? "button-icon-dark-theme" : "button-icon-light-theme",
        button.icon.includes(expected) && !button.icon.includes(unexpected),
        button.icon,
      );
    } catch (e) {
      note(
        dark ? "button-icon-dark-theme" : "button-icon-light-theme",
        false,
        e.message,
      );
    } finally {
      await browser.tabs.remove(themedTab.id);
    }
  }
  await browser.testkit.setPrefs({ "ui.systemUsesDarkTheme": 0 });

  /* — Options page, in a tab — */
  try {
    await browser.testkit.openExtensionPage(
      extensionId,
      "options/options.html",
    );
    await wait(2000);

    const read = await browser.testkit.readPage("options/options.html", [
      "h1",
      "#rules tr",
      "#empty",
      "#default",
      "#key",
    ]);
    trace("options read", { url: read.url, elements: read.elements });

    note(
      "options-title-translated",
      !read.elements.h1.text.startsWith("__MSG"),
      read.elements.h1.text,
    );
    note(
      "options-rules-displayed",
      read.elements["#rules tr"].exists &&
        read.elements["#rules tr"].count >= 2,
      read.elements["#rules tr"].count,
    );

    await browser.testkit.actOnPage("options/options.html", [
      { selector: "#key", action: "type", value: "Added@Example.ORG" },
      { selector: "#position", action: "select", value: "below" },
      { selector: "#add", action: "submit" },
    ]);
    await wait(1000);

    const afterAdd = await browser.testkit.getStorage(extensionId);
    note(
      "options-add-saved",
      afterAdd?.settings?.rules?.["added@example.org"] === "below",
      afterAdd?.settings?.rules,
    );

    await browser.testkit.actOnPage("options/options.html", [
      { selector: "#default", action: "select", value: "above" },
    ]);
    await wait(1000);
    const afterDefault = await browser.testkit.getStorage(extensionId);
    note(
      "options-default-saved",
      afterDefault?.settings?.defaultAction === "above",
      afterDefault?.settings?.defaultAction,
    );

    await browser.testkit.actOnPage("options/options.html", [
      { selector: "#rules tr td:last-child button", action: "click" },
    ]);
    await wait(1000);
    const afterDelete = await browser.testkit.getStorage(extensionId);
    note(
      "options-delete-saved",
      Object.keys(afterDelete?.settings?.rules ?? {}).length <
        Object.keys(afterDefault?.settings?.rules ?? {}).length,
      afterDelete?.settings?.rules,
    );
  } catch (e) {
    note("options", false, e.message);
  }

  /* — Ctrl+Z after a move —
   *
   * Reported from real use: typing, switching the position, then undoing loses the typed text
   * and leaves the quote where the switch put it. undo-probe.js reproduces the mechanism on a
   * composer of its own. */
  for (const [flavour, message, html] of [
    ["html", "html-clean.eml", true],
    ["plaintext", "plaintext.eml", false],
  ]) {
    await browser.testkit.setPrefs({
      ...NEUTRAL_PREFS,
      [`${ID}.reply_on_top`]: 1,
      [`${ID}.compose_html`]: html,
    });
    const undoTab = await browser.compose.beginReply(
      ids[message],
      "replyToSender",
    );
    await wait(1500);
    try {
      const [injection] = await browser.scripting.executeScript({
        target: { tabId: undoTab.id },
        files: ["undo-probe.js"],
      });
      const undo = injection?.result;
      trace(`undo probe, ${flavour}`, undo);

      note(
        `undo-restores-a-replayed-move-${flavour}`,
        Boolean(undo?.replay?.moved) &&
          Boolean(undo?.replay?.undoUndidTheMove) &&
          Boolean(undo?.replay?.undoKeptTheText),
        `order back: ${undo?.replay?.undoUndidTheMove}, text kept: ${undo?.replay?.undoKeptTheText}`,
      );
      /* The witness: plain DOM calls stay outside the undo stack, which is the whole reason
       * compose-script.js replays the rearrangement through the editor. */
      note(
        `undo-ignores-a-plain-dom-move-${flavour}`,
        undo?.dom?.undoUndidTheMove === false &&
          undo?.dom?.undoKeptTheText === false,
        `order back: ${undo?.dom?.undoUndidTheMove}, text kept: ${undo?.dom?.undoKeptTheText}`,
      );
      /* Not a success, a measured fact held in place: replaying through the editor goes
       * through innerHTML, which drops the internal attributes Thunderbird never serializes,
       * `_moz_quote` above all. The editor puts some back, not all. Whether that changes the
       * message actually sent is for the MIME check to say; until then this case will report
       * any change in the loss. */
      note(
        `replay-loses-internal-attributes-${flavour}`,
        undo?.internalsAfterReplay < undo?.internalsAtStart,
        `${undo?.internalsAtStart} at open, ${undo?.internalsAfterReplay} after the replay`,
      );
    } catch (e) {
      note(`undo-${flavour}`, false, e.message);
    } finally {
      await browser.tabs.remove(undoTab.id);
    }
  }

  results.push(...(await checkMime(ids, extensionId)));

  return results;
};

/* Level 3: what ends up in the message itself.
 *
 * `saveMessage({mode:"draft"})` then `messages.getRaw()` runs the very serialisation a send
 * would, without an SMTP server and without sending anything. Two questions:
 *
 *   1. does the order obtained in the DOM survive into the emitted message;
 *   2. does replaying the rearrangement through the editor change that message. The replay
 *      goes through innerHTML, which drops `_moz_quote` and friends, and those drive how
 *      quoted lines are rewrapped on send. Reading the DOM cannot answer, only the raw
 *      message can.
 *
 * Both composers are arranged by an injected function rather than by the extension, so that
 * the two runs differ by one thing only, the way the nodes were moved. The extension is put
 * on hold for the occasion by emptying its rules. */
const MIME_MARKER = "RPMARKER";

const rearrangeInComposer = (mode, marker) => {
  const body = document.body;
  const paragraph = [...body.children].find((n) => n.tagName === "P" && !n.className);
  const selection = window.getSelection();
  selection.removeAllRanges();
  const range = document.createRange();
  range.setStart(paragraph ?? body, 0);
  range.collapse(true);
  selection.addRange(range);
  document.execCommand("insertText", false, marker);

  const prefix = body.querySelector(".moz-cite-prefix");
  const quote = prefix?.nextElementSibling;
  if (!prefix || !quote) return { moved: false };

  const original = body.innerHTML;
  body.insertBefore(prefix, body.firstChild);
  body.insertBefore(quote, prefix.nextSibling);

  if (mode === "dom") {
    return { moved: true, replayed: false };
  }

  const rearranged = body.innerHTML;
  body.innerHTML = original;
  const replayed =
    document.execCommand("selectAll") &&
    document.execCommand("insertHTML", false, rearranged);
  return { moved: true, replayed };
};

/* Strips what changes between two identical messages: the boundary, the identifiers, the
 * dates, and the header block itself. What is left is the body as libmime built it. */
const comparableBody = (raw) => {
  if (!raw) return null;
  const normalized = raw.replace(/\r\n/g, "\n");
  const body = normalized.slice(normalized.indexOf("\n\n") + 2);
  return body
    .replace(/--+[-\w]*\d{5,}[-\w]*/g, "--BOUNDARY")
    .replace(/boundary="[^"]*"/g, 'boundary="BOUNDARY"')
    .trim();
};

const checkMime = async (ids, extensionId) => {
  const results = [];
  const note = (id, ok, detail) => results.push({ id, ok, detail });

  /* The extension has to stand aside: if it rearranged the composer on its own, both runs
   * would already have gone through the replay and there would be nothing left to compare. */
  await browser.testkit.setStorage(extensionId, {
    settings: { version: 1, rules: {}, defaultAction: "none", signature: "reply" },
  });

  for (const [flavour, message, html, extraPrefs = {}] of [
    ["html", "html-clean.eml", true],
    ["plaintext", "plaintext.eml", false],
    /* Plain text with a signature: the case where rewrapping on send has the most to chew
     * on, quoted lines and a signature delimiter in the same body. */
    [
      "plaintext-signature",
      "plaintext.eml",
      false,
      {
        [`${ID}.sig_on_reply`]: true,
        [`${ID}.sig_bottom`]: true,
        [`${ID}.htmlSigText`]: "-- \nTest signature",
        [`${ID}.htmlSigFormat`]: false,
      },
    ],
  ]) {
    const bodies = {};
    try {
      for (const mode of ["dom", "replay"]) {
        await browser.testkit.setPrefs({
          ...NEUTRAL_PREFS,
          [`${ID}.reply_on_top`]: 1,
          [`${ID}.compose_html`]: html,
          ...extraPrefs,
        });
        const tab = await browser.compose.beginReply(ids[message], "replyToSender");
        await wait(1500);

        const [injection] = await browser.scripting.executeScript({
          target: { tabId: tab.id },
          func: rearrangeInComposer,
          args: [mode, MIME_MARKER],
        });
        if (!injection?.result?.moved) {
          throw new Error(`nothing to move in the ${flavour} composer`);
        }

        const saved = await browser.compose.saveMessage(tab.id, { mode: "draft" });
        const header = saved?.messages?.[0];
        /* getRaw hands back a File under Manifest V3, a string under V2. */
        const rawMessage = header ? await browser.messages.getRaw(header.id) : null;
        const raw =
          typeof rawMessage === "string" ? rawMessage : await rawMessage?.text();
        bodies[mode] = comparableBody(raw);
        await browser.tabs.remove(tab.id);
      }

      /* The quote was moved to the top, so in the emitted message the cite prefix must come
       * before the text that was typed. This is the point of the whole extension: a DOM that
       * looks right proves nothing until the serialiser agrees. */
      const quoteBeforeReply = (body) => {
        const prefix = body.indexOf("wrote:");
        const typed = body.indexOf(MIME_MARKER);
        return prefix !== -1 && typed !== -1 && prefix < typed;
      };

      note(
        `mime-order-follows-the-dom-${flavour}`,
        quoteBeforeReply(bodies.replay ?? ""),
        `cite prefix at ${bodies.replay?.indexOf("wrote:")}, typed text at ${bodies.replay?.indexOf(MIME_MARKER)}`,
      );

      const identical = bodies.dom === bodies.replay;
      note(
        `mime-replay-changes-nothing-${flavour}`,
        identical,
        identical
          ? "the replayed body serialises exactly like the plain DOM one"
          : `bodies differ: ${bodies.dom?.length} vs ${bodies.replay?.length} characters`,
      );
      if (!identical) {
        trace(`mime bodies, ${flavour}`, { dom: bodies.dom, replay: bodies.replay });
      }
    } catch (e) {
      note(`mime-${flavour}`, false, e.message);
    }
  }

  return results;
};

const run = async () => {
  const mode =
    (await browser.testkit.getPref("extensions.reply-position.mode")) ??
    "capture";
  const report = {
    date: new Date().toISOString(),
    mode,
    version: (await browser.runtime.getBrowserInfo?.())?.version ?? null,
    cases: [],
    log,
    error: null,
  };

  try {
    const ids = await importMessages();

    if (mode === "verify") {
      /* The extension is installed through a proxy file dropped in the profile, so it is
       * loaded when Thunderbird starts: there is nothing to install here, only its rules to
       * write, which no API allows between extensions. */
      const extensionId = await browser.testkit.getPref(
        "extensions.reply-position.extensionId",
      );
      await browser.testkit.setStorage(extensionId, { settings: VERIFY_RULES });
      trace("rules written", {
        extensionId,
        content: await browser.testkit.getStorage(extensionId),
      });
    }

    const matrix = mode === "verify" ? CHECKS : MATRIX;
    const play = mode === "verify" ? runCheck : runCase;

    for (const testCase of matrix) {
      try {
        report.cases.push(await play(testCase, ids));
      } catch (e) {
        trace("case failed", { case: testCase.id, message: e.message });
        report.cases.push({
          id: testCase.id,
          comment: testCase.comment,
          error: e.message,
        });
      }
    }

    if (mode === "verify") {
      const extensionId = await browser.testkit.getPref(
        "extensions.reply-position.extensionId",
      );
      report.interfaces = await checkInterfaces(ids, extensionId);
    }
  } catch (e) {
    report.error = `${e.message}\n${e.stack ?? ""}`;
    trace("global failure", { message: e.message });
  }

  if (mode === "verify") {
    try {
      report.extensionStorage = await browser.testkit.getStorage(
        await browser.testkit.getPref("extensions.reply-position.extensionId"),
      );
    } catch (e) {
      report.extensionStorage = { error: e.message };
    }
  }

  try {
    report.console = await browser.testkit.consoleMessages();
  } catch (e) {
    report.console = [{ text: `cannot read: ${e.message}` }];
  }

  try {
    const path = await browser.testkit.writeReport(report);
    console.log(`Report written: ${path}`);
  } catch (e) {
    console.error("Cannot write the report:", e.message);
  }
  await browser.testkit.quit();
};

run();
