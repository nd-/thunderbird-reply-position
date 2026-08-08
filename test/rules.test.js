/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { load } from "./loader.js";

const { Rules } = load(["lib/rules.js"]);

const SETTINGS = {
  version: 1,
  rules: {
    "alex@example.com": "below",
    "@example.com": "above",
    "@lists.example.org": "below",
  },
  defaultAction: "none",
};

describe("resolution", () => {
  test("the exact address wins over the domain", () => {
    assert.equal(Rules.resolve(SETTINGS, "alex@example.com"), "below");
  });

  test("the domain applies when no exact address matches", () => {
    assert.equal(Rules.resolve(SETTINGS, "sam@example.com"), "above");
  });

  test("with no rule, the default position", () => {
    assert.equal(Rules.resolve(SETTINGS, "unknown@example.net"), "none");
    assert.equal(
      Rules.resolve({ ...SETTINGS, defaultAction: "above" }, "unknown@example.net"),
      "above",
    );
  });

  test("case and whitespace change nothing", () => {
    assert.equal(Rules.resolve(SETTINGS, "  ALEX@Example.COM "), "below");
    assert.equal(Rules.resolve(SETTINGS, "SAM@EXAMPLE.COM"), "above");
  });

  test("a missing or malformed address falls back to the default", () => {
    /* "@example.com" is a rule key, not an address: passed as a recipient it must not match
     * the domain rule of the same name. */
    for (const value of ["", null, undefined, "not-an-address", "@example.com", 42]) {
      assert.equal(Rules.resolve(SETTINGS, value), "none");
    }
  });

  test("empty settings do not break resolution", () => {
    assert.equal(Rules.resolve({}, "alex@example.com"), "none");
    assert.equal(Rules.resolve(undefined, "alex@example.com"), "none");
  });

  test("a subdomain does not match the parent domain", () => {
    /* A rule on @example.com must not decide for @branch.example.com: those are different
     * correspondents, and the extension has no business assuming otherwise. */
    assert.equal(Rules.resolve(SETTINGS, "alex@branch.example.com"), "none");
  });
});

describe("explanation", () => {
  test("tells where the chosen position comes from", () => {
    assert.deepEqual(Rules.explain(SETTINGS, "alex@example.com"), {
      position: "below",
      source: "contact",
      key: "alex@example.com",
    });
    assert.deepEqual(Rules.explain(SETTINGS, "sam@example.com"), {
      position: "above",
      source: "domain",
      key: "@example.com",
    });
    assert.deepEqual(Rules.explain(SETTINGS, "unknown@example.net"), {
      position: "none",
      source: "default",
      key: null,
    });
  });
});

describe("recipient", () => {
  test("a string is usable", () => {
    assert.equal(
      Rules.usableAddress("Alex <alex@example.com>"),
      "Alex <alex@example.com>",
    );
  });

  test("a recipient coming from the address book is discarded", () => {
    /* {nodeId} would require the addressBook permission: the extension does nothing. */
    assert.equal(Rules.usableAddress({ nodeId: "abc", type: "contact" }), null);
    assert.equal(Rules.usableAddress(undefined), null);
  });
});

describe("writing rules", () => {
  test("adds a contact rule and a domain rule", () => {
    const added = Rules.withRule(SETTINGS, "New@Example.org", "above");
    assert.equal(added.rules["new@example.org"], "above");
    assert.equal(Rules.withRule(SETTINGS, "@example.org", "below").rules["@example.org"], "below");
  });

  test("does not modify the settings it receives", () => {
    const before = JSON.stringify(SETTINGS);
    Rules.withRule(SETTINGS, "other@example.org", "above");
    Rules.withoutRule(SETTINGS, "alex@example.com");
    assert.equal(JSON.stringify(SETTINGS), before);
  });

  test("refuses an invalid key or position", () => {
    assert.throws(() => Rules.withRule(SETTINGS, "not-an-address", "above"));
    assert.throws(() => Rules.withRule(SETTINGS, "alex@example.com", "middle"));
    assert.throws(() => Rules.withRule(SETTINGS, "alex@example.com", "none"));
  });

  test("removes a rule, including one written in another case", () => {
    const without = Rules.withoutRule(SETTINGS, "ALEX@example.COM");
    assert.equal("alex@example.com" in without.rules, false);
    assert.equal(Rules.resolve(without, "alex@example.com"), "above");
  });
});

describe("validation of an imported file", () => {
  test("keeps valid entries and reports the others", () => {
    const { settings, rejected } = Rules.validate({
      version: 1,
      rules: {
        "Good@Example.com": "above",
        "@example.com": "below",
        "not-an-address": "above",
        "other@example.com": "middle",
      },
      defaultAction: "below",
    });

    assert.deepEqual(settings.rules, {
      "good@example.com": "above",
      "@example.com": "below",
    });
    assert.equal(settings.defaultAction, "below");
    assert.deepEqual(rejected, [
      { key: "not-an-address", reason: "key" },
      { key: "other@example.com", reason: "position" },
    ]);
  });

  test("an empty or nonsensical file gives the default settings", () => {
    for (const raw of [{}, null, undefined, { rules: "anything" }, []]) {
      const { settings } = Rules.validate(raw);
      assert.deepEqual(settings, {
        version: 1,
        rules: {},
        defaultAction: "none",
        signature: "reply",
      });
    }
  });

  test("an unknown default action falls back to leaving things alone", () => {
    assert.equal(Rules.validate({ defaultAction: "middle" }).settings.defaultAction, "none");
  });

  test("the signature setting is kept, or brought back to the default", () => {
    assert.equal(Rules.validate({ signature: "bottom" }).settings.signature, "bottom");
    assert.equal(Rules.validate({ signature: "reply" }).settings.signature, "reply");
    assert.equal(Rules.validate({ signature: "middle" }).settings.signature, "reply");
    /* An export from the first version has no such key: it stays importable. */
    assert.equal(
      Rules.validate({ version: 1, rules: {}, defaultAction: "above" }).settings.signature,
      "reply",
    );
  });
});
