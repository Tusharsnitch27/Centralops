import "server-only";
import type { RunQ } from "../db";
import handbook from "@/db/seed/handbook-fy27.json";

// Source documents the user pointed to (Oct 2026). Rows inside the sheets are brought in with Library › Import.
const ITEMS: { kind: string; title: string; url: string; category: string; description: string; pinned?: boolean }[] = [
  { kind: "sop", title: "Central Ops — SOP register", url: "https://docs.google.com/spreadsheets/d/1Zk7-9vj5U08wvNxQlbC8Mq2AEQ0PMdD1wG-1AIEVw_w/edit?gid=1866371579#gid=1866371579", category: "Source", description: "Master list of SOPs (Central Ops - Task Tracker'26 › SOP tab)", pinned: true },
  { kind: "handbook", title: "Supply Chain Terminologies", url: "https://docs.google.com/document/d/1f3oKFnEL_jMLqLiBRLtgC5gzGN1kKDVBpbFXOpZqGy0/edit?tab=t.0", category: "Handbook", description: "100 warehouse, logistics, inventory and retail terms with formulas", pinned: true },
  { kind: "dashboard", title: "Dashboards register", url: "https://docs.google.com/spreadsheets/d/1Zk7-9vj5U08wvNxQlbC8Mq2AEQ0PMdD1wG-1AIEVw_w/edit?gid=1661743879#gid=1661743879", category: "Source", description: "All Central Ops dashboards (Task Tracker'26 › Dashboards tab)", pinned: true },
  { kind: "tool", title: "Long Tail & Plus", url: "https://longtail.snitch-workflow.com/", category: "Internal tools", description: "Long-tail & Plus business: products, allocation, performance", pinned: true },
  { kind: "tool", title: "Ops Workflow Tracker (all other tools)", url: "https://docs.google.com/spreadsheets/d/1-LMhBVmQ_3oVWhFCYC3YkLBRSiv6mNFZqtkUEgcsph0/edit?gid=0#gid=0", category: "Source", description: "Register of every other ops tool and workflow", pinned: true },
];

export async function seedLibrary(S: RunQ) {
  for (const [i, it] of ITEMS.entries())
    await S(`insert into library_items (kind, title, url, category, description, pinned, sort, source) values ($1,$2,$3,$4,$5,$6,$7,'seed')
             on conflict do nothing`, [it.kind, it.title, it.url, it.category, it.description, !!it.pinned, i]);
}

/** v2: every row of the SOP register, Metabase dashboards, trackers and the tools register, read from the source sheets (Oct 2026). */
export async function seedHandbook(S: RunQ) {
  await S(`update library_items set title = 'Supply Chain Terminologies', description = '100 warehouse, logistics, inventory and retail terms with formulas'
           where kind = 'handbook' and source = 'seed' and url like '%1f3oKFnEL_jMLqLiBRLtgC5gzGN1kKDVBpbFXOpZqGy0%'`);
  await S(`delete from library_items where source = 'sheet'`);
  const add = (kind: string, title: string, url: string | null, category: string, fn: string, owner: string, description: string, status: string, extra: Record<string, string>, sort: number) =>
    S(`insert into library_items (kind, title, url, category, function_name, owner, description, status, extra, sort, source)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'sheet')
       on conflict (kind, lower(title), coalesce(url, '')) do update set category = excluded.category, function_name = excluded.function_name, owner = excluded.owner,
         description = excluded.description, status = excluded.status, extra = excluded.extra, sort = excluded.sort`,
      [kind, title, url, category, fn, owner, description, status, JSON.stringify(extra), sort]);
  for (const [i, s] of handbook.sops.entries())
    await add("sop", s.title, s.url, s.stream, s.function, s.poc, s.objective, s.status, { channel: s.channel, stream: s.stream, version: s.version, remark: s.remark, link_text: s.link_text, poc_email: s.poc_email }, 10 + i);
  for (const [i, d] of handbook.dashboards.entries())
    await add("dashboard", d.title, d.url, d.project, "", "", d.description, "", { group: "Metabase" }, 10 + i);
  for (const [i, d] of handbook.analytics.entries())
    await add("dashboard", d.title, d.url, d.function, "", d.owner, "", "", { group: "Maplemonk", number: d.number }, 50 + i);
  for (const [i, t] of handbook.trackers.entries())
    await add("dashboard", t.title, t.url, t.group, "", "", t.description, "", { group: "Trackers" }, 100 + i);
  for (const [i, t] of handbook.tools.entries())
    await add("tool", t.title, t.url, "Internal tools", t.function, t.owner, t.usecase, "", t.users ? { users: t.users } : {}, 10 + i);
}
