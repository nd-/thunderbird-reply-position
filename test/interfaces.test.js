/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Tests of the popup and of the options page under jsdom, with a fake `browser`.
 *
 * They do not replace the verification inside Thunderbird: the rendering, the panel of the
 * compose button and the real opening of the options page do not exist here. But they catch
 * what breaks most often: a selector that matches nothing, a missing translation key, a
 * malformed API call.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { loadPage } from "./loader.js";
import messagesEn from "../src/_locales/en/messages.json" with { type: "json" };
import messagesFr from "../src/_locales/fr/messages.json" with { type: "json" };

const flush = () => new Promise((resolve) => setImmediate(resolve));

/* Returns the key as is: a label displayed as "[popupToggle]" tells at once which string is
 * being used, and a key missing from the language file is detected. */
const fakeI18n = () => ({
  getMessage: (key, arguments_ = []) => {
    if (!(key in messagesEn)) {
      throw new Error(`Translation key missing from en/messages.json: ${key}`);
    }
    const suffix = [].concat(arguments_).filter(Boolean).join(",");
    return suffix ? `[${key}:${suffix}]` : `[${key}]`;
  },
});

const fakeBrowser = ({ plan, state = { position: "above" }, settings } = {}) => {
  const calls = [];
  const record = (name, payload) => calls.push({ name, ...payload });

  let currentState = { ...state };
  let currentSettings = settings;

  return {
    calls,
    get settings() {
      return currentSettings;
    },
    i18n: fakeI18n(),
    tabs: {
      query: async () => [{ id: 42 }],
      sendMessage: async (tabId, message) => {
        record("tabs.sendMessage", { tabId, message });
        if (message.type === "state") return { ...currentState };
        if (message.type === "place") {
          currentState = { position: message.target };
          return { changed: true, before: state.position, after: message.target };
        }
        return undefined;
      },
    },
    runtime: {
      sendMessage: async (message) => {
        record("runtime.sendMessage", { message });
        switch (message.type) {
          case "plan":
            return plan;
          case "settings":
            return currentSettings;
          case "remember":
            currentSettings = {
              ...currentSettings,
              rules: { ...currentSettings.rules, [message.key]: message.position },
            };
            return { ok: true };
          case "forget": {
            const rules = { ...currentSettings.rules };
            delete rules[message.key];
            currentSettings = { ...currentSettings, rules };
            return { ok: true };
          }
          case "default":
            currentSettings = { ...currentSettings, defaultAction: message.position };
            return { ok: true };
          case "signature":
            currentSettings = { ...currentSettings, signature: message.value };
            return { ok: true };
          default:
            return undefined;
        }
      },
      openOptionsPage: () => record("runtime.openOptionsPage", {}),
    },
  };
};

const FULL_PLAN = {
  act: true,
  target: "below",
  source: "contact",
  address: "camille@sender.invalid",
  domain: "@sender.invalid",
  plainText: false,
  signature: "reply",
};

const openPopup = async (browser) => {
  const page = await loadPage("popup/popup.html", ["popup/popup.js"], browser);
  await flush();
  await flush();
  return page;
};

const openOptions = async (browser) => {
  const page = await loadPage(
    "options/options.html",
    ["lib/rules.js", "options/options.js"],
    browser,
  );
  await flush();
  await flush();
  return page;
};

describe("language files", () => {
  test("English and French have exactly the same keys", () => {
    assert.deepEqual(Object.keys(messagesEn).sort(), Object.keys(messagesFr).sort());
  });

  test("every key referenced by data-i18n exists", async () => {
    const { readFileSync } = await import("node:fs");
    for (const page of ["popup/popup.html", "options/options.html"]) {
      const html = readFileSync(new URL(`../src/${page}`, import.meta.url), "utf8");
      for (const [, key] of html.matchAll(/data-i18n="([^"]+)"/g)) {
        assert.ok(key in messagesEn, `${page}: ${key} missing from en/messages.json`);
      }
    }
  });

  test("no key of the manifest is missing", async () => {
    const { readFileSync } = await import("node:fs");
    const manifest = readFileSync(new URL("../src/manifest.json", import.meta.url), "utf8");
    for (const [, key] of manifest.matchAll(/__MSG_([^_]+)__/g)) {
      assert.ok(key in messagesEn, `manifest.json: ${key} missing`);
    }
  });
});

