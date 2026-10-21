// Ordered migrations. Never edit an applied migration — add a new file with the next version.
// Version ranges reserved per module so parallel work doesn't collide:
//   1-9 core/foundation · 10-19 tasks · 20-29 meetings/calendar · 30-39 AOP · 40-49 S&OP · 50-59 projects/people/reports
import { sql as core } from "./001_core";
import { sql as plans } from "./002_plans";
import { sql as directory } from "./003_directory";
import { sql as loginLock } from "./004_login_lock";
import { sql as taskPoc } from "./010_task_poc";
import { sql as weekly } from "./012_weekly";
import { sql as taskLinks } from "./013_task_links";
import { sql as library } from "./051_library";
import { sql as aopScope } from "./030_aop_scope";
import { sql as aopOwners } from "./031_aop_owners";
import { sql as aopDeadlines } from "./032_aop_deadlines";
import { sql as insights60 } from "./060_insights";
import { sql as sop40 } from "./040_sop";
import { sql as sopReview } from "./041_sop_review";
import { sql as sopHistory } from "./042_sop_history";

export const MIGRATIONS: { version: number; name: string; sql: string }[] = [
  { version: 1, name: "core", sql: core },
  { version: 2, name: "plans", sql: plans },
  { version: 3, name: "directory", sql: directory },
  { version: 4, name: "login_lock", sql: loginLock },
  { version: 10, name: "task_poc", sql: taskPoc },
  { version: 12, name: "weekly", sql: weekly },
  { version: 13, name: "task_links", sql: taskLinks },
  { version: 51, name: "library", sql: library },
  { version: 30, name: "aop_scope", sql: aopScope },
  { version: 31, name: "aop_owners", sql: aopOwners },
  { version: 32, name: "aop_deadlines", sql: aopDeadlines },
  { version: 60, name: "insights", sql: insights60 },
  { version: 40, name: "sop", sql: sop40 },
  { version: 41, name: "sop_review", sql: sopReview },
  { version: 42, name: "sop_history", sql: sopHistory },
];
