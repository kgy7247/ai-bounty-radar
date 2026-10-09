import { writeFile } from "node:fs/promises";

const now = new Date().toISOString();

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "ai-bounty-radar/1.1",
      "accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(url + " returned " + res.status);
  return res.json();
}

function money(value) {
  return Number(value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function amountText(item) {
  const symbol = item?.asset?.symbol || "USDC";
  const amount = Number(item?.remainingAmount || 0);
  if (!amount) return "";
  return money(amount) + " " + symbol + " pool";
}

function gibworkUrl(item) {
  const path = item.type === "bounties" ? "bounties" : "tasks";
  return "https://app.gib.work/" + path + "/" + item.id;
}

function titleFromDescription(description, fallback) {
  const lines = String(description || "").split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const heading = lines.find((line) => /^#{1,3}\s+/.test(line));
  const title = heading ? heading.replace(/^#{1,3}\s+/, "") : lines[0];
  return (title || fallback).replace(/[*_]/g, "").slice(0, 120);
}

function dateText(value) {
  if (!value) return "unknown";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toISOString().slice(0, 10);
}

async function arcBounty() {
  const board = await fetchJson("https://arcbounty.app/api/v1/bounties?status=open");
  const candidates = (board.bounties || [])
    .filter((item) => item.status === "open" && item.audience !== "humans" && !item.reservedFor)
    .sort((a, b) => Number(b.workerPayoutUsdc || 0) - Number(a.workerPayoutUsdc || 0))
    .slice(0, 5);

  const details = await Promise.allSettled(candidates.map(async (item) => {
    let bounty = item;
    try {
      const full = await fetchJson("https://arcbounty.app/api/v1/bounties/" + item.jobId + "?full=1");
      bounty = full.bounty || item;
    } catch {
      // The board entry remains usable if the optional description request fails.
    }

    const payout = Number(bounty.workerPayoutUsdc || bounty.rewardUsdc || 0);
    if (!(payout > 0)) return null;

    return {
      title: titleFromDescription(bounty.descriptionText, "ArcBounty task #" + bounty.jobId),
      source: "ArcBounty",
      rewardText: money(payout) + " USDC net",
      rewardValue: payout,
      rewardKind: "fixed",
      priority: 3,
      action: "Agent task",
      note: (bounty.category || "Task") + "; " + (bounty.audience || "anyone") +
        "; deadline " + dateText(bounty.deadline) +
        "; escrow-backed listing. Check acceptance criteria and poster before taking.",
      url: bounty.url || "https://arcbounty.app/bounty/" + bounty.jobId,
    };
  }));

  return details
    .filter((result) => result.status === "fulfilled" && result.value)
    .map((result) => result.value);
}

async function gibwork() {
  const data = await fetchJson("https://app.gib.work/api/explore");
  const riskyPromo = /(guaranteed|profit regardless|safe, market-neutral|steady daily yield|whether.*crashes.*surges)/i;
  const cashSymbols = new Set(["USDC", "USDT", "USD"]);

  return (data.results || [])
    .filter((item) => item.isOpen && Number(item.remainingAmount) > 0)
    .filter((item) => cashSymbols.has(item?.asset?.symbol || "USDC"))
    .filter((item) => !riskyPromo.test((item.title || "") + " " + (item.content || "")))
    .sort((a, b) => Number(b.remainingAmount || 0) - Number(a.remainingAmount || 0))
    .slice(0, 8)
    .map((item) => ({
      title: item.title,
      source: "Gibwork",
      rewardText: amountText(item),
      rewardValue: Number(item.remainingAmount || 0),
      rewardKind: "pool",
      priority: 2,
      action: (item.tags || []).includes("Development") ? "Issue or PR" : "Submission",
      note: (item.tags?.join(", ") || "Task") + "; pool amount, not guaranteed per-worker payout; deadline " +
        dateText(item.deadline) + ".",
      url: gibworkUrl(item),
    }));
}

async function githubBounties() {
  const query = encodeURIComponent('label:bounty "USDC" is:issue is:open');
  const data = await fetchJson("https://api.github.com/search/issues?q=" + query + "&per_page=20");
  const donation = /\b(donate|donation|fundraising|contribute funds)\b/i;
  const explicitBounty = /\[Bounty:\s*\$?([\d,.]+)\s*(USDC|USD)\]/i;

  return (data.items || [])
    .filter((issue) => !donation.test((issue.title || "") + " " + (issue.body || "").slice(0, 500)))
    .map((issue) => {
      const match = (issue.title || "").match(explicitBounty);
      if (!match) return null;
      const value = Number(match[1].replace(/,/g, ""));
      if (!(value > 0)) return null;

      return {
        title: issue.title,
        source: "GitHub",
        rewardText: money(value) + " " + match[2].toUpperCase() + " listed",
        rewardValue: value,
        rewardKind: "fixed",
        priority: 3,
        action: "PR or issue",
        note: issue.repository_url.replace("https://api.github.com/repos/", "") +
          "; maintainer acceptance and competition still apply.",
        url: issue.html_url,
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.rewardValue - a.rewardValue)
    .slice(0, 8);
}

const results = [];
const scanErrors = [];

for (const loader of [arcBounty, githubBounties, gibwork]) {
  try {
    results.push(...await loader());
  } catch (error) {
    scanErrors.push({
      source: loader.name,
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

const opportunities = results
  .sort((a, b) =>
    (b.priority || 0) - (a.priority || 0) ||
    (b.rewardValue || 0) - (a.rewardValue || 0)
  );

const data = {
  updatedAt: now,
  scanErrors,
  opportunities,
};

await writeFile(
  new URL("../docs/opportunities.json", import.meta.url),
  JSON.stringify(data, null, 2) + "\n",
);
