# Reply position per recipient

Thunderbird extension that places the writing area **above or below the quote depending on
the recipient**, with a toggle button in the compose window.

Thunderbird only offers that setting globally, per identity
(`mail.identity.idN.reply_on_top`). Yet some correspondents reply above the quote and others
below, and the right habit depends on who you are writing to, not on the account you use.

Manifest V3, Thunderbird 140 ESR and later. MPL-2.0 licence.

## How it works

A rule maps an address or a domain to a position:

```
john@company.com  → below the quote
@company.com      → above the quote
```

When a reply opens, the **first address of the "To" field** decides. Resolution goes from the
exact address to the domain, then to the default position. That default position is "leave
unchanged": with no matching rule, Thunderbird's native behaviour stays intact.

The button in the compose window switches the position and offers to remember the choice for
the contact or for their whole domain.

Rules are stored in the `storage.local` of the extension. The address book is neither read nor
modified.

### Signature

When the reply moves, the signature follows it if it is visibly attached to it, and stays at
the bottom if it closes the message. The original layout is enough to tell in most cases.

It is not enough when the window already opens with the reply below the quote: the signature
that goes along with the text and the one that ends the message then occupy the same place, and
Thunderbird gives an extension no way to read the corresponding setting. A setting on the
options page decides that case, by default in favour of the reply text.

## Known limitations

- **A recipient picked from the address book is not resolved.** It comes in as
  `{nodeId, type}` rather than in clear text, and resolving it would require the `addressBook`
  permission, which the extension does not ask for. It then stands aside.
- **Only the first address of the "To" field is consulted.** Other recipients and the "Cc"
  fields are ignored.
- **A forward opens with no recipient**: no rule can apply as long as the "To" field is empty.
  The toggle button stays available, and a default position other than "leave unchanged" will
  apply.
- In **"select the quote"** mode, the composer has no writing area. When a rule applies, the
  extension creates one and collapses the selection: the quote is preserved, but the habit of
  overwriting it by typing disappears for that correspondent.

## Development

```bash
npm install
npm test            # unit tests under jsdom, without Thunderbird
npm run capture     # captures the DOM Thunderbird produces, in a disposable profile
npm run verify      # loads the extension in Thunderbird and checks its effect
```

`npm run capture` and `npm run verify` start Thunderbird headless, on a fresh profile created
for the occasion, with no network and no mail account. See
[test/integration/README.md](test/integration/README.md).

The publishable extension lives in `src/`, separate from the test tooling. The testable logic
lives in `src/lib/`: `rules.js` takes an address and returns a position, `layout.js` takes a
document and rearranges it. Neither of them calls `browser.*`.

Manual loading: *Add-ons → Debug → Load Temporary Add-on*, then `src/manifest.json`. Always in
a dedicated profile: the extension rewrites the body of the messages being composed.