describe("popup", () => {
  test("shows the real position of the body, not the one of the rule", async () => {
    /* The user may have switched by hand: the DOM is what counts. */
    const browser = fakeBrowser({ plan: FULL_PLAN, state: { position: "above" } });
    const { document } = await openPopup(browser);

    assert.equal(document.querySelector("#panel").hidden, false);
    assert.equal(document.querySelector("#position").textContent, "[positionAbove]");
  });

  test("names the contact and the domain in the checkboxes", async () => {
    const browser = fakeBrowser({ plan: FULL_PLAN });
    const { document } = await openPopup(browser);

    assert.equal(
      document.querySelector("#label-contact").textContent,
      "[popupRememberContact:camille@sender.invalid]",
    );
    assert.equal(
      document.querySelector("#label-domain").textContent,
      "[popupRememberDomain:@sender.invalid]",
    );
  });

  test('the switch sends "place" to the composer and updates the display', async () => {
    const browser = fakeBrowser({ plan: FULL_PLAN, state: { position: "above" } });
    const { document } = await openPopup(browser);

    document.querySelector("#toggle").click();
    await flush();
    await flush();

    const place = browser.calls.find((c) => c.message?.type === "place");
    assert.ok(place, 'no "place" message sent');
    assert.equal(place.tabId, 42);
    assert.equal(place.message.target, "below");
    assert.equal(place.message.plainText, false);
    /* Without it, the composer would fall back on its own default instead of the setting. */
    assert.equal(place.message.signature, "reply");
    assert.equal(document.querySelector("#position").textContent, "[positionBelow]");
  });

  test('ticking "remember for the contact" saves the displayed position', async () => {
    const browser = fakeBrowser({
      plan: FULL_PLAN,
      state: { position: "above" },
      settings: { version: 1, rules: {}, defaultAction: "none" },
    });
    const { document } = await openPopup(browser);

    const checkbox = document.querySelector("#remember-contact");
    checkbox.checked = true;
    checkbox.dispatchEvent(new document.defaultView.Event("change"));
    await flush();
    await flush();

    const remember = browser.calls.find((c) => c.message?.type === "remember");
    assert.ok(remember, 'no "remember" message sent');
    assert.equal(remember.message.key, "camille@sender.invalid");
    assert.equal(remember.message.position, "above");
    assert.equal(document.querySelector("#confirmation").hidden, false);
  });

  test("remembering after a switch keeps the new position", async () => {
    const browser = fakeBrowser({
      plan: FULL_PLAN,
      state: { position: "above" },
      settings: { version: 1, rules: {}, defaultAction: "none" },
    });
    const { document } = await openPopup(browser);

    document.querySelector("#remember-domain").checked = true;
    document.querySelector("#toggle").click();
    await flush();
    await flush();

    const remember = browser.calls.filter((c) => c.message?.type === "remember").pop();
    assert.equal(remember.message.key, "@sender.invalid");
    assert.equal(remember.message.position, "below");
  });

  test("outside a reply or a forward, the panel stays hidden", async () => {
    const browser = fakeBrowser({ plan: { act: false, reason: "out-of-scope" } });
    const { document } = await openPopup(browser);

    assert.equal(document.querySelector("#panel").hidden, true);
    assert.equal(document.querySelector("#unavailable").hidden, false);
    assert.equal(document.querySelector("#unavailable").textContent, "[popupNotAReply]");
  });

  test("recipient coming from the address book: specific message", async () => {
    const browser = fakeBrowser({
      plan: { act: false, reason: "address-book", address: null },
    });
    const { document } = await openPopup(browser);

    assert.equal(
      document.querySelector("#unavailable").textContent,
      "[popupFromAddressBook]",
    );
  });

  test("forward with no recipient: standing-aside message", async () => {
    const browser = fakeBrowser({
      plan: { act: false, reason: "no-recipient", address: null },
    });
    const { document } = await openPopup(browser);

    assert.equal(document.querySelector("#unavailable").textContent, "[popupNoRecipient]");
  });

  test("the link opens the options page", async () => {
    const browser = fakeBrowser({ plan: FULL_PLAN });
    const { document, window } = await openPopup(browser);
    window.close = () => {};

    document.querySelector("#options").click();
    await flush();

    assert.ok(browser.calls.some((c) => c.name === "runtime.openOptionsPage"));
  });
});

