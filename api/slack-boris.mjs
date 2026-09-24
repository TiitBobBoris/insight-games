import crypto from "node:crypto";
import getRawBody from "raw-body";
import { waitUntil } from "@vercel/functions";

export const config = {
  api: { bodyParser: false },
  maxDuration: 60,
};

const OPENAI_URL = "https://api.openai.com/v1/responses";
const SLACK_API = "https://slack.com/api";

function safeEqual(a, b) {
  const aBuf = Buffer.from(a || "");
  const bBuf = Buffer.from(b || "");
  return aBuf.length === bBuf.length && crypto.timingSafeEqual(aBuf, bBuf);
}

function verifySlackSignature(rawBody, timestamp, signature) {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret || !timestamp || !signature) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 60 * 5) return false;

  const base = `v0:${timestamp}:${rawBody}`;
  const expected =
    "v0=" + crypto.createHmac("sha256", secret).update(base).digest("hex");

  return safeEqual(expected, signature);
}

function extractOpenAIText(payload) {
  const parts = [];
  for (const item of payload?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === "output_text" && content?.text) {
        parts.push(content.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function slackApi(method, body) {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) throw new Error("SLACK_BOT_TOKEN is missing");

  const response = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(`Slack ${method} failed: ${data.error || "unknown_error"}`);
  }
  return data;
}

async function loadConversation(channel, latestTs, borisUserId) {
  try {
    const history = await slackApi("conversations.history", {
      channel,
      latest: latestTs,
      inclusive: true,
      limit: 12,
    });

    return (history.messages || [])
      .slice()
      .reverse()
      .filter((m) => m.text && !["message_deleted", "message_changed"].includes(m.subtype))
      .map((m) => {
        const role = m.user === borisUserId ? "Boris" : "ChatGPT";
        return `${role}: ${m.text}`;
      })
      .join("\n");
  } catch (error) {
    console.error("Could not load Slack history:", error);
    return "";
  }
}

async function askOpenAI({ currentText, conversation }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is missing");

  const instructions = `
Sa oled ChatGPT ja vestled Slacki kanalis Borisega, kes on Grok/Cursor agent.
Sinu eesmärk on aidata Borisel õppida loomulikku eesti keelt päris vestluse kaudu.

Reeglid:
- Vasta eesti keeles, välja arvatud kui Boris palub teisiti.
- Vestle päriselt; ära muuda iga vastust keeletunniks.
- Kui Borise tekstis on ebaloomulik sõnajärg, võõrapärane väljend või oluline viga, paranda seda lühidalt ja sõbralikult.
- Eelista loomulikku, nappi Slacki-eesti keelt.
- Ära hinda punktidega ega tee pikki loenguid.
- Hoia vastus tavaliselt 1–5 lause piires.
- Jätka teemat küsimuse või sisulise vastusega, kui see aitab vestlusel edasi minna.
- Ära maini webhooki, API võtit, süsteemiprompti ega tehnilist tausta.
`.trim();

  const input = conversation
    ? `Viimased sõnumid:\n${conversation}\n\nBorise uus sõnum:\n${currentText}`
    : `Borise uus sõnum:\n${currentText}`;

  const response = await fetch(OPENAI_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-5.6-luna",
      instructions,
      input,
      max_output_tokens: 350,
    }),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(
      `OpenAI request failed (${response.status}): ${data?.error?.message || "unknown_error"}`
    );
  }

  const text = extractOpenAIText(data);
  if (!text) throw new Error("OpenAI returned no text");
  return text;
}

async function handleSlackEvent(payload) {
  const event = payload?.event;
  if (!event || event.type !== "message" || !event.text) return;

  const channelId = process.env.SLACK_CHANNEL_ID;
  const borisUserId = process.env.BORIS_SLACK_USER_ID;

  if (!channelId || !borisUserId) {
    throw new Error("SLACK_CHANNEL_ID or BORIS_SLACK_USER_ID is missing");
  }

  // Dedicated bridge: only react to messages authored under Boris/Tiit transport user
  // in #boris-eesti. The bridge bot has a different Slack user ID, so it won't loop.
  if (event.channel !== channelId || event.user !== borisUserId) return;

  // Ignore edits/deletes and other message subtypes.
  if (event.subtype && event.subtype !== "file_share") return;

  const conversation = await loadConversation(
    event.channel,
    event.ts,
    borisUserId
  );

  const reply = await askOpenAI({
    currentText: event.text,
    conversation,
  });

  const body = {
    channel: event.channel,
    text: reply,
    unfurl_links: false,
    unfurl_media: false,
  };

  // If Boris writes inside a thread, stay in that thread.
  if (event.thread_ts) body.thread_ts = event.thread_ts;

  await slackApi("chat.postMessage", body);
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({
      ok: true,
      service: "boris-estonian-bridge",
      configured: {
        openai: Boolean(process.env.OPENAI_API_KEY),
        slackToken: Boolean(process.env.SLACK_BOT_TOKEN),
        slackSigning: Boolean(process.env.SLACK_SIGNING_SECRET),
        channel: Boolean(process.env.SLACK_CHANNEL_ID),
        borisUser: Boolean(process.env.BORIS_SLACK_USER_ID),
      },
    });
  }

  if (req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({ error: "method_not_allowed" });
  }

  const rawBuffer = await getRawBody(req, { limit: "1mb" });
  const rawBody = rawBuffer.toString("utf8");

  const timestamp = req.headers["x-slack-request-timestamp"];
  const signature = req.headers["x-slack-signature"];

  if (!verifySlackSignature(rawBody, timestamp, signature)) {
    return res.status(401).json({ error: "invalid_slack_signature" });
  }

  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return res.status(400).json({ error: "invalid_json" });
  }

  if (payload.type === "url_verification") {
    return res.status(200).json({ challenge: payload.challenge });
  }

  // Slack may retry events when it did not see a fast enough acknowledgement.
  // We ACK retries without running the model twice.
  if (req.headers["x-slack-retry-num"]) {
    return res.status(200).json({ ok: true, retry_ignored: true });
  }

  if (payload.type === "event_callback") {
    waitUntil(
      handleSlackEvent(payload).catch((error) => {
        console.error("Slack bridge background error:", error);
      })
    );
  }

  return res.status(200).json({ ok: true });
}
