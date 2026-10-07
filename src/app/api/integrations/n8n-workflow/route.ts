import { NextResponse } from "next/server";
import { getUser, canManage } from "@/server/auth";
import { waConfig } from "@/server/integrations/whatsapp";

// Downloadable n8n workflow: Webhook → secret check → WhatsApp (Meta Cloud API via HTTP Request) → respond.
// Swap the HTTP node for your WhatsApp provider (Interakt / Gupshup / AiSensy) if you don't use Meta directly.
export async function GET() {
  const u = await getUser();
  if (!u || !canManage(u)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const cfg = await waConfig();
  const wf = {
    name: "Central Ops → WhatsApp reminders",
    nodes: [
      { parameters: { httpMethod: "POST", path: "central-ops-whatsapp", responseMode: "responseNode", options: {} }, name: "Central Ops webhook", type: "n8n-nodes-base.webhook", typeVersion: 2, position: [0, 0], webhookId: "central-ops-whatsapp" },
      { parameters: { conditions: { options: { caseSensitive: true, typeValidation: "strict" }, combinator: "and",
          conditions: [{ id: "secret", leftValue: "={{ $json.headers['x-central-ops-secret'] }}", rightValue: cfg.secret || "PASTE_SECRET_FROM_CENTRAL_OPS", operator: { type: "string", operation: "equals" } }] }, options: {} },
        name: "Secret matches?", type: "n8n-nodes-base.if", typeVersion: 2, position: [240, 0] },
      { parameters: { method: "POST", url: "https://graph.facebook.com/v21.0/YOUR_PHONE_NUMBER_ID/messages", authentication: "genericCredentialType", genericAuthType: "httpHeaderAuth",
          sendBody: true, specifyBody: "json",
          jsonBody: "={{ JSON.stringify({ messaging_product: 'whatsapp', to: $json.body.to, type: 'template', template: { name: $json.body.template, language: { code: $json.body.language || 'en' }, components: [{ type: 'body', parameters: $json.body.params.map(t => ({ type: 'text', text: String(t) })) }] } }) }}",
          options: {} },
        name: "Send WhatsApp (Meta Cloud API)", type: "n8n-nodes-base.httpRequest", typeVersion: 4.2, position: [500, -100], notes: "Credential: Header Auth → Name: Authorization, Value: Bearer <permanent access token>" },
      { parameters: { respondWith: "json", responseBody: "={{ { ok: true } }}", options: {} }, name: "Sent", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [760, -100] },
      { parameters: { respondWith: "json", responseBody: "={{ { ok: false, error: 'bad secret' } }}", options: { responseCode: 401 } }, name: "Reject", type: "n8n-nodes-base.respondToWebhook", typeVersion: 1.1, position: [500, 120] },
    ],
    connections: {
      "Central Ops webhook": { main: [[{ node: "Secret matches?", type: "main", index: 0 }]] },
      "Secret matches?": { main: [[{ node: "Send WhatsApp (Meta Cloud API)", type: "main", index: 0 }], [{ node: "Reject", type: "main", index: 0 }]] },
      "Send WhatsApp (Meta Cloud API)": { main: [[{ node: "Sent", type: "main", index: 0 }]] },
    },
    settings: { executionOrder: "v1" },
  };
  return new NextResponse(JSON.stringify(wf, null, 2), { headers: { "content-type": "application/json", "content-disposition": 'attachment; filename="central-ops-whatsapp.n8n.json"' } });
}
