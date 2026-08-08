/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Rule resolution: which position for which recipient.
 *
 * Pure functions, no browser.* call. That is what makes them testable outside of
 * Thunderbird. The manifest loads this file before background.js and it exposes its API on
 * `Rules`; the tests load it through test/loader.js.
 */

var Rules = (() => {
  const POSITIONS = ["above", "below"];

  /* Where the signature goes on a swap, when the body gives no way to tell: with the reply
   * text, or at the bottom of the message. See `resolveAnchor` in lib/layout.js. */
  const SIGNATURES = ["reply", "bottom"];

  const DEFAULT_SETTINGS = {
    version: 1,
    rules: {},
    /* "none" means leave everything alone: with no rule, Thunderbird's native behaviour
     * must stay intact. */
    defaultAction: "none",
    signature: "reply",
  };

  /* Addresses come in with arbitrary case and whitespace; rule keys are stored normalized,
   * so that a rule entered as "John@Company.COM" matches a recipient "john@company.com". */
  const normalize = (value) =>
    typeof value === "string" ? value.trim().toLowerCase() : "";

  const isAddress = (value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);

  const isDomain = (value) => /^@[^@\s]+\.[^@\s]+$/.test(value);

  /* A rule key is either a full address or a domain prefixed with an at sign. Everything
   * else is refused, including when importing a rules file. */
  const isKey = (value) => isAddress(value) || isDomain(value);

  const domainOf = (address) => {
    const normalized = normalize(address);
    const at = normalized.lastIndexOf("@");
    return at === -1 ? "" : normalized.slice(at);
  };

  /* A ComposeRecipient is either a string, or a {nodeId, type} object when the address was
   * picked from the address book. Resolving a nodeId would require the addressBook
   * permission, which the extension does not ask for: in that case it does nothing, which
   * is an accepted and documented limitation, not a bug to work around. */
  const usableAddress = (recipient) =>
    typeof recipient === "string" ? recipient : null;

  /* Resolution: exact address, then domain, then default position. */
  const resolve = (settings, address) => {
    const full = { ...DEFAULT_SETTINGS, ...settings };
    const normalized = normalize(address);
    if (!isAddress(normalized)) {
      return full.defaultAction;
    }
    return (
      full.rules[normalized] ??
      full.rules[domainOf(normalized)] ??
      full.defaultAction
    );
  };

  /* Why that position was picked: the popup displays it, and it is also what makes an
   * unexpected behaviour explainable without reading the storage. */
  const explain = (settings, address) => {
    const full = { ...DEFAULT_SETTINGS, ...settings };
    const normalized = normalize(address);
    if (!isAddress(normalized)) {
      return { position: full.defaultAction, source: "default", key: null };
    }
    if (normalized in full.rules) {
      return { position: full.rules[normalized], source: "contact", key: normalized };
    }
    const domain = domainOf(normalized);
    if (domain in full.rules) {
      return { position: full.rules[domain], source: "domain", key: domain };
    }
    return { position: full.defaultAction, source: "default", key: null };
  };

  const withRule = (settings, key, position) => {
    const normalized = normalize(key);
    if (!isKey(normalized)) {
      throw new Error(`Invalid rule key: ${key}`);
    }
    if (!POSITIONS.includes(position)) {
      throw new Error(`Invalid position: ${position}`);
    }
    return {
      ...DEFAULT_SETTINGS,
      ...settings,
      rules: { ...settings?.rules, [normalized]: position },
    };
  };

  const withoutRule = (settings, key) => {
    const rules = { ...settings?.rules };
    delete rules[normalize(key)];
    return { ...DEFAULT_SETTINGS, ...settings, rules };
  };

  /* Filters an object coming from the outside (JSON import, storage written by an earlier
   * version): invalid entries are dropped one by one rather than failing the whole import,
   * and reported back to the caller. */
  const validate = (raw) => {
    const rejected = [];
    const rules = {};

    for (const [key, position] of Object.entries(raw?.rules ?? {})) {
      const normalized = normalize(key);
      if (!isKey(normalized)) {
        rejected.push({ key, reason: "key" });
      } else if (!POSITIONS.includes(position)) {
        rejected.push({ key, reason: "position" });
      } else {
        rules[normalized] = position;
      }
    }

    const defaultAction = [...POSITIONS, "none"].includes(raw?.defaultAction)
      ? raw.defaultAction
      : DEFAULT_SETTINGS.defaultAction;

    /* Key added after the first version: an older export stays importable, and gets the
     * default behaviour. */
    const signature = SIGNATURES.includes(raw?.signature)
      ? raw.signature
      : DEFAULT_SETTINGS.signature;

    return { settings: { version: 1, rules, defaultAction, signature }, rejected };
  };

  return {
    DEFAULT_SETTINGS,
    POSITIONS,
    SIGNATURES,
    normalize,
    isAddress,
    isDomain,
    isKey,
    domainOf,
    usableAddress,
    resolve,
    explain,
    withRule,
    withoutRule,
    validate,
  };
})();