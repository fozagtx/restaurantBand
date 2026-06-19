![Restaura agent workflow](assets/restaura-agents.png)

# Restaura

## Short Description

Restaura is a Band-powered agent workflow that finds validated restaurant leads, audits weak menu food images, generates better-looking food assets, and writes converting cold DM/email pitches.

## Long Description

Restaura helps a small restaurant marketing owner find a few real prospects per day instead of a long noisy list. A Lead Scout searches live restaurant websites through Exa, validates the official site, and rejects mismatched or thin results. A Visual Inspector audits public food/menu images with Featherless vision and keeps only leads where better menu food assets could help. A Pitch Copywriter turns the evidence into concise cold email, DM, and SMS copy built to start a client conversation. A Food Design Director creates food-photography directions and, when needed, uses OpenAI Images to generate a PNG food asset. Band coordinates the agent handoffs and progress updates, while Telegram is reserved for final output delivery.

## Agents

- `Lead Scout`: finds up to two validated, contactable restaurant leads.
- `Visual Inspector`: checks real public image URLs with Featherless vision.
- `Pitch Copywriter`: writes short outreach copy based only on verified evidence.
- `Food Design Director`: creates image direction and generated PNG assets for the final pitch.

## Setup

```bash
npm install
cp .env.example .env
cp agent_config.example.yaml agent_config.yaml
```

Required `.env` values:

```bash
EXA_API_KEY=...
FEATHERLESS_API_KEY=...
FEATHERLESS_CHAT_MODEL=...
FEATHERLESS_VISION_MODEL=...
FEATHERLESS_IMAGE_MODEL=...
OPENAI_API_KEY=...
OPENAI_IMAGE_MODEL=gpt-image-1-mini
AGENCY_NAME=Restaura
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## Band Setup

Create these four Remote/External Agents in Band:

- `Lead Scout`
- `Visual Inspector`
- `Pitch Copywriter`
- `Food Design Director`

Put each Band agent ID and API key in `agent_config.yaml`.

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

## Run Locally

```bash
npm run preflight
npm run dev:agents
```

Trigger the workflow from a Band room:

```text
@Lead Scout find 1 restaurant in Austin, TX with bad food/menu images
```

Band shows short progress updates. It does not post raw JSON, chain-of-thought, or internal handoff payloads.

Telegram is output-only. It receives the final lead sheet and generated image asset after the Band workflow completes.

## Deploy To Railway

Railway reads `railway.json`, builds the project, and starts the long-running worker:

```bash
npm run start
```

Set the `.env` values in Railway, plus these Band agent credentials. `agent_config.yaml` is ignored locally and is not deployed to Railway.

```bash
BAND_LEAD_SCOUT_AGENT_ID
BAND_LEAD_SCOUT_API_KEY
BAND_VISUAL_INSPECTOR_AGENT_ID
BAND_VISUAL_INSPECTOR_API_KEY
BAND_PITCH_COPYWRITER_AGENT_ID
BAND_PITCH_COPYWRITER_API_KEY
BAND_FOOD_DESIGN_DIRECTOR_AGENT_ID
BAND_FOOD_DESIGN_DIRECTOR_API_KEY
```

## Guardrails

- Missing count defaults to 2.
- Requests above 2 are capped at 2.
- Leads are rejected if the official website cannot be validated.
- The app fails instead of inventing restaurants when Exa is unavailable.
- Visual claims require usable public image URLs.
- OpenAI Images is used only when Featherless does not return a rendered image.
- Local pipeline JSON output is disabled unless `--write-json` is passed.
