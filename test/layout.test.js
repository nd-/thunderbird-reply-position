/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Tests of lib/layout.js against the fixtures captured in Thunderbird 153 by
 * test/integration/. To regenerate the fixtures: npm run capture && npm run fixtures.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { load, loadWithFixture } from "./loader.js";

const open = (fixture) => loadWithFixture(["lib/layout.js"], fixture);

/* For the bodies no capture covers: message with no quote, empty body. */
const loadBody = async (body) => {
  const { JSDOM } = await import("jsdom");
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`);
  const { Layout } = load(["lib/layout.js"], {
    window: dom.window,
    document: dom.window.document,
    getSelection: () => dom.window.getSelection(),
  });
  return { Layout, document: dom.window.document, window: dom.window };
};

/* Signature of the body order, readable in a failure message: every direct child of body is
 * reduced to a short name. */
const outline = (document) =>
  [...document.body.childNodes]
    .filter((n) => !(n.nodeType === 3 && n.textContent.trim() === ""))
    .map((n) => {
      if (n.nodeType === 3) return "text";
      if (n.classList?.contains("moz-cite-prefix")) return "prefix";
      if (n.classList?.contains("moz-signature")) return "signature";
      if (n.classList?.contains("moz-forward-container")) return "forward";
      if (n.matches?.('blockquote[type="cite"]')) return "quote";
      if (n.tagName === "SPAN") return "plain-quote";
      return n.tagName.toLowerCase();
    })
    .join(" · ");

describe("analysis of the fixtures", () => {
  const expected = [
    ["reply-html-above.html", "above", "p · prefix · quote"],
    ["reply-html-below.html", "below", "prefix · quote · p"],
    ["reply-html-selection.html", "absent", "prefix · quote"],
    ["reply-html-dirty.html", "above", "p · prefix · quote"],
    ["reply-html-sig-bottom.html", "above", "p · prefix · quote · signature"],
    ["reply-html-sig-top.html", "above", "p · signature · prefix · quote"],
    ["reply-html-below-sig-bottom.html", "below", "prefix · quote · p · signature"],
    ["reply-html-below-sig-top.html", "below", "prefix · quote · p · signature"],
    [
      "reply-plaintext-below-sig-bottom.html",
      "below",
      "prefix · plain-quote · br · br · signature",
    ],
    [
      "reply-plaintext-below-sig-top.html",
      "below",
      "prefix · plain-quote · br · br · signature",
    ],
    ["reply-plaintext.html", "above", "br · br · prefix · plain-quote · br"],
    ["reply-plaintext-below.html", "below", "prefix · plain-quote · br"],
    ["reply-plaintext-selection.html", "absent", "prefix · plain-quote"],
    ["forward-inline.html", "above", "p · forward"],
    ["forward-inline-plaintext.html", "above", "br · forward"],
  ];

  for (const [fixture, position, shape] of expected) {
    test(`${fixture} → ${position}`, async () => {
      const { Layout, document } = await open(fixture);
      assert.equal(outline(document), shape, "shape of the body");
      assert.equal(Layout.analyze(document).position, position);
    });
  }

  test("the quote block is recognized in HTML as well as in plain text", async () => {
    for (const fixture of ["reply-html-above.html", "reply-plaintext.html"]) {
      const { Layout, document } = await open(fixture);
      const { quote } = Layout.analyze(document);
      assert.notEqual(quote, null, fixture);
      assert.equal(quote.end - quote.start, 1, `${fixture}: prefix + body`);
    }
  });

  test("a forward has no cite prefix", async () => {
    const { Layout, document } = await open("forward-inline.html");
    const { quote } = Layout.analyze(document);
    assert.equal(quote.start, quote.end);
  });

  test("a signature in last position is spotted as such", async () => {
    const bottom = await open("reply-html-sig-bottom.html");
    assert.equal(bottom.Layout.analyze(bottom.document).signatureLast, true);
    const top = await open("reply-html-sig-top.html");
    assert.equal(top.Layout.analyze(top.document).signatureLast, false);
  });

  test("the signature anchor is only concluded when the body is unambiguous", async () => {
    const expected = [
      ["reply-html-sig-top.html", "reply"],
      ["reply-plaintext-sig-top.html", "reply"],
      ["reply-html-sig-bottom.html", "bottom"],
      ["reply-plaintext-sig.html", "bottom"],
      /* Writing area below the quote: both values of sig_bottom give the same body, the
       * fixtures show it, so there is nothing to conclude. */
      ["reply-html-below-sig-bottom.html", "unknown"],
      ["reply-html-below-sig-top.html", "unknown"],
      ["reply-plaintext-below-sig-bottom.html", "unknown"],
      ["reply-plaintext-below-sig-top.html", "unknown"],
      /* With no signature, there is nothing to anchor. */
      ["reply-html-above.html", null],
    ];

    for (const [fixture, anchor] of expected) {
      const { Layout, document } = await open(fixture);
      assert.equal(Layout.analyze(document).signatureAnchor, anchor, fixture);
    }
  });
});

describe("swap", () => {
  const swaps = [
    ["reply-html-above.html", "below", "prefix · quote · p"],
    ["reply-html-below.html", "above", "p · prefix · quote"],
    ["reply-html-dirty.html", "below", "prefix · quote · p"],
    ["forward-inline.html", "below", "forward · p"],
    ["forward-inline-plaintext.html", "below", "forward · br"],
  ];

  for (const [fixture, target, shape] of swaps) {
    test(`${fixture} → ${target}`, async () => {
      const { Layout, document } = await open(fixture);
      const result = Layout.apply(document, target, { plainText: false });
      assert.equal(result.changed, true);
      assert.equal(result.after, target);
      assert.equal(outline(document), shape);
    });
  }

  test("the content of the quote is intact after the move", async () => {
    const { Layout, document } = await open("reply-html-above.html");
    const before = document.querySelector('blockquote[type="cite"]').innerHTML;
    Layout.apply(document, "below", {});
    assert.equal(document.querySelector('blockquote[type="cite"]').innerHTML, before);
  });

  test("a swap then its opposite gives back the original shape", async () => {
    const { Layout, document } = await open("reply-html-above.html");
    const original = outline(document);
    Layout.apply(document, "below", {});
    Layout.apply(document, "above", {});
    assert.equal(outline(document), original);
  });
});

describe("signature", () => {
  /* What the compose script does: capture the anchor on the original body, then hand it
   * back on every swap. That capture is what survives the first swap, after which the body
   * says nothing anymore. */
  const anchorOf = async (fixture) => {
    const { Layout, document } = await open(fixture);
    return { Layout, document, anchor: Layout.analyze(document).signatureAnchor };
  };

  test("a signature at the bottom stays there, the quote slips in before it", async () => {
    const { Layout, document, anchor } = await anchorOf("reply-html-sig-bottom.html");
    Layout.apply(document, "below", { anchor });
    assert.equal(outline(document), "prefix · quote · p · signature");

    Layout.apply(document, "above", { anchor });
    assert.equal(outline(document), "p · prefix · quote · signature");
  });

  test("a signature attached to the writing area follows it", async () => {
    /* sig_bottom false: the signature belongs to the writing block and has to go down with
     * it, otherwise it would end up in the middle of the quote. */
    const { Layout, document, anchor } = await anchorOf("reply-html-sig-top.html");
    Layout.apply(document, "below", { anchor });
    assert.equal(outline(document), "prefix · quote · p · signature");
  });

  test("and it comes back up with it: a swap then its opposite", async () => {
    /* The defect reported after trying it in Thunderbird: once moved down, the signature
     * never came back up, the swapped body no longer allowing it to be attached to the
     * writing area. */
    const { Layout, document, anchor } = await anchorOf("reply-html-sig-top.html");
    const original = outline(document);

    Layout.apply(document, "below", { anchor });
    Layout.apply(document, "above", { anchor });
    assert.equal(outline(document), original);
  });

  test("in plain text too", async () => {
    const bottom = await anchorOf("reply-plaintext-sig.html");
    bottom.Layout.apply(bottom.document, "below", { plainText: true, anchor: bottom.anchor });
    assert.match(outline(bottom.document), /^prefix · plain-quote/);
    assert.match(outline(bottom.document), /signature/);

    const top = await anchorOf("reply-plaintext-sig-top.html");
    top.Layout.apply(top.document, "below", {
      plainText: true,
      anchor: top.anchor,
    });
    const swapped = outline(top.document);
    top.Layout.apply(top.document, "above", {
      plainText: true,
      anchor: top.anchor,
    });
    assert.match(swapped, /^prefix · plain-quote/);
    assert.match(outline(top.document), /signature · prefix · plain-quote/);
  });
});

describe("signature whose anchor was never observable", () => {
  /* Composer opened with the writing area below the quote: the body is the same whatever
   * the value of sig_bottom, and it already is at opening time. Only the user setting can
   * decide. */
  const cases = [
    ["reply-html-below-sig-bottom.html", false, "p"],
    ["reply-plaintext-below-sig-bottom.html", true, "br · br"],
  ];

  for (const [fixture, plainText, writingArea] of cases) {
    test(`${fixture}: "reply" makes the signature follow`, async () => {
      const { Layout, document } = await open(fixture);
      const anchor = Layout.analyze(document).signatureAnchor;
      assert.equal(anchor, "unknown");

      Layout.apply(document, "above", { plainText, anchor, signature: "reply" });
      assert.equal(
        outline(document),
        `${writingArea} · signature · prefix · ${plainText ? "plain-quote" : "quote"}`,
      );
    });

    test(`${fixture}: "bottom" leaves it at the bottom`, async () => {
      const { Layout, document } = await open(fixture);
      const anchor = Layout.analyze(document).signatureAnchor;

      Layout.apply(document, "above", { plainText, anchor, signature: "bottom" });
      assert.equal(
        outline(document),
        `${writingArea} · prefix · ${plainText ? "plain-quote" : "quote"} · signature`,
      );
    });
  }

  test("with no setting, the signature follows the reply", async () => {
    const { Layout, document } = await open("reply-html-below-sig-top.html");
    Layout.apply(document, "above", {});
    assert.equal(outline(document), "p · signature · prefix · quote");
  });
});

describe("plain text", () => {
  test("the quote goes to the top and the writing area behind it", async () => {
    const { Layout, document } = await open("reply-plaintext.html");
    const result = Layout.apply(document, "below", { plainText: true });
    assert.equal(result.changed, true);
    assert.equal(outline(document), "prefix · plain-quote · br · br · br");
  });

  test("and it comes back to the top the other way round", async () => {
    const { Layout, document } = await open("reply-plaintext-below.html");
    Layout.apply(document, "above", { plainText: true });
    assert.equal(outline(document), "br · prefix · plain-quote");
  });

  test("the quoted text is not altered", async () => {
    const { Layout, document } = await open("reply-plaintext.html");
    const before = document.querySelector("span").textContent;
    Layout.apply(document, "below", { plainText: true });
    assert.equal(document.querySelector("span").textContent, before);
  });
});

describe('"select the quote" mode', () => {
  test("a writing area is created above", async () => {
    const { Layout, document } = await open("reply-html-selection.html");
    const result = Layout.apply(document, "above", {});
    assert.equal(result.changed, true);
    assert.equal(result.before, "absent");
    assert.equal(outline(document), "p · prefix · quote");
  });

  test("and below", async () => {
    const { Layout, document } = await open("reply-html-selection.html");
    Layout.apply(document, "below", {});
    assert.equal(outline(document), "prefix · quote · p");
  });

  test("in plain text, the created writing area is a br", async () => {
    const { Layout, document } = await open("reply-plaintext-selection.html");
    Layout.apply(document, "below", { plainText: true });
    assert.equal(outline(document), "prefix · plain-quote · br");
  });

  test("the selection is collapsed, otherwise the first keystroke wipes the quote", async () => {
    const { Layout, document, window } = await open("reply-html-selection.html");
    const selection = window.getSelection();
    selection.removeAllRanges();
    const whole = document.createRange();
    whole.selectNodeContents(document.body);
    selection.addRange(whole);
    assert.equal(selection.isCollapsed, false, "selection extended to start with");

    Layout.apply(document, "below", {});
    assert.equal(selection.isCollapsed, true);
  });
});

describe("standing aside", () => {
  test("touches nothing when the position is already the right one", async () => {
    const { Layout, document } = await open("reply-html-above.html");
    const before = document.body.innerHTML;
    const result = Layout.apply(document, "above", {});
    assert.equal(result.changed, false);
    assert.equal(result.reason, "already");
    assert.equal(document.body.innerHTML, before);
  });

  test('touches nothing on a "none" or unknown target', async () => {
    const { Layout, document } = await open("reply-html-above.html");
    const before = document.body.innerHTML;
    for (const target of ["none", undefined, "middle"]) {
      assert.equal(Layout.apply(document, target, {}).changed, false);
    }
    assert.equal(document.body.innerHTML, before);
  });

  test("touches nothing on a message with no quote", async () => {
    const { Layout, document } = await loadBody("<p><br></p>");
    const result = Layout.apply(document, "below", {});
    assert.equal(result.changed, false);
    assert.equal(result.reason, "no-quote");
  });

  test("touches nothing on an empty body", async () => {
    const { Layout, document } = await loadBody("");
    const result = Layout.apply(document, "above", {});
    assert.equal(result.changed, false);
    assert.equal(result.reason, "no-quote");
  });
});

describe("cursor", () => {
  test("in HTML it goes into the writing paragraph", async () => {
    const { Layout, document, window } = await open("reply-html-below.html");
    Layout.apply(document, "above", {});
    const selection = window.getSelection();
    assert.equal(selection.isCollapsed, true);
    assert.equal(selection.anchorNode.tagName, "P");
    assert.equal(selection.anchorOffset, 0);
  });

  test("in plain text it anchors on body with an index offset", async () => {
    /* That is what Thunderbird does: the captures show an anchor on body, for lack of a
     * writing node to enter. */
    const { Layout, document, window } = await open("reply-plaintext.html");
    Layout.apply(document, "below", { plainText: true });
    const selection = window.getSelection();
    assert.equal(selection.isCollapsed, true);
    assert.equal(selection.anchorNode, document.body);
    assert.equal(selection.anchorOffset, 2);
  });
});
