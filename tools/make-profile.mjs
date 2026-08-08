#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Builds a disposable Thunderbird profile for the integration tests.
 *
 * The profile holds nothing but a POP3 account pointing at a host that does not exist:
 * storage is local, no fetch is triggered, hence no network access. The test messages are
 * imported by the `testkit` Experiment into the inbox of that account.
 *
 * The profile is recreated from scratch on every call: no state survives from one run to
 * the next.
 */

import { rm, mkdir, writeFile, readFile, copyFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const PROFILE_PATH = join(ROOT, ".tmp", "profile");
export const REPORT_PATH = join(ROOT, ".tmp", "report.json");
const LANGPACK_CACHE = join(ROOT, ".tmp", "langpacks");
const LANGPACK_ID = "langpack-en-US@thunderbird.mozilla.org";

/* Address of the test identity. The `.invalid` domain is reserved by RFC 2606: it cannot be
 * resolved, which guarantees that no accidental send can go through. */
export const IDENTITY_ADDRESS = "test@thunderbird.invalid";

const prefs = (reportPath, mode, extensionId) => ({
  // — Dummy POP3 account: local storage, no automatic fetch —
  "mail.account.account1.server": "server1",
  "mail.account.account1.identities": "id1",
  "mail.server.server1.type": "pop3",
  "mail.server.server1.hostname": "pop.thunderbird.invalid",
  "mail.server.server1.name": IDENTITY_ADDRESS,
  "mail.server.server1.userName": "test",
  "mail.server.server1.port": 110,
  "mail.server.server1.check_new_mail": false,
  "mail.server.server1.login_at_startup": false,
  "mail.server.server1.download_on_biff": false,
  "mail.server.server1.directory-rel": "[ProfD]Mail/pop.thunderbird.invalid",

  // — Local folders: Thunderbird refuses to start without them —
  "mail.account.account2.server": "server2",
  "mail.server.server2.type": "none",
  "mail.server.server2.hostname": "Local Folders",
  "mail.server.server2.name": "Local Folders",
  "mail.server.server2.userName": "nobody",
  "mail.server.server2.directory-rel": "[ProfD]Mail/Local Folders",

  "mail.accountmanager.accounts": "account1,account2",
  "mail.accountmanager.defaultaccount": "account1",
  "mail.accountmanager.localfoldersserver": "server2",
  "mail.account.lastKey": 2,

  // — Identity driven by the harness (reply_on_top, sig_bottom, compose_html…) —
  "mail.identity.id1.useremail": IDENTITY_ADDRESS,
  "mail.identity.id1.fullName": "Test",
  "mail.identity.id1.valid": true,
  "mail.identity.id1.smtpServer": "smtp1",
  "mail.identity.id1.compose_html": true,
  "mail.identity.id1.reply_on_top": 1,
  "mail.identity.id1.sig_bottom": true,
  "mail.identity.id1.sig_on_reply": false,

  "mail.smtpserver.smtp1.hostname": "smtp.thunderbird.invalid",
  "mail.smtpserver.smtp1.port": 25,
  "mail.smtpserver.smtp1.username": "test",
  "mail.smtpservers": "smtp1",
  "mail.smtp.defaultserver": "smtp1",

  /* — Language of the strings Thunderbird writes into the body —
   *
   * The cite prefix and the forward header are written by Thunderbird, not by this
   * repository. Without pinning them, every contributor regenerates the fixtures in the
   * language of their own build and the diff drowns the real DOM changes.
   *
   * Asking for a locale is NOT enough, and that is worth knowing before trying again: the
   * Linux tarball is a single-language build. Its `chrome://…/locale/…` .properties files
   * exist in that language only, whatever `res/multilocale.txt` announces. Requesting en-US
   * does move the Fluent strings and the ICU date formatting, but the compose strings live
   * in composeMsgs.properties and stay put.
   *
   * Hence two levels: the locale below for the date format, and the five preferences that
   * carry the compose strings, overridden with their en-US wording. Those preferences
   * normally hold a chrome:// URL resolved through a string bundle; a literal value set in
   * the profile is returned as is, which is the documented way of customizing them.
   *
   * One thing stays out of reach: the Subject / Date / From / To labels of the header table
   * of an inline forward. They come from mime.properties (keys 1000, 1007, 1009, 1012), read
   * by libmime, with no preference attached. They only differ by four words, in two
   * fixtures, and carry no accented character in French. */
  "intl.locale.requested": "en-US",
  "intl.regional_prefs.use_os_locales": false,
  "mailnews.reply_header_authorwrotesingle": "#1 wrote:",
  "mailnews.reply_header_ondateauthorwrote": "On #2 #3, #1 wrote:",
  "mailnews.reply_header_authorwroteondate": "#1 wrote on #2 #3:",
  "mailnews.reply_header_originalmessage": "-------- Original Message --------",
  "mailnews.forward_header_originalmessage": "-------- Forwarded Message --------",

  // — Paths read by the `testkit` Experiment —
  "extensions.reply-position.reportPath": reportPath,
  /* "capture" records what Thunderbird produces on its own; "verify" loads the extension
   * and checks what it makes of it. */
  "extensions.reply-position.mode": mode,
  "extensions.reply-position.extensionId": extensionId ?? "",

  /* storage.local has two implementations: a JSON file and IndexedDB, the latter by
   * default. The Experiment of the harness writes the rules through ExtensionStorage, which
   * targets the JSON file: without this preference, the extension would read the other
   * backend and never see the rules set up for the test. */
  "extensions.webextensions.ExtensionStorageIDB.enabled": false,

  /* Extension pages have to live in the parent process: that is the condition for the
   * Experiment to reach their DOM and drive the popup and the options page. */
  "extensions.webextensions.remote": false,

  // — Loading an unsigned extension carrying an Experiment API —
  "extensions.experiments.enabled": true,
  "xpinstall.signatures.required": false,
  "extensions.autoDisableScopes": 0,
  "extensions.update.enabled": false,
  "devtools.debugger.remote-enabled": true,
  "devtools.debugger.prompt-connection": false,

  // — First-run screens, updates, telemetry —
  "mail.provider.suppress_dialog_on_startup": true,
  "mail.rights.version": 1,
  "mailnews.start_page.enabled": false,
  "mail.biff.show_alert": false,
  "mail.shell.checkDefaultClient": false,
  "browser.shell.checkDefaultBrowser": false,
  "app.update.auto": false,
  "app.update.enabled": false,
  "datareporting.policy.dataSubmissionEnabled": false,
  "datareporting.healthreport.uploadEnabled": false,
  "toolkit.telemetry.enabled": false,
  "browser.startup.homepage_override.mstone": "ignore",
  "extensions.pocket.enabled": false,

  // — Diagnostics: errors from the extension scripts land on stdout —
  "browser.dom.window.dump.enabled": true,
  "devtools.console.stdout.chrome": true,
  "javascript.options.showInConsole": true,
});

const format = (value) =>
  typeof value === "string" ? JSON.stringify(value) : String(value);

/* Installs the extension under test through a proxy file: a file named after its id, in the
 * `extensions/` directory of the profile, holding the path of its sources.
 *
 * This is the only setup that starts the extension like an ordinary installation.
 * `AddonManager.installTemporaryAddon` does enable it, but its MV3 background is an event
 * page: nothing wakes it up as long as no event occurs, and it has precisely not been able
 * to register a listener yet. Loaded at startup, it starts just like on the machine of a
 * user who has just launched Thunderbird. */
const installByProxy = async (profilePath) => {
  const extensionPath = process.env.TB_EXTENSION_PATH ?? join(ROOT, "src");
  const manifest = JSON.parse(
    await readFile(join(extensionPath, "manifest.json"), "utf8"),
  );
  const id = manifest.browser_specific_settings?.gecko?.id;
  if (!id) {
    throw new Error(`No gecko id in ${extensionPath}/manifest.json`);
  }

  const directory = join(profilePath, "extensions");
  await mkdir(directory, { recursive: true });
  await writeFile(join(directory, id), extensionPath, "utf8");
  return id;
};

/* Version of the binary that will actually be started, read from its own application.ini
 * rather than hard-coded: the language pack is tied to the Thunderbird series. */
const thunderbirdVersion = async () => {
  const binary = process.env.THUNDERBIRD_BIN ?? "/opt/thunderbird/thunderbird";
  const path = join(dirname(binary), "application.ini");
  const found = /^Version=(.+)$/m.exec(await readFile(path, "utf8"));
  if (!found) {
    throw new Error(`No Version= in ${path}`);
  }
  return found[1].trim();
};

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

/* Installs the en-US language pack into the disposable profile.
 *
 * Without it, the Subject / Date / From / To labels of the forward header table stay in the
 * language of the build: they come from mime.properties, which no preference addresses, and
 * a single-language build ships that file in one language only.
 *
 * The XPI is fetched once and kept in .tmp/langpacks/, which survives the profile being
 * rebuilt. It is signed by Mozilla and valid for the whole Thunderbird series
 * (strict_max_version "153.*"), so an update only costs a new download.
 *
 * Downloading is the only moment the harness touches the network, and it happens here, in
 * node, before Thunderbird starts. The profile itself stays offline: its POP3 account points
 * at a .invalid host. A failure is not fatal, see the caller. */
const installLangpack = async (profilePath) => {
  const version = await thunderbirdVersion();
  const cached = join(LANGPACK_CACHE, `en-US-${version}.xpi`);

  if (!(await exists(cached))) {
    /* The harness already assumes Linux, starting with the default binary path. */
    const url = `https://ftp.mozilla.org/pub/thunderbird/releases/${version}/linux-x86_64/xpi/en-US.xpi`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`${url} → HTTP ${response.status}`);
    }
    await mkdir(LANGPACK_CACHE, { recursive: true });
    await writeFile(cached, Buffer.from(await response.arrayBuffer()));
    console.log(`Language pack downloaded: ${cached}`);
  }

  const directory = join(profilePath, "extensions");
  await mkdir(directory, { recursive: true });
  await copyFile(cached, join(directory, `${LANGPACK_ID}.xpi`));
};

