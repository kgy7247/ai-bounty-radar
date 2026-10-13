import { writeFile } from "node:fs/promises";
import { normalizeGibworkItem, normalizeGithubIssue, sortOpportunities } from "./opportunity-utils.mjs";

const now = new Date();
const sourceStatus = {};

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "ai-bounty-radar/1.1",
      "accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

async function gibwork() {
  const data = await fetchJson("https://app.gib.work/api/explore");
  return (data.results || [])
    .map((item) => normalizeGibworkItem(item, now))
    .filter(Boolean);
}

async function githubBounties() {
  const query = encodeURIComponent('label:bounty "USDC" is:issue is:open');
  const data = await fetchJson(`https://api.github.com/search/issues?q=${query}&per_page=30`);
  return (data.items || [])
    .map((issue) => normalizeGithubIssue(issue, now))
    .filter(Boolean);
}

const opportunities = [];
for (const [name, loader] of [["Gibwork", gibwork], ["GitHub", githubBounties]]) {
  try {
    const found = await loader();
    opportunities.push(...found);
    sourceStatus[name] = { ok: true, count: found.length };
  } catch (error) {
    sourceStatus[name] = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const data = {
  updatedAt: now.toISOString(),
  sourceStatus,
  opportunities: sortOpportunities(opportunities).slice(0, 12),
};

await writeFile(new URL("../docs/opportunities.json", import.meta.url), JSON.stringify(data, null, 2) + "\n");
console.log(`Saved ${data.opportunities.length} eligible listings.`);
console.log(JSON.stringify(sourceStatus, null, 2));
