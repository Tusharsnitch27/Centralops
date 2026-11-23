# Generates docs/n8n/wam-to-snowflake.workflow.json (n8n import) — run: python docs/n8n/mkwam.py
import json, os

# One branch per Metabase question: table, merge key, column map (Snowflake column -> Metabase column, type)
BRANCHES = [
    ("WAM_ASN_INWARD", 2177, ["PO_NUMBER", "SKU_GROUP_ID"], [
        ("SKU_GROUP_ID", "sku_group_id", "s"), ("PO_NUMBER", "po_number", "s"), ("WAREHOUSE", "rts_warehouse_id", "s"),
        ("ASN_NUMBER", "asn_number", "s"), ("STATUS", "status", "s"), ("FI_QTY", "fi_qty", "n"), ("TOTAL_QTY", "total_qty", "n"),
        ("SOLID_QTY", "solid_qty", "n"), ("AVG_DEPTH", "avg_depth", "n"), ("NUM_PREPACKS", "num_prepacks", "n"),
        ("PUTAWAY_QTY", "quantity", "n"), ("ACTUAL_BOXES_RECEIVED", "actual_boxes_received", "n"), ("PREPACK_STATUS", "prepack_status", "s"),
        ("PREPACK_CREATED_AT", "prepack_created_at", "t"), ("ASN_CREATED_AT", "asn_created_at", "t"), ("RTS_DATE", "rts_date", "t"),
        ("RTS_ALLOCATED_AT", "rts_allocated_at", "t"), ("DISPATCHED_AT", "dispatched_at", "t"), ("GATE_ENTRY_TIME", "gate_entry_time", "t"),
        ("UNLOADING_START_TIME", "unloading_start_time", "t"), ("UNLOADING_END_TIME", "unloading_end_time", "t"),
        ("GRN_SUBMITTED_AT", "grn_submitted_at", "t"), ("FIRST_PUV_AT", "first_puv_at", "t"), ("LAST_PUV_AT", "last_puv_at", "t"),
        ("PV_CODE", "pv_code", "s"), ("PUV_CODES", "puv_codes", "s"), ("PUV_BRANCH_CODES", "puv_branch_codes", "s")]),
    ("WAM_ISSUES_DAILY", 2281, ["ISSUE_DATE", "WAREHOUSE"], [
        ("ISSUE_DATE", "issue_created_at_date", "d"), ("WAREHOUSE", "warehouse_name", "s"), ("ISSUE_COUNT", "issue_count", "n"), ("SKU_LINES", "sku_lines", "n")]),
    ("WAM_KPI_DAILY", 2283, ["VOUCH_DATE", "WAREHOUSE"], [
        ("VOUCH_DATE", "vouch_date", "d"), ("WAREHOUSE", "warehouse", "s"), ("TOTAL_GRN", "total_grn", "n"),
        ("GRNS_WITH_DISCREPANCY", "grns_with_discrepancy", "n"), ("POS_WITH_DISCREPANCY", "pos_with_discrepancy", "n"),
        ("TOTAL_DISCREPANCIES_REPORTED", "total_discrepancies_reported", "n"), ("INWARD_QTY", "inward_qty", "n"),
        ("DISCREPANCY_RATE_PCT", "discrepancy_rate_pct", "n")]),
]

CODE = r"""// n8n Code node (Run Once for All Items): Metabase question rows -> MERGE batches into Snowflake.
// Same pattern as the RFID_STORE_INWARD sync. Re-running is safe (MERGE on the key); the first run is the backfill.
const TABLE = 'SNITCH_DB.MAPLEMONK.__TABLE__';
const KEY = __KEY__;
const COLS = __COLS__; // [snowflake column, metabase column, type: s|n|d|t]
const BATCH_SIZE = 200;
let rows = [];
for (const item of $input.all()) {
  const d = item.json;
  if (Array.isArray(d)) rows.push(...d);
  else if (Array.isArray(d.data)) rows.push(...d.data);
  else if (Array.isArray(d.rows)) rows.push(...d.rows);
  else rows.push(d);
}
const src = Object.fromEntries(COLS.map(([sf, mb]) => [sf, mb]));
// drop rows without a full key, and keep the last row per key (MERGE fails on duplicate source keys)
const byKey = new Map();
for (const r of rows) {
  const k = KEY.map((c) => r[src[c]]);
  if (k.some((v) => v === null || v === undefined || v === '')) continue;
  byKey.set(JSON.stringify(k), r);
}
rows = [...byKey.values()];
if (!rows.length) throw new Error('Metabase returned no rows for ' + TABLE + '. No Snowflake changes made.');
const expr = ([sf, mb, t]) => {
  const ref = `j:${JSON.stringify(mb)}::STRING`;
  if (t === 'n') return `TRY_TO_NUMBER(${ref}, 38, 4) AS ${sf}`;
  if (t === 'd') return `TRY_TO_DATE(${ref}) AS ${sf}`;
  if (t === 't') return `TRY_TO_TIMESTAMP_NTZ(${ref}) AS ${sf}`;
  return `${ref} AS ${sf}`;
};
const selects = COLS.map(expr).join(',\n    ');
const on = KEY.map((c) => `t.${c} = s.${c}`).join(' AND ');
const output = [];
for (let start = 0; start < rows.length; start += BATCH_SIZE) {
  const batch = rows.slice(start, start + BATCH_SIZE);
  const values = batch.map((row) => `('${JSON.stringify(row).replace(/\\/g, '\\\\').replace(/'/g, "''")}')`).join(',\n      ');
  const sql = `MERGE INTO ${TABLE} t
USING (
  SELECT
    ${selects},
    CURRENT_TIMESTAMP()::TIMESTAMP_NTZ AS SYNCED_AT
  FROM (SELECT PARSE_JSON(column1) AS j FROM VALUES
      ${values})
) s ON ${on}
WHEN MATCHED THEN UPDATE ALL BY NAME
WHEN NOT MATCHED THEN INSERT ALL BY NAME`;
  output.push({ json: { sql, table: TABLE, batch_number: output.length + 1, batch_size: batch.length, total_records: rows.length } });
}
return output;"""