describe("options page", () => {
  const SETTINGS = {
    version: 1,
    rules: { "john@company.com": "below", "@company.com": "above" },
    defaultAction: "none",
    signature: "reply",
  };

  test("draws one row per rule, sorted", async () => {
    const browser = fakeBrowser({ settings: SETTINGS });
    const { document } = await openOptions(browser);

    const keys = [...document.querySelectorAll("#rules tr td:first-child")].map(
      (td) => td.textContent,
    );
    assert.deepEqual(keys, ["@company.com", "john@company.com"]);
    assert.equal(document.querySelector("#empty").hidden, true);
    assert.equal(document.querySelector("#default").value, "none");
  });

  test('with no rule, the "no rules yet" notice is visible', async () => {
    const browser = fakeBrowser({
      settings: { version: 1, rules: {}, defaultAction: "none" },
    });
    const { document } = await openOptions(browser);

    assert.equal(document.querySelector("#rules").children.length, 0);
    assert.equal(document.querySelector("#empty").hidden, false);
  });

  test("the select of each row reflects the stored position", async () => {
    const browser = fakeBrowser({ settings: SETTINGS });
    const { document } = await openOptions(browser);

    const rows = [...document.querySelectorAll("#rules tr")];
    assert.equal(rows[0].querySelector("select").value, "above"); // @company.com
    assert.equal(rows[1].querySelector("select").value, "below"); // john@…
  });

  test("adding a valid rule saves it and clears the field", async () => {
    const browser = fakeBrowser({ settings: { version: 1, rules: {}, defaultAction: "none" } });
    const { document, window } = await openOptions(browser);

    document.querySelector("#key").value = "  New@Example.COM ";
    document.querySelector("#position").value = "below";
    document.querySelector("#add").dispatchEvent(
      new window.Event("submit", { cancelable: true }),
    );
    await flush();
    await flush();

    const remember = browser.calls.find((c) => c.message?.type === "remember");
    assert.equal(remember.message.key, "new@example.com", "normalized key");
    assert.equal(remember.message.position, "below");
    assert.equal(document.querySelector("#key").value, "");
    assert.equal(document.querySelector("#add-error").hidden, true);
  });

  test("an invalid key shows the error and saves nothing", async () => {
    const browser = fakeBrowser({ settings: { version: 1, rules: {}, defaultAction: "none" } });
    const { document, window } = await openOptions(browser);

    document.querySelector("#key").value = "not-an-address";
    document.querySelector("#add").dispatchEvent(
      new window.Event("submit", { cancelable: true }),
    );
    await flush();

    assert.equal(document.querySelector("#add-error").hidden, false);
    assert.equal(
      browser.calls.some((c) => c.message?.type === "remember"),
      false,
    );
  });

  test("deleting a rule removes it from the table", async () => {
    const browser = fakeBrowser({ settings: SETTINGS });
    const { document } = await openOptions(browser);

    document.querySelector("#rules tr td:last-child button").click();
    await flush();
    await flush();

    const forget = browser.calls.find((c) => c.message?.type === "forget");
    assert.equal(forget.message.key, "@company.com");
    assert.deepEqual(Object.keys(browser.settings.rules), ["john@company.com"]);
  });

  test("changing a position from the table saves it again", async () => {
    const browser = fakeBrowser({ settings: SETTINGS });
    const { document, window } = await openOptions(browser);

    const select = document.querySelector("#rules tr select");
    select.value = "below";
    select.dispatchEvent(new window.Event("change"));
    await flush();
    await flush();

    const remember = browser.calls.find((c) => c.message?.type === "remember");
    assert.equal(remember.message.key, "@company.com");
    assert.equal(remember.message.position, "below");
  });

  test("changing the default position saves it", async () => {
    const browser = fakeBrowser({ settings: SETTINGS });
    const { document, window } = await openOptions(browser);

    const byDefault = document.querySelector("#default");
    byDefault.value = "above";
    byDefault.dispatchEvent(new window.Event("change"));
    await flush();

    const call = browser.calls.find((c) => c.message?.type === "default");
    assert.equal(call.message.position, "above");
  });

  test("the signature setting is displayed and saved", async () => {
    const browser = fakeBrowser({ settings: { ...SETTINGS, signature: "bottom" } });
    const { document, window } = await openOptions(browser);

    const signature = document.querySelector("#signature");
    assert.equal(signature.value, "bottom");

    signature.value = "reply";
    signature.dispatchEvent(new window.Event("change"));
    await flush();

    const call = browser.calls.find((c) => c.message?.type === "signature");
    assert.equal(call.message.value, "reply");
    assert.equal(browser.settings.signature, "reply");
  });

  test("a rule key is never interpreted as markup", async () => {
    /* Keys can come from an imported file: they are set through textContent. */
    const browser = fakeBrowser({
      settings: {
        version: 1,
        rules: { "<img src=x onerror=alert(1)>@example.com": "above" },
        defaultAction: "none",
      },
    });
    const { document } = await openOptions(browser);

    const cell = document.querySelector("#rules tr td:first-child");
    assert.equal(cell.querySelector("img"), null);
    assert.match(cell.textContent, /^<img/);
  });
});
