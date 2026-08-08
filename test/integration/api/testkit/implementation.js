/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Experiment of the test harness. Does only what no WebExtension API allows: writing
 * identity preferences, injecting messages into a folder, writing a file on disk and
 * shutting Thunderbird down. No business logic here: this layer is not testable, it must
 * stay pure wiring.
 *
 * This extension is never published: Experiment APIs are forbidden on
 * addons.thunderbird.net.
 */

/* global ExtensionCommon, ChromeUtils, Components, Services, Ci, Cc, IOUtils, PathUtils,
   WebExtensionPolicy */

var { MailServices } = ChromeUtils.importESModule("resource:///modules/MailServices.sys.mjs");
var { ExtensionStorage } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionStorage.sys.mjs",
);
/* Only an ExtensionError lets its message through to the caller: any other exception is
 * replaced by "An unexpected error occurred", which makes a failure in this layer impossible
 * to diagnose. */
var { ExtensionError } = ChromeUtils.importESModule(
  "resource://gre/modules/ExtensionUtils.sys.mjs",
).ExtensionUtils;

const PREF_REPORT = "extensions.reply-position.reportPath";

const writePref = (name, value) => {
  switch (typeof value) {
    case "boolean":
      Services.prefs.setBoolPref(name, value);
      break;
    case "number":
      Services.prefs.setIntPref(name, value);
      break;
    case "string":
      Services.prefs.setStringPref(name, value);
      break;
    default:
      throw new ExtensionError(`Unsupported preference type for ${name}: ${typeof value}`);
  }
};

const readPref = (name) => {
  switch (Services.prefs.getPrefType(name)) {
    case Services.prefs.PREF_BOOL:
      return Services.prefs.getBoolPref(name);
    case Services.prefs.PREF_INT:
      return Services.prefs.getIntPref(name);
    case Services.prefs.PREF_STRING:
      return Services.prefs.getStringPref(name);
    default:
      return null;
  }
};

/* Inbox of the test account, the one carrying identity id1, hence the one whose compose
 * preferences drive the layout of replies. */
const inbox = () => {
  const account = MailServices.accounts.accounts.find(
    (a) => a.incomingServer?.type === "pop3",
  );
  if (!account) {
    throw new ExtensionError("No POP3 account in the test profile");
  }
  const folder = account.incomingServer.rootFolder.getFolderWithFlags(
    Ci.nsMsgFolderFlags.Inbox,
  );
  if (!folder) {
    throw new ExtensionError("Inbox not found");
  }
  return folder;
};

const tempFile = async (name, content) => {
  const path = PathUtils.join(PathUtils.tempDir, `tbreply-${Date.now()}-${name}`);
  await IOUtils.writeUTF8(path, content);
  const file = Cc["@mozilla.org/file/local;1"].createInstance(Ci.nsIFile);
  file.initWithPath(path);
  return file;
};

/* copyFileMessage is asynchronous and only hands control back through its listener. */
const copyIntoFolder = (file, folder) =>
  new Promise((resolve, reject) => {
    const listener = {
      QueryInterface: ChromeUtils.generateQI(["nsIMsgCopyServiceListener"]),
      onStartCopy() {},
      onProgress() {},
      setMessageKey() {},
      getMessageId() {},
      onStopCopy(status) {
        if (Components.isSuccessCode(status)) {
          resolve();
        } else {
          reject(new ExtensionError(`copyFileMessage failed: ${status}`));
        }
      },
    };
    MailServices.copy.copyFileMessage(
      file,
      folder,
      null, // no message to replace
      false, // neither a draft nor a template
      0, // no flag
      "", // no keyword
      listener,
      null, // no window: the import is silent
    );
  });

const extensionUrl = (extensionId, path) => {
  const policy = WebExtensionPolicy.getByID(extensionId);
  if (!policy) {
    throw new ExtensionError(`Extension ${extensionId} not found`);
  }
  return policy.getURL(path);
};

/* Finds the document of an already displayed extension page, whether it lives in a tab or in
 * the panel of a compose button.
 *
 * Assumes `extensions.webextensions.remote = false` in the profile: without it the document
 * lives in another process and `contentDocument` is null. */
