# Audio transcription

Channels exposes a provider-neutral `Transcriber` interface and a standalone
`outfitter-transcribe AUDIO_FILE` command. Slack reads attach audio transcripts to
untrusted channel context with the original author and target marker. A usable
Slack transcript is preferred; otherwise the explicitly configured backend reads
the audio. With no backend, the context says the audio is unavailable. Existing
mention intake, task deduplication, approvals, and threaded replies still apply.

## Configure a backend

Transcription is separate from the conversational model. Selecting a language
model or merely setting `OPENAI_API_KEY` does not enable audio uploads.

Managed Outfitter residents use the existing inference relay (requires the audio-enabled gateway and relay):

```sh
export TRANSCRIPTION_API=openai
export TRANSCRIPTION_BASE_URL=http://127.0.0.1:4141/v1
export TRANSCRIPTION_MODEL=gpt-transcribe
```

No provider API key is needed in the agent. The relay attaches its rotating pod
identity, and the gateway resolves the organization's authorized providers using
the web app. Audio shares inference admission limits. The first managed version
supports resolved `https://api.openai.com/v1` providers only, uses an explicit
audio model rather than a chat alias, and does not fall back between providers.

Standalone OpenAI (or a compatible transcription endpoint):

```sh
export TRANSCRIPTION_API=openai
export TRANSCRIPTION_BASE_URL=https://api.openai.com/v1
export TRANSCRIPTION_MODEL=gpt-transcribe
export TRANSCRIPTION_API_KEY_FILE=/path/to/mounted/apiKey
outfitter-transcribe recording.m4a
```

The API uses multipart `file`, `model`, and `response_format=json`, and returns
`text`. Model names are configurable: endpoint compatibility does not imply a
particular model is available. See the [OpenAI transcription guide](https://developers.openai.com/api/docs/guides/speech-to-text).

Self-hosted Whisper.cpp (AMD/Vulkan, NVIDIA/CUDA, or CPU):

```sh
# Run your hardware-appropriate whisper-server build with an existing model.
# --convert requires ffmpeg on the server for Slack's m4a clips.
whisper-server -m /path/to/model.bin --host 127.0.0.1 --port 8080 --convert
export TRANSCRIPTION_API=whisper-cpp
export TRANSCRIPTION_BASE_URL=http://127.0.0.1:8080
export TRANSCRIPTION_MODEL=small.en-tdrz
outfitter-transcribe recording.m4a
```

For a LAN server, set the base URL to its reachable address and secure the
endpoint appropriately. Whisper.cpp's `/inference` endpoint loads its model on
server startup; `TRANSCRIPTION_MODEL` identifies that configured model in the
result and does not switch server models. Its wire format differs from OpenAI,
so it has an explicit adapter selection. No model download is performed.

Use either `TRANSCRIPTION_API_KEY` or `TRANSCRIPTION_API_KEY_FILE`, never both.
The file is read on every request to support rotation. Existing Agent Operator
inference Secret mounts can supply the same authorized provider key:
`/var/run/outfitter/inference/<source-secret>/apiKey`. Set the transcription
endpoint and model explicitly; the chat model stored in that Secret may not
support transcription. No operator CRD or credential-distribution change is
required. `TRANSCRIPTION_TIMEOUT_MS` defaults to 60000 and may be 1–300000.

There is one selected backend and no automatic local-to-hosted fallback. To
keep recordings local, select a local endpoint. Changing to hosted processing
is an explicit configuration change.

## Slack file access

Direct Slack configurations download only URLs on `https://files.slack.com`
whose path identifies the referenced file, with the bot's `files:read` access.
Redirects are rejected. Managed Slack calls its own binding-scoped
`files.download` proxy with channel, message timestamp, optional thread timestamp,
and file ID; the platform verifies current membership and attachment provenance.
The corresponding platform file-download support must be deployed before managed
Slack audio fallback works. Old proxies return an explicit unavailable outcome.
Slack credentials never reach the transcription provider.

At most three distinct audio clips are read per request, prioritizing the target
message. Audio bytes are capped at 25 MB, known Slack duration at five minutes,
and transcript text at 20,000 characters per clip. Backend errors, missing
transcripts, and empty/no-speech results remain explicit. Provider error bodies
and private URLs are not copied into agent context. No raw-audio persistence or
cross-tenant transcript cache is added. Download and transcription have deadlines;
self-hosted servers should also enforce decoded-duration/concurrency limits.

## Extension boundary and validation

Other communication adapters can pass bytes to the same `Transcriber` without
Slack-specific metadata or credentials. Live calls need a separate streaming
interface; this batch adapter does not implement turn-taking, speech output,
speaker identity, or call participation.

Tests cover protocol differences, credential rotation, bounded responses,
cancellation, explicit configuration, native transcripts, and download origin
checks. The local Whisper.cpp HTTP adapter was exercised with a real 11-second
Slack recording (m4a, converted by the server). This verifies local HTTP
transcription, not transcript accuracy or an end-to-end deployed Slack reply.
Hosted OpenAI requests are contract-tested; live managed transcription still
requires deployment of the audio-enabled relay and gateway. Private recordings and results are not repository fixtures.
