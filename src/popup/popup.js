/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Popup of the compose button: shows where the reply is being written, moves it, and offers
 * to remember the choice for the contact or for the domain.
 *
 * Two radio buttons rather than one switch: the state and both destinations are readable at a
 * glance, no verb to interpret, and a composer opened with the quote selected (no writing area
 * at all, `position` is "absent") shows neither of them checked instead of having to guess a
 * destination.
 */

const translate = (key, ...arguments_) => browser.i18n.getMessage(key, arguments_);

const $ = (selector) => document.querySelector(selector);

const localize = () => {
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = translate(node.dataset.i18n);
  }
};

const showUnavailable = (key) => {
  const message = $("#unavailable");
  message.textContent = translate(key);
  message.hidden = false;
  $("#panel").hidden = true;
};

const start = async () => {
  localize();

  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  const plan = await browser.runtime.sendMessage({ type: "plan", tabId: tab.id });

  if (plan.reason === "out-of-scope") {
    showUnavailable("popupNotAReply");
    return;
  }
  if (plan.reason === "address-book") {
    showUnavailable("popupFromAddressBook");
    return;
  }
  if (!plan.address) {
    showUnavailable("popupNoRecipient");
    return;
  }

  $("#panel").hidden = false;
  $("#label-contact").textContent = translate("popupRememberContact", plan.address);
  $("#label-domain").textContent = translate("popupRememberDomain", plan.domain);

  /* The displayed position is the one of the DOM, not the one of the rule: the user may
   * have switched by hand since the composer opened. */
  const state = await browser.tabs.sendMessage(tab.id, { type: "state" });
  let position = state.position;

  const radios = [...document.querySelectorAll('input[name="position"]')];

  /* Nothing about the choice is remembered here: this document is created and destroyed on
   * every opening of the panel. `state.settled`, kept by the compose script, is what says
   * whether the body still holds what the extension left it at. */
  const refresh = () => {
    for (const radio of radios) {
      radio.checked = radio.value === position;
    }
    $("#source").textContent = translate(Rules.originKey(plan, position, state.settled));
  };
  refresh();

  for (const radio of radios) {
    radio.addEventListener("change", async () => {
      const result = await browser.tabs.sendMessage(tab.id, {
        type: "place",
        target: radio.value,
        plainText: plan.plainText,
        signature: plan.signature,
      });
      /* The composer has the last word: it stands aside on a message with no quote, and the
       * checked radio has to come back to the position the body really has. */
      position = result.after;
      refresh();
      await rememberIfRequested(plan, position);
    });
  }

  for (const checkbox of document.querySelectorAll("#remember input")) {
    checkbox.addEventListener("change", () => rememberIfRequested(plan, position));
  }
};

/* Remembering follows the displayed position: ticking the box after a switch saves what the
 * user sees, not the rule that brought them there. */
const rememberIfRequested = async (plan, position) => {
  if (position !== "above" && position !== "below") {
    return;
  }
  const requests = [
    [$("#remember-contact").checked, plan.address],
    [$("#remember-domain").checked, plan.domain],
  ];
  let saved = false;
  for (const [checked, key] of requests) {
    if (checked) {
      await browser.runtime.sendMessage({ type: "remember", key, position });
      saved = true;
    }
  }
  $("#confirmation").hidden = !saved;
};

$("#options").addEventListener("click", () => {
  browser.runtime.openOptionsPage();
  window.close();
});

start().catch((e) => {
  console.error(e);
  showUnavailable("popupNoRecipient");
});
