import { writeFile } from "node:fs/promises";

const now = new Date().toISOString();

async function fetchJson(url) {
  const res = await fetch(url, {
    headers: {
      "user-agent": "ai-bounty-radar/1.0",
      "accept": "application/json",
    },
  });
  if (!res.ok) throw new Error(`${url} returned ${res.status}`);
  return res.json();
}

function amountText(item) {
  const symbol = item?.asset?.symbol || "USDC";
  const amount = Number(item?.remainingAmount || 0);
  if (!amount) return "";
  return `${amount} ${symbol} pool`;
}

async function gibwork() {
  const data = await fetchJson("https://app.gib.work/api/explore");
  const riskyPromo = /(guaranteed|profit regardless|safe, market-neutral|steady daily yield|whether.*crashes.*surges)/i;
  return (data.results || [])
    .filter((item) => item.isOpen && item.remainingAmount > 0)
    .filter((item) => !riskyPromo.test(`${item.title} ${item.content || ""}`))
    .slice(0, 10)
    .map((item) => ({
      title: item.title,
      source: "Gibwork",
      rewardText: amountText(item),
      action: (item.tags || []).includes("Development") ? "Issue or PR" : "Submission",
      note: `${item.tags?.join(", ") || "Task"}; deadline ${item.deadline?.slice(0, 10) || "unknown"}.`,
      url: `https://app.gib.work/task/${item.id}`,
    }));
}

async function githubBounties() {
  const query = encodeURIComponent('label:bounty "USDC" is:issue is:open');
  const data = await fetchJson(`https://api.github.com/search/issues?q=${query}&per_page=8`);
  return (data.items || [])
    .map((issue) => {
      const amount = issue.title.match(/(?:\$|Bounty:\s*)(\d+[\d,.]*)\s*(?:USDC|Bounty)?/i) ||
        issue.body?.match(/(?:\$|Bounty:\s*)(\d+[\d,.]*)\s*(?:USDC|Bounty)?/i);
      return {
        title: issue.title,
        source: "GitHub",
        rewardText: amount ? `$${amount[1]} candidate` : "Check issue",
        action: "PR or issue",
        note: issue.repository_url.replace("https://api.github.com/repos/", ""),
        url: issue.html_url,
      };
    });
}

const staticLeads = [
  {
    title: "Virtuals referral",
    source: "Virtuals",
    rewardText: "20% + 5% fees",
    action: "Share referral",
    note: "Referral code gRico6; payout depends on eligible referred trading.",
    url: "https://app.virtuals.io/referral?code=gRico6",
  },
  {
    title: "ubounty demo contributor flow",
    source: "ubounty",
    rewardText: "$20 USDC",
    action: "Submit test bounty PR",
    note: "Validates USDC payment flow after merged PR.",
    url: "https://github.com/ubounty-app/ubounty-demo/issues/9",
  },
];

const results = [];
for (const loader of [gibwork, githubBounties]) {
  try {
    results.push(...await loader());
  } catch (error) {
    results.push({
      title: `${loader.name} scan failed`,
      source: "Scanner",
      rewardText: "",
      action: "Retry",
      note: error.message,
      url: "https://github.com/kgy7247/ai-bounty-radar",
    });
  }
}

const data = {
  updatedAt: now,
  opportunities: [...staticLeads, ...results],
};

await writeFile(new URL("../docs/opportunities.json", import.meta.url), JSON.stringify(data, null, 2) + "\n");