const extensionDocument = (urlPattern) => {
  const candidates = [];
  for (const window of Services.wm.getEnumerator(null)) {
    for (const container of window.document.querySelectorAll("browser, iframe")) {
      let document_ = null;
      try {
        document_ = container.contentDocument;
      } catch {
        continue;
      }
      if (!document_?.URL) continue;
      candidates.push(document_.URL);
      if (document_.URL.includes(urlPattern)) {
        return document_;
      }
    }
  }
  throw new ExtensionError(
    `No document whose URL contains "${urlPattern}". Seen: ${candidates.join(", ") || "none"}`,
  );
};

/* Any exception that is not an ExtensionError surfaces as "An unexpected error occurred",
 * with no message and no stack: in a layer handling XUL and documents of other extensions,
 * that is untenable to diagnose. Every function is therefore wrapped. */
const surfaceErrors = (api) =>
  Object.fromEntries(
    Object.entries(api).map(([name, fn]) => [
      name,
      async (...arguments_) => {
        try {
          return await fn(...arguments_);
        } catch (e) {
          throw new ExtensionError(`${name}: ${e.message}\n${e.stack ?? ""}`);
        }
      },
    ]),
  );

var testkit = class extends ExtensionCommon.ExtensionAPI {
  getAPI() {
    return {
      testkit: surfaceErrors({
        async setPrefs(prefs) {
          for (const [name, value] of Object.entries(prefs)) {
            writePref(name, value);
          }
        },

        async getPref(name) {
          return readPref(name);
        },

        async importMessages(messages) {
          const folder = inbox();
          for (const { name, content } of messages) {
            const file = await tempFile(name, content);
            try {
              await copyIntoFolder(file, folder);
            } finally {
              await IOUtils.remove(file.path, { ignoreAbsent: true });
            }
          }
          /* The message database is not necessarily written to disk at this point; without
           * this flush, an immediate query can return nothing. */
          folder.updateFolder(null);
          return messages.length;
        },

        async openExtensionPage(extensionId, path) {
          const url = extensionUrl(extensionId, path);
          const window = Services.wm.getMostRecentWindow("mail:3pane");
          window.document.getElementById("tabmail").openTab("contentTab", { url });
          return url;
        },

        /* Describes the compose button of an extension and the panel carrying its popup.
         *
         * Does not open the popup, and not for lack of trying: a toolbar button only obeys a
         * trusted event, which neither `.click()` nor a `MouseEvent` built in JS produces.
         * `sendMouseEvent` is gone from nsIDOMWindowUtils in the Gecko of TB 153, and
         * `sendNativeMouseEvent` goes through the windowing system without reaching the
         * button. `composeAction.openPopup()` can only be called by the extension that owns
         * the button.
         *
         * What stays verifiable here: the button exists, and Thunderbird did attach a panel
         * to it. The content of the popup is verified under jsdom
         * (`test/interfaces.test.js`) and, before publication, by hand. */
        async inspectComposeAction(extensionId) {
          const window = Services.wm.getMostRecentWindow("msgcompose");
          if (!window) {
            throw new ExtensionError("No compose window open");
          }
          const prefix = extensionId.replace(/[^a-z0-9_-]/gi, "_");
          const button = window.document.querySelector(
            `[id^="${prefix}"][id*="composeAction"]`,
          );
          if (!button) {
            const ids = [...window.document.querySelectorAll("[id*='composeAction']")]
              .map((n) => n.id)
              .join(", ");
            throw new ExtensionError(`No button found for ${prefix}. Candidates: ${ids || "none"}`);
          }
          const rect = button.getBoundingClientRect();
          const style = window.getComputedStyle(button);
          return {
            button: button.id,
            visible: rect.width > 0 && rect.height > 0,
            label: button.getAttribute("label") ?? button.getAttribute("tooltiptext"),
            /* Which icon file Thunderbird actually resolved, and the three variables it picks
             * from. That is the only way to tell what `theme_icons` really does: the two names
             * are swapped once in ExtensionParent and used swapped again in the stylesheet. */
            icon: style.listStyleImage,
            /* Which branch of webextensions.css is live: the media query, or the `lwtheme`
             * attribute a built-in theme puts on the root. */
            prefersDark: window.matchMedia("(prefers-color-scheme: dark)").matches,
            rootAttributes: [...window.document.documentElement.attributes]
              .map((a) => (a.value ? `${a.name}=${a.value}` : a.name))
              .join(" "),
            /* Is `context-fill` fed here? If the button, or the image inside it, carries
             * -moz-context-properties with a fill, one monochrome file would follow the theme
             * on its own and theme_icons would be pointless. */
            contextFill: (() => {
              const inner = button.querySelector(".toolbarbutton-icon") ?? button;
              const innerStyle = window.getComputedStyle(inner);
              return {
                buttonProperties: style.getPropertyValue("-moz-context-properties"),
                buttonFill: style.getPropertyValue("fill"),
                buttonColor: style.getPropertyValue("color"),
                iconProperties: innerStyle.getPropertyValue("-moz-context-properties"),
                iconFill: innerStyle.getPropertyValue("fill"),
                iconColor: innerStyle.getPropertyValue("color"),
              };
            })(),
            iconVariables: {
              default: style.getPropertyValue("--webextension-toolbar-image").trim(),
              light: style.getPropertyValue("--webextension-toolbar-image-light").trim(),
              dark: style.getPropertyValue("--webextension-toolbar-image-dark").trim(),
            },
          };
        },

        async readPage(urlPattern, selectors) {
          const document_ = extensionDocument(urlPattern);
          const elements = {};
          for (const selector of selectors) {
            const node = document_.querySelector(selector);
            elements[selector] = node
              ? {
                  exists: true,
                  text: node.textContent.trim(),
                  value: node.value ?? null,
                  checked: node.checked ?? null,
                  hidden: Boolean(node.hidden),
                  count: document_.querySelectorAll(selector).length,
                }
              : { exists: false };
          }
          return { url: document_.URL, elements };
        },

        async actOnPage(urlPattern, actions) {
          const document_ = extensionDocument(urlPattern);
          const window = document_.defaultView;
          for (const { selector, action, value } of actions) {
            const node = document_.querySelector(selector);
            if (!node) {
              throw new ExtensionError(`Selector matching nothing: ${selector}`);
            }
            switch (action) {
              case "click":
                node.click();
                break;
              case "check":
                node.checked = value !== false;
                node.dispatchEvent(new window.Event("change", { bubbles: true }));
                break;
              case "type":
                node.value = value;
                node.dispatchEvent(new window.Event("input", { bubbles: true }));
                break;
              case "select":
                node.value = value;
                node.dispatchEvent(new window.Event("change", { bubbles: true }));
                break;
              case "submit":
                node.dispatchEvent(
                  new window.Event("submit", { bubbles: true, cancelable: true }),
                );
                break;
              default:
                throw new ExtensionError(`Unknown action: ${action}`);
            }
          }
          return actions.length;
        },

        /* The storage.local of an extension is walled off: no API allows writing into it
         * from another one. Going through ExtensionStorage avoids adding to the published
         * extension a message channel that would exist only for the tests. */
        async setStorage(extensionId, items) {
          await ExtensionStorage.set(extensionId, items);
        },

        async getStorage(extensionId) {
          return ExtensionStorage.get(extensionId, null);
        },

        async consoleMessages() {
          return Services.console.getMessageArray().map((message) => {
            const error = message.QueryInterface
              ? (() => {
                  try {
                    return message.QueryInterface(Ci.nsIScriptError);
                  } catch {
                    return null;
                  }
                })()
              : null;
            return error
              ? {
                  text: error.errorMessage,
                  source: error.sourceName,
                  line: error.lineNumber,
                  category: error.category,
                }
              : { text: message.message ?? String(message) };
          });
        },

        async writeReport(report) {
          const path = readPref(PREF_REPORT);
          if (!path) {
            throw new ExtensionError(`Preference ${PREF_REPORT} missing from the profile`);
          }
          await IOUtils.writeJSON(path, report);
          return path;
        },

        async quit() {
          Services.startup.quit(
            Services.startup.eAttemptQuit | Services.startup.eForceQuit,
          );
        },
      }),
    };
  }
};
