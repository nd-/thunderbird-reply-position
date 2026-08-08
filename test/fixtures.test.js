/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Guards the fixtures against being regenerated in another language.
 *
 * The cite prefix and the forward header are written by Thunderbird, in the language of its
 * build. The disposable profile pins the compose strings through the mailnews.*_header_*
 * preferences, installs the en-US language pack for the forward header labels, and the launch
 * pins TZ=UTC. The same capture then gives the same fixtures on any machine. A contributor
 * would otherwise regenerate them in their own language without noticing, and the next diff
 * would drown the real DOM changes.
 *
 * A capture that ran without the language pack, offline for instance, fails here: the forward
 * fixtures then carry the labels of the build.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { FIXTURES } from "./loader.js";

const REGENERATE =
  "Regenerate with: npm run capture && npm run fixtures. The disposable profile pins the " +
  "compose strings and installs the en-US language pack (tools/make-profile.mjs), and the " +
  "launch pins TZ=UTC (tools/run-integration.mjs). Check that the capture did not warn about " +
  "the language pack being unavailable.";

const files = readdirSync(FIXTURES).filter((name) => name.endsWith(".html"));

describe("fixtures are captured in English", () => {
  test("the directory is not empty", () => {
    assert.ok(files.length > 0, `No fixture in ${FIXTURES}. ${REGENERATE}`);
  });

  for (const file of files) {
    test(file, () => {
      const content = readFileSync(join(FIXTURES, file), "utf8");

      /* The .eml files and the test signature are pure ASCII, and so is everything Thunderbird
       * writes in en-US: any character outside that range comes from another language. The
       * non-breaking space French typography puts before a colon is caught by this too. */
      const foreign = content.match(/[^\x00-\x7F]/u);
      assert.equal(
        foreign,
        null,
        `Non-ASCII character ${JSON.stringify(foreign?.[0])} at index ${foreign?.index}: ` +
          `this fixture was captured in another locale. ${REGENERATE}`,
      );

      /* "wrote:" comes from the pinned preferences, "Subject" from the language pack: one
       * marker per mechanism, so that a failure says which one did not apply. */
      const markers = file.startsWith("forward-")
        ? ["Forwarded Message", "Subject"]
        : ["wrote:"];
      for (const marker of markers) {
        assert.ok(
          content.includes(marker),
          `Missing "${marker}": this fixture was captured in another language. ${REGENERATE}`,
        );
      }
    });
  }
});