nodes = [{"parameters": {"rule": {"interval": [{"triggerAtHour": 6, "triggerAtMinute": 30}]}}, "type": "n8n-nodes-base.scheduleTrigger",
          "typeVersion": 1.3, "position": [380, 600], "id": "wam-trigger", "name": "Daily 06:30 IST"}]
conns = {"Daily 06:30 IST": {"main": [[]]}}
for i, (table, qid, key, cols) in enumerate(BRANCHES):
    y = 400 + i * 220
    mb, code, sf = f"Metabase #{qid}", f"MERGE batches {table}", f"Snowflake {table}"
    nodes += [
        {"parameters": {"operation": "resultData", "questionId": str(qid), "format": "json", "requestOptions": {}}, "type": "n8n-nodes-base.metabase",
         "typeVersion": 1, "position": [640, y], "id": f"wam-mb-{qid}", "name": mb,
         "credentials": {"metabaseApi": {"id": "UfGJxMIN2Mre5wct", "name": "Metabase Karthik"}}},
        {"parameters": {"jsCode": CODE.replace("__TABLE__", table).replace("__KEY__", json.dumps(key)).replace("__COLS__", json.dumps([list(c) for c in cols]))},
         "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [880, y], "id": f"wam-code-{qid}", "name": code},
        {"parameters": {"operation": "executeQuery", "query": "={{ $json.sql }}"}, "type": "n8n-nodes-base.snowflake", "typeVersion": 1,
         "position": [1120, y], "id": f"wam-sf-{qid}", "name": sf, "credentials": {"snowflake": {"id": "MjVL2MU4BcIAwLLA", "name": "Snowflake account - N8N_OPS"}}},
    ]
    conns["Daily 06:30 IST"]["main"][0].append({"node": mb, "type": "main", "index": 0})
    conns[mb] = {"main": [[{"node": code, "type": "main", "index": 0}]]}
    conns[code] = {"main": [[{"node": sf, "type": "main", "index": 0}]]}

wf = {"name": "WAM (Metabase) -> Snowflake: inward ASN, issues, KPI", "nodes": nodes, "connections": conns, "settings": {"timezone": "Asia/Kolkata"}, "pinData": {}}
here = os.path.dirname(os.path.abspath(__file__))
json.dump(wf, open(os.path.join(here, "wam-to-snowflake.workflow.json"), "w", encoding="utf-8"), indent=2)

ddl = ["-- Run once in Snowflake (role with CREATE TABLE on SNITCH_DB.MAPLEMONK) before the first n8n run."]
T = {"s": "VARCHAR", "n": "NUMBER(38,4)", "d": "DATE", "t": "TIMESTAMP_NTZ"}
for table, qid, key, cols in BRANCHES:
    body = ",\n  ".join(f"{c} {T[t]}" + (" NOT NULL" if c in key else "") for c, _, t in cols)
    ddl.append(f"-- Metabase question #{qid}\nCREATE TABLE IF NOT EXISTS SNITCH_DB.MAPLEMONK.{table} (\n  {body},\n  SYNCED_AT TIMESTAMP_NTZ,\n  PRIMARY KEY ({', '.join(key)})\n);")
open(os.path.join(here, "wam-tables.sql"), "w", encoding="utf-8").write("\n\n".join(ddl) + "\n")
print("ok")
