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

describe("origin of the displayed position", () => {
  /* The popup shows the position read from the DOM, and next to it where it comes from. */
  /* [name, explanation, position, settled, expected] */
  const CASES = [
    [
      "a rule on the contact",
      { target: "below", source: "contact" },
      "below",
      "below",
      "popupRuleContact",
    ],
    [
      "a rule on the domain",
      { target: "above", source: "domain" },
      "above",
      "above",
      "popupRuleDomain",
    ],
    [
      "the default position",
      { target: "above", source: "default" },
      "above",
      "above",
      "popupRuleDefault",
    ],
    [
      "no rule and no default: Thunderbird keeps its own layout",
      { target: "none", source: "default" },
      "below",
      "below",
      "popupRuleUntouched",
    ],
    [
      "moved by hand away from a rule",
      { target: "below", source: "contact" },
      "above",
      "below",
      "popupRuleOverridden",
    ],
    [
      "moved by hand with no rule at all",
      /* The case the flag kept in the panel could not survive: with no rule the chosen
       * position and Thunderbird's own are told apart by `settled` alone. */
      { target: "none", source: "default" },
      "below",
      "above",
      "popupRuleOverridden",
    ],
    [
      "moved by hand, then moved back",
      { target: "none", source: "default" },
      "above",
      "above",
      "popupRuleUntouched",
    ],
  ];

  for (const [name, explanation, position, settled, expected] of CASES) {
    test(name, () => {
      assert.equal(Rules.originKey(explanation, position, settled), expected);
    });
  }

  test("without `settled`, a body contradicting its rule still reads as a hand move", () => {
    assert.equal(
      Rules.originKey({ target: "below", source: "contact" }, "above"),
      "popupRuleOverridden",
    );
  });

  test("a composer with no writing area is not attributed to the rule", () => {
    /* reply_on_top=2 opens with the quote selected and no writing paragraph at all. */
    assert.equal(
      Rules.originKey({ target: "below", source: "contact" }, "absent", "below"),
      "popupRuleOverridden",
    );
  });

  test("the return value of explain() is accepted as is", () => {
    /* explain() names the field `position`, the plan names it `target`: both go through. */
    assert.equal(
      Rules.originKey(Rules.explain(SETTINGS, "alex@example.com"), "below"),
      "popupRuleContact",
    );
  });
});

describe("rules already filed for an address", () => {
  test("both keys are reported, the contact one not hiding the domain one", () => {
    /* explain() only names the winner: the popup has to tick both boxes. */
    assert.deepEqual(Rules.rulesFor(SETTINGS, "alex@example.com"), {
      contact: "below",
      domain: "above",
    });
  });

  test("an address covered by its domain alone", () => {
    assert.deepEqual(Rules.rulesFor(SETTINGS, "sam@example.com"), {
      contact: null,
      domain: "above",
    });
    assert.equal(Rules.inheritsFromDomain(SETTINGS, "sam@example.com"), true);
  });

  test("an address with its own rule does not inherit", () => {
    assert.equal(Rules.inheritsFromDomain(SETTINGS, "alex@example.com"), false);
  });

  test("an address nothing covers", () => {
    assert.deepEqual(Rules.rulesFor(SETTINGS, "sam@example.net"), {
      contact: null,
      domain: null,
    });
    assert.equal(Rules.inheritsFromDomain(SETTINGS, "sam@example.net"), false);
  });

  test("case and whitespace do not hide a rule", () => {
    assert.deepEqual(Rules.rulesFor(SETTINGS, "  Alex@Example.COM "), {
      contact: "below",
      domain: "above",
    });
  });

  test("empty settings report nothing rather than failing", () => {
    assert.deepEqual(Rules.rulesFor(undefined, "alex@example.com"), {
      contact: null,
      domain: null,
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
