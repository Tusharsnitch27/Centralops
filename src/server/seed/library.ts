import "server-only";
import type { RunQ } from "../db";

// Source documents the user pointed to (Oct 2026). Rows inside the sheets are brought in with Library › Import.
const ITEMS: { kind: string; title: string; url: string; category: string; description: string; pinned?: boolean }[] = [
  { kind: "sop", title: "Central Ops — SOP register", url: "https://docs.google.com/spreadsheets/d/1Zk7-9vj5U08wvNxQlbC8Mq2AEQ0PMdD1wG-1AIEVw_w/edit?gid=1866371579#gid=1866371579", category: "Source", description: "Master list of SOPs (Central Ops - Task Tracker'26 › SOP tab)", pinned: true },
  { kind: "handbook", title: "Central Ops Handbook", url: "https://docs.google.com/document/d/1f3oKFnEL_jMLqLiBRLtgC5gzGN1kKDVBpbFXOpZqGy0/edit?tab=t.0", category: "Handbook", description: "How Central Operations works — teams, cadences, processes", pinned: true },
  { kind: "dashboard", title: "Dashboards register", url: "https://docs.google.com/spreadsheets/d/1Zk7-9vj5U08wvNxQlbC8Mq2AEQ0PMdD1wG-1AIEVw_w/edit?gid=1661743879#gid=1661743879", category: "Source", description: "All Central Ops dashboards (Task Tracker'26 › Dashboards tab)", pinned: true },
  { kind: "tool", title: "Long Tail & Plus", url: "https://longtail.snitch-workflow.com/", category: "Internal tools", description: "Long-tail & Plus business: products, allocation, performance", pinned: true },
  { kind: "tool", title: "Ops Workflow Tracker (all other tools)", url: "https://docs.google.com/spreadsheets/d/1-LMhBVmQ_3oVWhFCYC3YkLBRSiv6mNFZqtkUEgcsph0/edit?gid=0#gid=0", category: "Source", description: "Register of every other ops tool and workflow", pinned: true },
];

export async function seedLibrary(S: RunQ) {
  for (const [i, it] of ITEMS.entries())
    await S(`insert into library_items (kind, title, url, category, description, pinned, sort, source) values ($1,$2,$3,$4,$5,$6,$7,'seed')
             on conflict do nothing`, [it.kind, it.title, it.url, it.category, it.description, !!it.pinned, i]);
}
