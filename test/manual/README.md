# Manual session in Thunderbird

`npm run capture` and `npm run verify` cover everything a machine can check. What is left needs
a real Thunderbird with someone at the keyboard: the listing screenshots, and the checks
gathered under *Still to do* in `TODO.md` — closing a composer without typing, changing
identity mid-composition, the visual rendering in both themes, a real send read back in the
received message.

This file describes how to build that session once, so that it is the same every time and
carries nothing personal into a public screenshot.

**Never in the production profile.** The add-on rewrites the body of messages being composed,
and a listing screenshot is published forever. Use a profile made for this, created once
through `thunderbird -P`, and referred to below as `$PROFILE`.

```bash
PROFILE=~/.thunderbird/<the dedicated profile>
```

Everything in steps 1 to 5 is written **while Thunderbird is closed**. Thunderbird rewrites
`prefs.js` on exit and scans `extensions/` at startup, so a file dropped in while it runs is
either ignored or lost.

## 1. An English interface

The Linux tarball is a single-language build. Asking for a locale moves the Fluent strings and
the date formatting, but not the `.properties` files, which exist in the build language only.
Two things are needed, and neither replaces the other:

```bash
mkdir -p "$PROFILE/extensions"
cp .tmp/langpacks/en-US-<version>.xpi \
   "$PROFILE/extensions/langpack-en-US@thunderbird.mozilla.org.xpi"
```

The version must match the binary, read from `/opt/thunderbird/application.ini`. `npm run
capture` already caches the right one in `.tmp/langpacks/`; otherwise it comes from
`https://ftp.mozilla.org/pub/thunderbird/releases/<version>/linux-x86_64/xpi/en-US.xpi`, signed
by Mozilla.

The preferences go into `$PROFILE/user.js`, which is applied at every start and undone by
deleting the file. Steps 1 to 5 all add to that same file.

```javascript
user_pref("intl.locale.requested", "en-US");
user_pref("intl.regional_prefs.use_os_locales", false);
/* Without this, an extension dropped into extensions/ starts disabled. */
user_pref("extensions.autoDisableScopes", 0);

/* The wording written above a quote: it comes from composeMsgs.properties, which stays in
 * the build language whatever the requested locale. */
user_pref("mailnews.reply_header_authorwrotesingle", "#1 wrote:");
user_pref("mailnews.reply_header_ondateauthorwrote", "On #2 #3, #1 wrote:");
user_pref("mailnews.reply_header_authorwroteondate", "#1 wrote on #2 #3:");
user_pref("mailnews.reply_header_originalmessage", "-------- Original Message --------");
user_pref("mailnews.forward_header_originalmessage", "-------- Forwarded Message --------");
```

**Two starts are needed the first time.** The language pack installs *during* the first start,
after locale negotiation has already run, so that start stays in the build language. The second
one comes up in English. Read the title of the main window to tell: `Inbox - …` and not its
translation.

## 2. An account that cannot reach anything

A profile connected to a real mailbox puts real names, real addresses and real conversations one
screenshot away from a public listing. Rather than deleting the real account, which is also the
only one able to perform the real send, add a second one and make it the default.

Both hostnames are under `.invalid`, reserved by RFC 2606 and answered by no resolver: this
account can neither fetch nor send, by construction. The identity uses `example.com`, reserved
by the same RFC, so the "From" line carries nothing real either.

```javascript
user_pref("mail.account.accountN.server", "serverN");
user_pref("mail.account.accountN.identities", "idN");
user_pref("mail.server.serverN.type", "pop3");
user_pref("mail.server.serverN.hostname", "pop.example.invalid");
user_pref("mail.server.serverN.name", "nico@example.com");
user_pref("mail.server.serverN.userName", "nico");
user_pref("mail.server.serverN.port", 110);
user_pref("mail.server.serverN.check_new_mail", false);
user_pref("mail.server.serverN.login_at_startup", false);
user_pref("mail.server.serverN.download_on_biff", false);
user_pref("mail.server.serverN.directory-rel", "[ProfD]Mail/pop.example.invalid");

user_pref("mail.identity.idN.useremail", "nico@example.com");
user_pref("mail.identity.idN.fullName", "Nico");
user_pref("mail.identity.idN.valid", true);
user_pref("mail.identity.idN.smtpServer", "smtpN");
user_pref("mail.identity.idN.compose_html", true);
/* Below the quote, so that an "above" rule visibly does something. */
user_pref("mail.identity.idN.reply_on_top", 0);
user_pref("mail.identity.idN.sig_on_reply", false);

user_pref("mail.smtpserver.smtpN.type", "smtp");
user_pref("mail.smtpserver.smtpN.hostname", "smtp.example.invalid");
user_pref("mail.smtpserver.smtpN.username", "nico");
user_pref("mail.smtpserver.smtpN.port", 587);
user_pref("mail.smtpservers", "<existing>,smtpN");

user_pref("mail.accountmanager.accounts", "<existing>,accountN");
user_pref("mail.accountmanager.defaultaccount", "accountN");
user_pref("mail.account.lastKey", N);
```

Replace `N` with the number after the highest one already in `prefs.js`; `mail.account.lastKey`
and the three `mail.accountmanager.*` keys have to be rewritten in full, listing what was
already there. Also create the directory the account points at:

