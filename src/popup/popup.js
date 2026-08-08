/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Popup of the compose button: shows the position in force, switches it, and offers to
 * remember the choice for the contact or for the domain.
 */

const LABELS = {
  above: "positionAbove",
  below: "positionBelow",
  none: "positionNone",
  absent: "positionUnknown",
};

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
  const refresh = () => {
    $("#position").textContent = translate(LABELS[position] ?? "positionUnknown");
  };
  refresh();

  $("#toggle").addEventListener("click", async () => {
    const target = position === "above" ? "below" : "above";
    const result = await browser.tabs.sendMessage(tab.id, {
      type: "place",
      target,
      plainText: plan.plainText,
      signature: plan.signature,
    });
    position = result.after;
    refresh();
    await rememberIfRequested(plan, position);
  });

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
