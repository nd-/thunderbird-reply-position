/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Loads the files of src/lib/ for the tests.
 *
 * Thunderbird injects several scripts into one shared global scope: `lib/rules.js` then
 * `background.js`, `lib/layout.js` then `compose-script.js`. Loading them the same way here
 * avoids writing the libraries as ES modules, which compose scripts cannot load, and makes
 * the tests run against exactly the file that ships.
 *
 * The sources are concatenated then evaluated inside a function, which reproduces the
 * shared scope without polluting the global of the test process. Evaluation happens in the
 * current realm: the returned objects are then comparable with assert.deepEqual, which
 * would not be the case in a separate vm context.
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export const SRC = join(ROOT, "src");
export const FIXTURES = join(ROOT, "test", "fixtures");

const EXPOSED_NAMES = ["Rules", "Layout"];

export const load = (files, context = {}) => {
  const sources = files
    .map((file) => readFileSync(join(SRC, file), "utf8"))
    .join("\n;\n");

  const params = Object.keys(context);
  const returned = EXPOSED_NAMES.map(
    (name) => `${name}: typeof ${name} !== "undefined" ? ${name} : undefined`,
  ).join(", ");

  const factory = vm.runInThisContext(
    `(function (${params.join(", ")}) {\n${sources}\n;return { ${returned} };\n})`,
    { filename: files.join(" + ") },
  );

  return factory(...Object.values(context));
};

/* Loads an extension page (popup, options) into jsdom and evaluates its scripts there.
 *
 * jsdom does not run the `<script src>` tags of the page: that is on purpose, the scripts
 * are evaluated here with a fake `browser`, which makes API calls observable. The files are
 * given in the order of the HTML, the very order in which Thunderbird loads them. */
export const loadPage = async (htmlPath, files, browser) => {
  const { JSDOM } = await import("jsdom");
  const html = readFileSync(join(SRC, htmlPath), "utf8");
  const dom = new JSDOM(html, { url: "moz-extension://test/" });
  const window = dom.window;

  const libraries = load(files, {
    window,
    document: window.document,
    browser,
    URL: window.URL,
    Blob: window.Blob,
  });

  return { ...libraries, dom, window, document: window.document };
};

/* Loads a fixture into jsdom and returns the document along with the evaluated libraries:
 * inside them, `document`, `Node` and `getSelection` are those of the jsdom window, just as
 * they would be those of the composer in Thunderbird. */
export const loadWithFixture = async (files, fixtureName) => {
  const { JSDOM } = await import("jsdom");
  /* The fixture header describes the capture, it is not part of the body Thunderbird
   * produced: loading it would mean testing a DOM the composer never had. */
  const html = readFileSync(join(FIXTURES, fixtureName), "utf8").replace(
    /^<!--[\s\S]*?-->\n?/,
    "",
  );
  const dom = new JSDOM(`<!doctype html><html><body>${html}</body></html>`);
  const window = dom.window;

  const libraries = load(files, {
    window,
    document: window.document,
    Node: window.Node,
    getSelection: () => window.getSelection(),
  });

  return { ...libraries, dom, window, document: window.document };
};