export const makeProfile = async ({
  profilePath = PROFILE_PATH,
  reportPath = REPORT_PATH,
  mode = "capture",
} = {}) => {
  await rm(profilePath, { recursive: true, force: true });
  await rm(reportPath, { force: true });
  await mkdir(join(profilePath, "Mail", "Local Folders"), { recursive: true });
  await mkdir(join(profilePath, "Mail", "pop.thunderbird.invalid"), { recursive: true });

  try {
    await installLangpack(profilePath);
  } catch (e) {
    console.warn(
      `Language pack unavailable (${e.message}). The run goes on, but the forward header ` +
        `labels will stay in the language of the build: do not commit the fixtures produced ` +
        `by this capture, test/fixtures.test.js will refuse them.`,
    );
  }

  const extensionId = mode === "verify" ? await installByProxy(profilePath) : null;

  const lines = Object.entries(prefs(reportPath, mode, extensionId)).map(
    ([name, value]) => `user_pref(${JSON.stringify(name)}, ${format(value)});`,
  );
  const header = "// Test profile regenerated by tools/make-profile.mjs, do not edit.\n";
  await writeFile(join(profilePath, "prefs.js"), header + lines.join("\n") + "\n", "utf8");

  /* `Inbox` and `Inbox.msf` have to exist before startup: without them, Thunderbird creates
   * the inbox on first access, which happens after the extension has started and makes the
   * message import fail. */
  for (const folder of ["Mail/Local Folders", "Mail/pop.thunderbird.invalid"]) {
    await writeFile(join(profilePath, folder, "Inbox"), "", "utf8");
  }

  return { profilePath, reportPath, extensionId };
};

if (import.meta.url === `file://${process.argv[1]}`) {
  const { profilePath, reportPath } = await makeProfile();
  console.log(`Profile : ${profilePath}`);
  console.log(`Report  : ${reportPath}`);
}
