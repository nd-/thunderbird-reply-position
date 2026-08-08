# Integration harness

Test extension, **never published**: it embeds an Experiment API, which is forbidden on
addons.thunderbird.net. It is neither packaged nor submitted with the extension.

It is used to capture, without human intervention, what Thunderbird produces in the body of a
message being composed, for every combination of settings the compose API does not expose.

## Usage

```bash
npm run capture     # captures what Thunderbird produces on its own, report in .tmp/report.json
npm run verify      # loads the extension and checks the position it achieves
npm run fixtures    # capture report → test/fixtures/*.html
```

Environment variables:

| Variable | Effect |
|---|---|
| `TB_HEADLESS=0` | shows the windows instead of running headless |
| `TB_VERBOSE=1` | dumps the web-ext output on the console |
| `TB_TIMEOUT_MS` | guard delay before giving up (180 000 by default) |
| `THUNDERBIRD_BIN` | binary to start (`/opt/thunderbird/thunderbird` by default) |

On failure, the full launch output is in `.tmp/run.log`, and the report holds a timestamped log
of every step.

## How it holds together

- `tools/make-profile.mjs` builds a fresh profile: a POP3 account on a `.invalid` host, so no
  connection is possible and no accidental send can happen. The test messages are injected
  straight into the inbox.
- `web-ext run` installs the extension **temporarily**, through the remote debugging protocol.
  It is the click-free equivalent of *Load Temporary Add-on*: no signature verification, hence
  the Experiment API is accepted.
- `harness.js` runs through `MATRIX`, one case per entry. Every case resets the preferences to
  a neutral state before applying its own: no case inherits from the previous one.
- `probe.js` is injected by `browser.scripting.executeScript` and **returns** its capture: the
  value of the last expression of the file goes back to the caller, promise included.
- `api/testkit/` does only what no WebExtension API allows: writing preferences, importing an
  `.eml`, writing a file, shutting Thunderbird down. No business logic here, this layer not
  being testable.

## Fixtures identical from one machine to the next

The cite prefix and the forward header are written by Thunderbird, in the language of its
build, with a date formatted in the timezone of the process. Left alone, every contributor
would regenerate the fixtures in their own language and the diff would drown the real DOM
changes.

The profile therefore overrides the `mailnews.reply_header_*` and
`mailnews.forward_header_originalmessage` preferences with their en-US wording, installs the
en-US language pack for the labels of the forward header table, asks for
`intl.locale.requested = "en-US"` for the date format, and the launch pins `TZ=UTC`. Requesting
a locale is not enough on its own: the Linux tarball is a single-language build and its
`.properties` files only exist in that language.

The language pack is downloaded once, for the version of the targeted binary, and kept in
`.tmp/langpacks/`. That is the only network call of the harness, made before Thunderbird starts;
the profile itself stays offline. Running without network is still possible, the capture only
warns, but the fixtures it then produces are refused by the guard below.

`test/fixtures.test.js` fails if a fixture was captured outside of that setup, so `npm test`
catches it before the pull request does.

## Two setups, two pitfalls worth knowing

In `verify` mode, the extension is loaded through a **proxy file** in the `extensions/`
directory of the profile: a file named after its id, holding the path of its sources. It then
starts just like on the machine of an ordinary user.

Its rules are written by `testkit.setStorage`, which goes through `ExtensionStorage`, and that
one targets the **JSON file** backend of `storage.local`, whereas the default implementation is
IndexedDB. Hence `extensions.webextensions.ExtensionStorageIDB.enabled = false` in the profile.
Without that preference the extension reads an empty storage and seems to do nothing, with no
error anywhere.

The `console.*` calls of an extension surface neither in `testkit.consoleMessages()` nor in the
web-ext output. To observe an extension, read its `storage.local` from the Experiment.

## Adding a case

One entry in `MATRIX` for a capture, in `CHECKS` for a verification, with the wanted `.eml` in
`fixtures/`. The `Message-ID` of the file has to be
`<file-name-without-extension>@reply-position.invalid`: that is how the harness finds the
message again after the import.

In `verify` mode, the achieved position is computed by `observedPosition()`, from the raw
capture and **without going through `lib/layout.js`**: a test that checked the code against
itself would prove nothing.
