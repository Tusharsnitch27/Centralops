// Ordered migrations. Never edit an applied migration — add a new file with the next version.
// Version ranges reserved per module so parallel work doesn't collide:
//   1-9 core/foundation · 10-19 tasks · 20-29 meetings/calendar · 30-39 AOP · 40-49 S&OP · 50-59 projects/people/reports
import { sql as core } from "./001_core";
import { sql as plans } from "./002_plans";
import { sql as directory } from "./003_directory";
import { sql as aopScope } from "./030_aop_scope";
import { sql as aopOwners } from "./031_aop_owners";
import { sql as insights60 } from "./060_insights";
import { sql as sop40 } from "./040_sop";

export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  { version: 1, name: "core", sql: core },
  { version: 2, name: "plans", sql: plans },
  { version: 3, name: "directory", sql: directory },
  { version: 30, name: "aop_scope", sql: aopScope },
  { version: 31, name: "aop_owners", sql: aopOwners },
  { version: 60, name: "insights", sql: insights60 },
  { version: 40, name: "sop", sql: sop40 },
];
