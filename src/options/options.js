/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Options page: rules table, default position, export and import.
 *
 * Validation lives in lib/rules.js, not here: this page only presents and forwards.
 */

const LABELS = { above: "positionAbove", below: "positionBelow", none: "positionNone" };

const translate = (key, ...arguments_) => browser.i18n.getMessage(key, arguments_);

const $ = (selector) => document.querySelector(selector);

const localize = () => {
  for (const node of document.querySelectorAll("[data-i18n]")) {
    node.textContent = translate(node.dataset.i18n);
  }
};

const readSettings = () => browser.runtime.sendMessage({ type: "settings" });

/* Builds the rows through the DOM rather than through innerHTML: rule keys come from an
 * imported file, they must never be interpreted as markup. */
const drawRules = (settings) => {
  const tbody = $("#rules");
  tbody.replaceChildren();

  const keys = Object.keys(settings.rules).sort();
  $("#empty").hidden = keys.length > 0;

  for (const key of keys) {
    const row = document.createElement("tr");

    const keyCell = document.createElement("td");
    keyCell.textContent = key;

    const positionCell = document.createElement("td");
    const select = document.createElement("select");
    for (const position of Rules.POSITIONS) {
      const option = document.createElement("option");
      option.value = position;
      option.textContent = translate(LABELS[position]);
      option.selected = settings.rules[key] === position;
      select.appendChild(option);
    }
    select.addEventListener("change", async () => {
      await browser.runtime.sendMessage({
        type: "remember",
        key,
        position: select.value,
      });
      refresh();
    });
    positionCell.appendChild(select);

    const actionsCell = document.createElement("td");
    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = translate("optionsDelete");
    deleteButton.addEventListener("click", async () => {
      await browser.runtime.sendMessage({ type: "forget", key });
      refresh();
    });
    actionsCell.appendChild(deleteButton);

    row.append(keyCell, positionCell, actionsCell);
    tbody.appendChild(row);
  }
};

const refresh = async () => {
  const settings = await readSettings();
  drawRules(settings);
  $("#default").value = settings.defaultAction;
  $("#signature").value = settings.signature;
};

$("#add").addEventListener("submit", async (event) => {
  event.preventDefault();
  const key = Rules.normalize($("#key").value);
  const invalid = !Rules.isKey(key);
  $("#add-error").hidden = !invalid;
  if (invalid) {
    return;
  }
  await browser.runtime.sendMessage({
    type: "remember",
    key,
    position: $("#position").value,
  });
  $("#key").value = "";
  refresh();
});

$("#default").addEventListener("change", async (event) => {
  await browser.runtime.sendMessage({ type: "default", position: event.target.value });
});

$("#signature").addEventListener("change", async (event) => {
  await browser.runtime.sendMessage({ type: "signature", value: event.target.value });
});

$("#export").addEventListener("click", async () => {
  const settings = await readSettings();
  const content = new Blob([JSON.stringify(settings, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(content);
  const link = document.createElement("a");
  link.href = url;
  link.download = "reply-position-rules.json";
  link.click();
  URL.revokeObjectURL(url);
});

$("#import").addEventListener("click", () => $("#file").click());

$("#file").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const message = $("#import-message");
  message.hidden = false;

  let raw;
  try {
    raw = JSON.parse(await file.text());
  } catch {
    message.textContent = translate("optionsInvalidFile");
    return;
  }

  /* An import replaces the existing rules rather than merging them: two contradictory rules
   * on the same address would have no obvious resolution. */
  const { settings, rejected } = Rules.validate(raw);
  for (const [key, position] of Object.entries(settings.rules)) {
    await browser.runtime.sendMessage({ type: "remember", key, position });
  }
  await browser.runtime.sendMessage({ type: "default", position: settings.defaultAction });
  await browser.runtime.sendMessage({ type: "signature", value: settings.signature });

  const count = Object.keys(settings.rules).length;
  message.textContent = rejected.length
    ? `${translate("optionsImported", count)} ${translate("optionsRejected", rejected.length)}`
    : translate("optionsImported", count);

  event.target.value = "";
  refresh();
});

localize();
refresh();
