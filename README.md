# Dualing AI

`Dualing AI` is a local demo tool for comparing two AI agents side by side. It is intended to make two agents that should behave similarly easy to prompt, observe, and contrast in real time.

## Product Direction

The first version should optimize for a polished demo experience rather than automated evaluation. The UI should use a dark cyber/demo style with a strong side-by-side identity: the left pane uses a dark red tint and the right pane uses a dark blue tint.

The main interaction is a prompt input centered near the top of the screen. Below it, the screen is split into left and right conversation panes. A routing control next to the prompt chooses where the prompt is sent:

- `Both`, the default
- `Left`
- `Right`

When a prompt is routed to only one side, the other side remains unchanged.

## Architecture

The app should have two main parts:

- A Vite React TypeScript frontend.
- A small Node/TypeScript backend that mediates between the frontend and the agent containers.

The backend is responsible for Docker lifecycle management, routing prompts, applying timeouts, and collecting basic logs. The browser should not call the agent containers directly.

Local development defaults:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`
- Left agent: `http://localhost:8101`
- Right agent: `http://localhost:8102`

The agent ports may be overridden with environment variables. Overrides should be port-based only, not full URLs.
If an image listens on a different internal port than the host port Dualing AI should call, set the side's container-port override.

## Development

Install dependencies:

```bash
npm install
```

Launch the current Lucy comparison stack:

```bash
npm run launch
```

This builds the app, starts the backend on `http://127.0.0.1:3000`, starts the Lucy wrapper containers, waits for them to become healthy, then starts the frontend on `http://127.0.0.1:5173`. The backend also serves the built UI at `http://127.0.0.1:3000`, which is useful if your host cannot reach Vite's `5173` port. If `./lucy.env` exists, it is passed to both Lucy containers as `AGENT_ENV_FILE`.

Useful launch overrides:

```bash
WEB_PORT=5174 PORT=3001 npm run launch
LAUNCH_SKIP_BUILD=true npm run launch
AGENT_ENV_FILE=./lucy.env PROMPT_TIMEOUT_MS=180000 npm run launch
```

Run the frontend and backend together:

```bash
npm run dev
```

Build everything:

```bash
npm run build
```

Typecheck everything:

```bash
npm run typecheck
```

The backend starts the Docker-managed agents before listening on `http://localhost:3000`. If `left/Dockerfile` or `right/Dockerfile` is missing, startup fails fast by design.

Optional environment variables are shown in `.env.example`:

- `PORT`, default `3000`
- `LEFT_AGENT_PORT`, default `8101`
- `RIGHT_AGENT_PORT`, default `8102`
- `PROMPT_TIMEOUT_MS`, default `180000`
- `AGENT_ENV_FILE`, optional Docker env file passed to both sides
- `LEFT_AGENT_ENV_FILE` / `RIGHT_AGENT_ENV_FILE`, optional side-specific Docker env files
- `LEFT_AGENT_CONTAINER_PORT`, default matches `LEFT_AGENT_PORT`
- `RIGHT_AGENT_CONTAINER_PORT`, default matches `RIGHT_AGENT_PORT`

## Agent Layout

The repo should contain two agent directories:

- `left/`
- `right/`

Each directory is expected to contain a `Dockerfile` for that side's main HTTP agent container. The first version should not include placeholder/demo agents; real agent Dockerfiles are expected to be provided separately.

On backend startup, the app should build the left and right images if needed, then start both containers. On backend shutdown, it should stop the containers. If a required Dockerfile is missing or an image/container fails to build or start, the backend should fail fast with a clear error.

For more complex agent systems, Dualing AI should manage only one main HTTP container per side. Any supporting services are the responsibility of that side's Docker setup, as long as the main container exposes the required HTTP interface.

## Agent HTTP Contract

Each agent must expose this endpoint:

```http
POST /prompt
```

Request body:

```json
{
  "prompt": "Write a haiku about containers."
}
```

Response body:

```json
{
  "text": "...agent response..."
}
```

Agents should expose `GET /health` if startup takes meaningful time. The backend waits for each side's health endpoint before it starts accepting prompts.

## Runtime Behavior

Prompts are submitted into a single global queue. Only one submitted prompt is processed at a time across the app. If routed to `Both`, the left and right requests may complete independently, and each pane should update as soon as its response is available.

Agent response timeout:

- `180` seconds per side by default, configurable with `PROMPT_TIMEOUT_MS`

If one side fails or times out while the other succeeds, the successful side should still render its response and the failed side should show a side-specific error.

Streaming is not required in the first version, but the design should leave room to add streaming later.

## Conversation State

The frontend owns conversation state. The backend should remain mostly stateless aside from Docker management, request routing, queueing, timing, and logs.

The left and right panes keep separate histories. Each pane displays a chronological conversation thread for that side. Conversations do not need to persist across browser refreshes or app restarts.

Response rendering should start as plain text with whitespace preserved. Markdown rendering can be added later.

## UI Controls

The first version should include:

- Prompt input with an enter/send image button.
- Routing control with `Both`, `Left`, and `Right`.
- Separate left and right conversation panes.
- Per-response timing/status display.
- Side-specific error display.
- Basic collapsible container logs per side.
- Clear conversation control.
- Restart agents control.

Restarting agents should rebuild and recreate the left and right containers, then clear the visible conversations.
