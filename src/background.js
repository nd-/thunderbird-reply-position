/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Wiring: reads the composer details, asks lib/rules.js for the position, passes it on. No
 * decision here. Any logic that shows up in this file falls outside the testable perimeter
 * and belongs back in lib/.
 */

const STORAGE_KEY = "settings";
const SCRIPT_ID = "reply-position";

const readSettings = async () => {
  const stored = await browser.storage.local.get(STORAGE_KEY);
  return Rules.validate(stored[STORAGE_KEY]).settings;
};

const writeSettings = (settings) =>
  browser.storage.local.set({ [STORAGE_KEY]: settings });

/* Extracts the address of the first recipient of the "To" field.
 *
 * parseMailboxString requires no permission as long as mailing lists are not expanded. A
 * recipient picked from the address book comes in as {nodeId}: resolving it would require
 * the addressBook permission, which the extension does not ask for. It then does nothing,
 * which is an accepted and documented limitation. */
const recipientAddress = async (details) => {
  const first = details.to?.[0];
  const raw = Rules.usableAddress(first);
  if (raw === null) {
    return { address: null, reason: first === undefined ? "no-recipient" : "address-book" };
  }
  const [mailbox] = await browser.messengerUtilities.parseMailboxString(raw);
  return { address: mailbox?.email ?? null, reason: mailbox?.email ? null : "unreadable" };
};

/* What the compose script has to do for this tab. The composer decides its own starting
 * position: it is read from the DOM, not from an identity preference, which an extension
 * cannot access anyway. */
const plan = async (tabId) => {
  const details = await browser.compose.getComposeDetails(tabId);

  if (details.type !== "reply" && details.type !== "forward") {
    return { act: false, reason: "out-of-scope", details: null };
  }

  const settings = await readSettings();

  const { address, reason } = await recipientAddress(details);
  if (!address) {
    return {
      act: false,
      reason,
      address: null,
      plainText: details.isPlainText,
      signature: settings.signature,
    };
  }

  const explanation = Rules.explain(settings, address);

  return {
    act: explanation.position !== "none",
    reason: explanation.position === "none" ? "no-rule" : null,
    target: explanation.position,
    source: explanation.source,
    address,
    domain: Rules.domainOf(address),
    plainText: details.isPlainText,
    /* Passed on to the compose script and to the popup: they apply, the decision stays
     * here. */
    signature: settings.signature,
  };
};

browser.runtime.onMessage.addListener(async (message, sender) => {
  const tabId = message?.tabId ?? sender.tab?.id;

  switch (message?.type) {
    case "plan":
      return plan(tabId);

    case "settings":
      return readSettings();

    case "remember": {
      const settings = await readSettings();
      await writeSettings(Rules.withRule(settings, message.key, message.position));
      return { ok: true };
    }

    case "forget": {
      const settings = await readSettings();
      await writeSettings(Rules.withoutRule(settings, message.key));
      return { ok: true };
    }

    case "default": {
      const settings = await readSettings();
      await writeSettings({ ...settings, defaultAction: message.position });
      return { ok: true };
    }

    case "signature": {
      const settings = await readSettings();
      await writeSettings({ ...settings, signature: message.value });
      return { ok: true };
    }

    default:
      return undefined;
  }
});

/* Registered scripts only apply to composers opened afterwards. Injecting into those
 * already open makes it possible to reload the extension during development without having
 * to reopen every window. */
const injectIntoOpenComposers = async () => {
  const tabs = await browser.tabs.query({ type: "messageCompose" });
  for (const tab of tabs) {
    try {
      await browser.scripting.executeScript({
        target: { tabId: tab.id },
        files: ["lib/layout.js", "compose-script.js"],
      });
    } catch (e) {
      console.warn(`Cannot inject into tab ${tab.id}:`, e.message);
    }
  }
};

const start = async () => {
  try {
    await browser.scripting.compose.registerScripts([
      {
        id: SCRIPT_ID,
        js: ["lib/layout.js", "compose-script.js"],
        /* The captures show a complete and stable body as early as document_idle, on all
         * thirteen covered cases: neither a MutationObserver nor a guard delay is useful. */
        runAt: "document_idle",
      },
    ]);
  } catch (e) {
    /* Already registered after an extension reload: harmless. */
    console.warn("registerScripts:", e.message);
  }
  await injectIntoOpenComposers();
};

start();
