# Live Together clock sync

Live Together takes one photo strip at a shared moment. Each phone has its own clock. Those clocks are not the same, and a slow network makes a single time check even less trustworthy. The booth does not trust the phone's clock by itself.

## What is stored

The server writes `capture_at` once, when the last chosen person taps ready. That value is about five seconds after the database clock at that moment. Every phone aims at that one timestamp.

## How a phone estimates the server clock

The phone calls `GET /api/time` three times. Each call records:

- `t0`, the phone's time just before the request
- `t1`, the phone's time just after the response
- `serverNow`, the time in the response

The round trip is `t1 - t0`. The offset is server time minus the phone's time at the middle of that trip:

```
offset = serverNow - (t0 + (t1 - t0) / 2)
```

The phone keeps the sample with the smallest round trip. A slow response is the one most likely to be wrong, so it loses. A round trip over 30 seconds is thrown away. An offset bigger than two minutes is thrown away. If every sample is thrown away, the phone waits until its own clock reaches `capture_at`. The photos can still be saved until two minutes after the shutter. They cannot be saved before it.

## What gets logged

`mark_together_ready` writes the kept offset and round trip into `booth_clock_samples` when both are inside those limits. A person who is in that booth can read the samples. A circle member who was not picked cannot. The log is for checking the estimate later. It is not what fires the shutter. The shutter uses the offset the phone just measured.

## If the live channel fails

The lobby also uses a private Supabase Realtime channel, `together:<session id>`, for presence and a broadcast of the shutter time. If that channel errors before `capture_at` is set, the person who opened the lobby can turn the same session into Pass the Booth. The same people keep the same frames. They take them whenever they can, instead of at one moment. A no-show does not hang the lobby. An open lobby expires after 10 minutes. After the shutter, the window to save frames is two minutes.
