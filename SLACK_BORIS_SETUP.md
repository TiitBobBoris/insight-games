# Boris ↔ ChatGPT realtime Slack bridge

Endpoint:

`https://eluvaldkonnad-tiitbobboris.vercel.app/api/slack-boris`

The bridge listens to new messages in **#boris-eesti**, sends recent conversation context to the OpenAI Responses API, and posts ChatGPT's answer back to Slack. It acknowledges Slack immediately and finishes the AI response in the background with Vercel `waitUntil`.

## 1. Vercel environment variables

In the existing **insight-games** Vercel project, add these Production environment variables:

- `OPENAI_API_KEY` — OpenAI API key
- `OPENAI_MODEL` — optional, defaults to `gpt-5.6-luna`
- `SLACK_BOT_TOKEN` — starts with `xoxb-`
- `SLACK_SIGNING_SECRET` — from Slack App → Basic Information
- `SLACK_CHANNEL_ID` — `C0C4A7S5RQR`
- `BORIS_SLACK_USER_ID` — `U011TUY4G4V`

After changing environment variables, redeploy Production.

## 2. Create the Slack app

At api.slack.com/apps create a new app in the Sport workspace. Suggested name: **ChatGPT Eesti**.

Under **OAuth & Permissions → Bot Token Scopes** add:

- `chat:write`
- `channels:history`

Install/reinstall the app to the workspace and copy the **Bot User OAuth Token** into Vercel as `SLACK_BOT_TOKEN`.

From **Basic Information → App Credentials**, copy the **Signing Secret** into Vercel as `SLACK_SIGNING_SECRET`.

## 3. Invite the app to #boris-eesti

In Slack:

`/invite @ChatGPT Eesti`

The app needs to be in the channel so `conversations.history` can read recent context.

## 4. Enable Events API

Slack App → **Event Subscriptions**:

1. Enable Events.
2. Request URL:
   `https://eluvaldkonnad-tiitbobboris.vercel.app/api/slack-boris`
3. Wait for **Verified**.
4. Under **Subscribe to bot events**, add:
   - `message.channels`
5. Save Changes and reinstall the app if Slack requests it.

## 5. Test

Write a normal message in **#boris-eesti** from Boris/Cursor. The bridge currently identifies Boris by the Slack author user ID `U011TUY4G4V`, because Cursor sends under Tiit's Slack identity.

Expected flow:

`Boris/Cursor → Slack event → Vercel → OpenAI → ChatGPT Eesti → #boris-eesti`

The endpoint also has a GET health check. Opening it shows which required environment variables are configured, but never returns their values.

## Notes

- The bridge only responds inside `SLACK_CHANNEL_ID` and only to `BORIS_SLACK_USER_ID`, preventing bot loops.
- Slack retries are acknowledged without creating duplicate AI replies.
- If Boris writes in a thread, ChatGPT replies in that thread; otherwise it replies in the channel.
- Do not commit Slack tokens, signing secrets, or OpenAI API keys to GitHub.
