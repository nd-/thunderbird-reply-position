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
    "john@company.com": "below",
    "@company.com": "above",
    "@lists.example.org": "below",
  },
  defaultAction: "none",
};

describe("resolution", () => {
  test("the exact address wins over the domain", () => {
    assert.equal(Rules.resolve(SETTINGS, "john@company.com"), "below");
  });

  test("the domain applies when no exact address matches", () => {
    assert.equal(Rules.resolve(SETTINGS, "mary@company.com"), "above");
  });

  test("with no rule, the default position", () => {
    assert.equal(Rules.resolve(SETTINGS, "unknown@elsewhere.net"), "none");
    assert.equal(
      Rules.resolve({ ...SETTINGS, defaultAction: "above" }, "unknown@elsewhere.net"),
      "above",
    );
  });

  test("case and whitespace change nothing", () => {
    assert.equal(Rules.resolve(SETTINGS, "  JOHN@Company.COM "), "below");
    assert.equal(Rules.resolve(SETTINGS, "MARY@COMPANY.COM"), "above");
  });

  test("a missing or malformed address falls back to the default", () => {
    for (const value of ["", null, undefined, "not-an-address", "@domain.com", 42]) {
      assert.equal(Rules.resolve(SETTINGS, value), "none");
    }
  });

  test("empty settings do not break resolution", () => {
    assert.equal(Rules.resolve({}, "john@company.com"), "none");
    assert.equal(Rules.resolve(undefined, "john@company.com"), "none");
  });

  test("a subdomain does not match the parent domain", () => {
    /* A rule on @company.com must not decide for @branch.company.com: those are different
     * correspondents, and the extension has no business assuming otherwise. */
    assert.equal(Rules.resolve(SETTINGS, "john@branch.company.com"), "none");
  });
});

describe("explanation", () => {
  test("tells where the chosen position comes from", () => {
    assert.deepEqual(Rules.explain(SETTINGS, "john@company.com"), {
      position: "below",
      source: "contact",
      key: "john@company.com",
    });
    assert.deepEqual(Rules.explain(SETTINGS, "mary@company.com"), {
      position: "above",
      source: "domain",
      key: "@company.com",
    });
    assert.deepEqual(Rules.explain(SETTINGS, "unknown@elsewhere.net"), {
      position: "none",
      source: "default",
      key: null,
    });
  });
});

describe("recipient", () => {
  test("a string is usable", () => {
    assert.equal(
      Rules.usableAddress("John <john@company.com>"),
      "John <john@company.com>",
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
    const added = Rules.withRule(SETTINGS, "New@Example.com", "above");
    assert.equal(added.rules["new@example.com"], "above");
    assert.equal(Rules.withRule(SETTINGS, "@example.com", "below").rules["@example.com"], "below");
  });

  test("does not modify the settings it receives", () => {
    const before = JSON.stringify(SETTINGS);
    Rules.withRule(SETTINGS, "other@example.com", "above");
    Rules.withoutRule(SETTINGS, "john@company.com");
    assert.equal(JSON.stringify(SETTINGS), before);
  });

  test("refuses an invalid key or position", () => {
    assert.throws(() => Rules.withRule(SETTINGS, "not-an-address", "above"));
    assert.throws(() => Rules.withRule(SETTINGS, "john@company.com", "middle"));
    assert.throws(() => Rules.withRule(SETTINGS, "john@company.com", "none"));
  });

  test("removes a rule, including one written in another case", () => {
    const without = Rules.withoutRule(SETTINGS, "JOHN@company.COM");
    assert.equal("john@company.com" in without.rules, false);
    assert.equal(Rules.resolve(without, "john@company.com"), "above");
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
