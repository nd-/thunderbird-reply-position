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

/* The toolbar icon has to be chosen here, because Thunderbird chooses it wrong.
 *
 * `theme_icons` is the documented mechanism, and it does not work with the built-in themes,
 * "automatic" included, which is what most people run. Measured in TB 153, and kept under
 * watch by the `button-icon-*-theme` cases of the verification harness:
 *
 *  - `ExtensionParent.sys.mjs` overwrites the `default_icon` entry with the `dark` file of
 *    `theme_icons` (`default: lightURL`, flagged in the source as bug 2008737);
 *  - `webextensions.css` only reaches for the other file under `:root[lwtheme]`, an attribute
 *    the built-in themes do not set: with the default theme the root carries
 *    `theme-effective-id=default-theme@mozilla.org` and nothing else.
 *
 * So whatever the two keys hold, the same file comes out on a light and on a dark toolbar.
 * `context-fill` is no way out either: the computed style of the button has a `fill` that does
 * follow the theme, but an empty `-moz-context-properties`, so nothing is passed to the image.
 *
 * What is left is picking the file ourselves. The background page is an extension document,
 * so `matchMedia` answers there without any extra permission. */
const ICONS = {
  light: "icons/compose-action.svg",
  dark: "icons/compose-action-light.svg",
};

const applyThemedIcon = (dark) => {
  const path = dark ? ICONS.dark : ICONS.light;
  return browser.composeAction.setIcon({ path: { 16: path, 32: path } });
};

const watchTheme = () => {
  const dark = matchMedia("(prefers-color-scheme: dark)");
  dark.addEventListener("change", (event) => applyThemedIcon(event.matches));
  return applyThemedIcon(dark.matches);
};

const start = async () => {
  await watchTheme();
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
