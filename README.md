# Restaurant Pitch Agents

Four Band agents collaborate to find up to two validated restaurants with weak food/menu visuals, inspect their public images, write outreach copy, create Featherless-powered visual prompts/assets, and deliver a ready-to-send pitch digest to Telegram.

This is built for the Band hackathon requirement: Band is not just a notifier. The agents use Band room tools to discover/recruit participants and pass structured work packets through the room.

## Agents

- `Lead Scout`: parses the task with Featherless, searches real restaurant websites through Exa, looks for emails, socials, and source-backed people names, then hands up to two qualified contactable candidates to the visual inspector.
- `Visual Inspector`: filters unusable image URLs, uses a Featherless vision-capable model on the usable images, and only forwards validated visual-refresh leads. It is the only agent allowed to call a photo boring.
- `Pitch Copywriter`: uses Featherless as the copywriting core and writes cold email, subject lines, DM copy, SMS copy, and personalization notes.
- `Food Design Director`: calls a Featherless image/prompt model, creates visual prompts/assets and menu footer prompts, then sends the complete digest to Telegram.

## Band Collaboration Tools Used

The TypeScript agents use Band's collaboration tool surface through the SDK. In code, the raw SDK tool names are `thenvoi_*`; the Band UI may show the service names differently.

- `list_chat_participants_service` equivalent: `thenvoi_get_participants`.
- `list_available_participants_service` equivalent: `thenvoi_lookup_peers`, checking every page.
- `add_participant_service` equivalent: `thenvoi_add_participant`.
- `send_direct_message_service`/room message equivalent: `thenvoi_send_message` with @mentions.
- Progress reporting uses `sendEvent` / `thenvoi_send_event`.
- Every packet includes a `collaborationLog`; the final Telegram digest prints the delegation/action trail.

Not used by default:

- `remove_participant_service`, because removing agents mid-workflow would break handoffs.
- `geocode_location_service` and `weather_forecast_service`, unless you want location/weather enrichment in the pitch.

## Setup

```bash
npm install
cp .env.example .env
cp agent_config.example.yaml agent_config.yaml
```

Fill in `.env`:

```bash
EXA_API_KEY=...
FEATHERLESS_API_KEY=...
FEATHERLESS_CHAT_MODEL=...
FEATHERLESS_VISION_MODEL=...
FEATHERLESS_IMAGE_MODEL=...
AGENCY_NAME="Your actual outreach brand"
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## Link To Band

The local pipeline can run without Band:

```bash
npm run dev:pipeline -- --location "Austin, TX" --cuisine "sushi restaurants" --limit 1 --search-mode quick
```

The full multi-agent workflow must be linked to Band:

1. Go to Band -> Agents.
2. Create four Remote/External Agents: `Lead Scout`, `Visual Inspector`, `Pitch Copywriter`, and `Food Design Director`.
3. Copy each Agent UUID and one-time API key.
4. Put them in `agent_config.yaml`.
5. Run `npm run dev:agents`.
6. Open a Band chat room and mention `@Lead Scout`.

Fill in `agent_config.yaml` with the four Band remote agent IDs/API keys:

```yaml
lead_scout:
  agent_id: "..."
  api_key: "..."

visual_inspector:
  agent_id: "..."
  api_key: "..."

pitch_copywriter:
  agent_id: "..."
  api_key: "..."

food_design_director:
  agent_id: "..."
  api_key: "..."
```

Use these participant names in Band, or update the mention env vars:

```bash
RESEARCH_AGENT_MENTION="@Lead Scout"
VISUAL_INSPECTOR_AGENT_MENTION="@Visual Inspector"
COPYWRITER_AGENT_MENTION="@Pitch Copywriter"
DESIGN_AGENT_MENTION="@Food Design Director"
```

## Run

Preflight:

```bash
npm run preflight
```

Run all four Band agents:

```bash
npm run dev:agents
```

Then in a Band room, ask the research agent:

```text
@Lead Scout find sushi restaurants in Austin, TX with boring menu or food photos
```

Count and search mode are intentionally bounded:

- Missing count defaults to 2.
- Requests above 2 are capped at 2.
- Missing search mode defaults to `smart`.
- Leads only move to copy/design when they have a contact path, usable visual evidence, and a non-strong visual audit.

Search mode can still be specified:

- `quick` uses Exa `fast`.
- `smart` uses Exa `auto`.
- `deep` uses Exa `deep`.
- `deep reasoning`, `very deep`, or `highest reasoning` uses Exa `deep-reasoning`.

Local API pipeline without Band, useful for debugging keys:

```bash
npm run dev:pipeline -- --location "Austin, TX" --cuisine "sushi restaurants" --search-mode smart
```

Send the local pipeline result to Telegram:

```bash
npm run dev:pipeline -- --location "Austin, TX" --cuisine "sushi restaurants" --search-mode deep --send-telegram
```

## No Mock Leads

The research workflow requires `EXA_API_KEY`. If Exa is missing or fails, the app fails instead of inventing restaurants.

Visual inspection uses Featherless vision requests against actual image URLs from Exa. If no image URLs are found, the app says that explicitly and does not claim the photos are boring.

Copywriting and design prompt creation call Featherless first. If the provider returns invalid JSON, the workflow falls back to evidence-bound copy and seeded visual prompts rather than inventing unsupported claims or blocking delivery. The system only sends generated image files when the selected Featherless model actually returns image data; otherwise it sends prompts/concepts.
