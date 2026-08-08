#!/usr/bin/env node
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. */

/* Launches Thunderbird on a disposable profile with the test extension temporarily loaded,
 * waits for the JSON report, and exits with 0 or 1.
 *
 * Temporary loading goes through web-ext, which speaks the remote debugging protocol: it is
 * the click-free equivalent of "Load Temporary Add-on". An extension loaded that way escapes
 * signature verification, which is what allows an Experiment API inside the harness.
 */

import { spawn } from "node:child_process";
import { readFile, writeFile, access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { makeProfile } from "./make-profile.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION = join(ROOT, "test", "integration");
const THUNDERBIRD = process.env.THUNDERBIRD_BIN ?? "/opt/thunderbird/thunderbird";
const LOG = join(ROOT, ".tmp", "run.log");

const TIMEOUT_MS = Number(process.env.TB_TIMEOUT_MS ?? 180_000);

const exists = async (path) => {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const launch = async ({ profilePath, reportPath }) => {
  const output = [];
  const child = spawn(
    "npx",
    [
      "web-ext",
      "run",
      "--source-dir",
      EXTENSION,
      "--firefox",
      THUNDERBIRD,
      "--firefox-profile",
      profilePath,
      "--keep-profile-changes",
      "--no-reload",
      "--no-input",
    ],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        /* Headless: the compose windows do not clutter the screen. */
        MOZ_HEADLESS: process.env.TB_HEADLESS === "0" ? "" : "1",
        /* The cite prefix carries a formatted date, hence the timezone of the process. UTC is
         * what a CI would use, and it keeps the captures identical from one contributor to
         * the next. The language side is pinned by tools/make-profile.mjs. */
        TZ: "UTC",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const collect = (stream) =>
    stream.on("data", (chunk) => {
      const text = chunk.toString();
      output.push(text);
      if (process.env.TB_VERBOSE) process.stdout.write(text);
    });
  collect(child.stdout);
  collect(child.stderr);

  const finished = new Promise((resolve) => child.on("exit", (code) => resolve(code)));

  const started = Date.now();
  let reportPresent = false;
  while (Date.now() - started < TIMEOUT_MS) {
    if (await exists(reportPath)) {
      reportPresent = true;
      break;
    }
    if (child.exitCode !== null) break;
    await wait(500);
  }

  /* The harness asks for the shutdown itself; what follows is only there in case it did
   * not, so as to never leave an orphan Thunderbird behind after a run. */
  if (child.exitCode === null) {
    child.kill("SIGTERM");
    await Promise.race([finished, wait(10_000)]);
    if (child.exitCode === null) child.kill("SIGKILL");
  }
  await Promise.race([finished, wait(5_000)]);

  await writeFile(LOG, output.join(""), "utf8");
  return { reportPresent, log: LOG };
};

const summarize = (report) => {
  const lines = [];
  for (const testCase of report.cases) {
    if (testCase.error) {
      lines.push(`  ✗ ${testCase.id} — ${testCase.error}`);
      continue;
    }
    if (report.mode === "verify") {
      lines.push(`  ✓ ${testCase.id} — position ${testCase.observed} — ${testCase.comment}`);
      continue;
    }
    const p = testCase.probe.delayed.presence;
    lines.push(
      `  ${testCase.probe.bodyFilled ? "✓" : "?"} ${testCase.id} — ` +
        `${testCase.probe.delayed.children.length} children, ` +
        `quote ${p.blockquoteCite}, prefix ${p.citePrefix}, signature ${p.signature}, ` +
        `forward ${p.forwardContainer}, pre ${p.preWrap}, ` +
        `stable ${testCase.probe.stable ? "yes" : "NO"}, ${testCase.probe.attempts} attempt(s)`,
    );
  }
  return lines.join("\n");
};

const main = async () => {
  const mode = process.argv.includes("--verify") ? "verify" : "capture";
  const paths = await makeProfile({ mode });
  console.log(`Mode    : ${mode === "verify" ? "extension verification" : "capture"}`);
  console.log(`Profile : ${paths.profilePath}`);
  console.log(`Report  : ${paths.reportPath}`);
  console.log(`Starting Thunderbird (${THUNDERBIRD})…`);

  const { reportPresent, log } = await launch(paths);
  if (!reportPresent) {
    console.error(`No report written. Launch output in ${log}`);
    process.exit(1);
  }

  const report = JSON.parse(await readFile(paths.reportPath, "utf8"));
  console.log(summarize(report));

  if (report.interfaces?.length) {
    console.log("\nInterfaces:");
    for (const check of report.interfaces) {
      const detail =
        typeof check.detail === "string" ? check.detail : JSON.stringify(check.detail);
      console.log(`  ${check.ok ? "✓" : "✗"} ${check.id} — ${detail?.slice(0, 120) ?? ""}`);
    }
  }

  const failures = report.cases.filter((testCase) => testCase.error);
  if (report.error) {
    console.error(`\nGlobal failure: ${report.error}`);
    process.exit(1);
  }
  const interfaceFailures = (report.interfaces ?? []).filter((c) => !c.ok);
  if (failures.length || interfaceFailures.length) {
    console.error(
      `\n${failures.length} cases and ${interfaceFailures.length} interface checks failed.`,
    );
    process.exit(1);
  }
  console.log(
    `\n${report.cases.length} cases captured` +
      (report.interfaces?.length ? `, ${report.interfaces.length} interface checks.` : "."),
  );
};

await main();