```bash
mkdir -p "$PROFILE/Mail/pop.example.invalid"
```

The account wizard refuses hosts that resolve nowhere, hence writing the preferences directly.
Making this account the default is what gives a reply written from *Local Folders* the
`example.com` identity; the real account stays one click away, in the "From" dropdown of the
composer.

## 3. A message to reply to

Replying needs something to reply to, and it has to be as fabricated as the account. It goes
into the **inbox of that account**, `$PROFILE/Mail/pop.example.invalid/Inbox`, and not into
*Local Folders*, which is a separate tree that the account does not show. Write it as an mbox
file, starting with the `From ` separator line and ending with a blank line:

```
From - Sat Aug 08 18:07:00 2026
Message-ID: <b41c7e20-5f8a-4d31-9a6e-7c2f0d5e1a83@example.com>
Date: Sat, 8 Aug 2026 18:07:00 +0000
From: Alex Martin <alex@example.com>
To: Nico <nico@example.com>
Subject: Draft agenda for Thursday
MIME-Version: 1.0
Content-Type: text/plain; charset=UTF-8
Content-Transfer-Encoding: 7bit
X-Mozilla-Status: 0001
X-Mozilla-Status2: 00000000

Hi Nico,

<a few lines that quote nicely, in English>

Thanks,
Alex

```

Thunderbird builds the `.msf` index by itself at the next start. If that account has already
been opened once, its inbox carries a stale index showing an empty folder: delete
`Inbox.msf` alongside, with Thunderbird closed, and it is rebuilt from the mbox.

## 4. The add-on, installed from its sources

A **proxy file** in `extensions/`, named after the gecko id and holding the path of `src/`:

```bash
echo "$PWD/src" > "$PROFILE/extensions/reply-position@dataetic.fr"
```

```javascript
user_pref("xpinstall.signatures.required", false);
```

This is the only setup that starts the add-on the way an ordinary installation does, at launch,
and it survives a restart. *Load Temporary Add-on* does not: the MV3 background is an event
page, nothing wakes it up as long as no event occurs, and it has precisely not registered its
listeners yet.

## 5. Rules already in place

So that the options page opens on a populated table rather than an empty one, and so that a
reply lands on a rule without anything being typed first:

`$PROFILE/browser-extension-data/reply-position@dataetic.fr/storage.js`

```json
{"settings":{"version":1,"rules":{"alex@example.com":"above","@example.org":"below"},"defaultAction":"none","signature":"reply"}}
```

```javascript
user_pref("extensions.webextensions.ExtensionStorageIDB.enabled", false);
```

**That preference is not optional.** `storage.local` has two backends, IndexedDB by default and
the JSON file above. Without it the add-on reads the other one, finds nothing, and appears to do
nothing at all, with no error anywhere — the most misleading symptom this project has met.

## 6. Start, and check

```bash
/opt/thunderbird/thunderbird -no-remote -P <profile name>
```

`-P` names the profile explicitly, which rules out opening the production one by accident.
`-no-remote` allows a second instance alongside it.

Three things to confirm, none of which needs a screenshot:

```bash
# English interface: the title reads "Inbox - …"
xwininfo -root -children | grep -i thunderbird

# Add-on loaded: active true, appDisabled false
python3 -c "import json;print([a for a in json.load(open('$PROFILE/extensions.json'))['addons'] if 'reply-position' in a['id']])"
```

And the rules: the options page shows the two seeded entries.

## 7. The screenshots

Reply to Alex's message, in the inbox of the `nico@example.com` account. The rule
`alex@example.com → above`
applies as the window opens, while the identity is set to reply below: the move is visible.
Then click the *Reply position* button.

**The popup only obeys a real click.** No API opens it: `composeAction.openPopup()` is reserved
to the add-on that owns the button, a synthetic `MouseEvent` does not reach a toolbar button,
and `sendMouseEvent` is gone from `nsIDOMWindowUtils`. That click is the one gesture that cannot
be automated.

Capture the window alone, never the whole desktop: a listing wants the composer, not a
wallpaper, a dock and a system tray. Under a Wayland session Thunderbird falls back to XWayland
when started from a terminal, which puts its windows in the X server and makes them capturable
by id:

```bash
xwininfo -root -children | grep -i thunderbird     # read the id
import -window 0x1a00017 composer.png
```

A full-screen capture through the compositor comes out black, the X11 tools seeing nothing of a
native Wayland client.

Two views are worth having: the composer with the reply above the quote and the *Reply position*
button in the toolbar, and the same window with the popup open and the reply moved below. The
options page, with its populated table, makes a third.

## Undoing all of it

```bash
rm "$PROFILE/user.js"
rm "$PROFILE/extensions/langpack-en-US@thunderbird.mozilla.org.xpi"
rm "$PROFILE/extensions/reply-position@dataetic.fr"
rm -r "$PROFILE/browser-extension-data/reply-position@dataetic.fr"
```

Then restart. The values `user.js` has already copied into `prefs.js` are reset from the
settings, or by deleting the matching lines with Thunderbird closed. Taking a copy of `prefs.js`
before starting makes that last step a single `mv`.
