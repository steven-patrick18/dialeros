-- Iter 116 — FS Lua poll loop for the inbound hold-queue.
--
-- Companion to dialeros_inbound_queue.xml. Plays MOH while
-- polling /api/internal/queue-poll every QUEUE_POLL_SEC seconds.
-- Responds to `action`:
--   forward    → bridge to target_uri
--   hold       → keep playing MOH
--   abandoned  → hangup (caller already gone / row expired)
--   unknown    → hangup (this Call-ID isn't in the queue table)
--
-- Hard cap MAX_WAIT_SEC enforced from the Lua side as a safety
-- net even if DialerOS's expireStaleQueuedCalls misses a row.

local cjson = require("cjson")

local QUEUE_POLL_SEC = 3
local MAX_WAIT_SEC = 600        -- 10 min; mirrors expireStaleQueuedCalls
local MOH_STREAM = "local_stream://moh"

local admin_url = session:getVariable("dialeros_admin_url") or "http://127.0.0.1:3000"
local token = session:getVariable("dialeros_queue_token") or ""
local call_id = session:getVariable("uuid")

-- Start MOH on the caller's channel. playback is blocking, so we
-- arm it as a non-blocking pre_answer + record_session would be —
-- instead we just kick it on a thread and use sleep + poll loop.
-- mod_playback's `loops=` arg replays MOH while we poll.
session:execute("playback", MOH_STREAM)

local elapsed = 0
while session:ready() and elapsed < MAX_WAIT_SEC do
  -- mod_curl is invoked via the API for portability; mod_http_client
  -- works too but isn't installed by default on every distro.
  local payload = cjson.encode({ call_id = call_id })
  local headers = "-H 'Content-Type: application/json' -H 'X-Inbound-Token: " .. token .. "'"
  local api = freeswitch.API()
  local resp = api:execute("curl", admin_url .. "/api/internal/queue-poll content-type 'application/json' post '" .. payload .. "'")

  -- Body parse — mod_curl returns headers + body separated. Pick
  -- out the JSON object from the response.
  local body = resp and resp:match("({.-})%s*$")
  if body then
    local ok, j = pcall(cjson.decode, body)
    if ok and j then
      if j.action == "forward" and j.target_uri then
        session:execute("bridge", j.target_uri)
        return
      elseif j.action == "abandoned" or j.action == "unknown" then
        break
      end
      -- action=hold → fall through and continue the loop
    end
  end

  freeswitch.msleep(QUEUE_POLL_SEC * 1000)
  elapsed = elapsed + QUEUE_POLL_SEC
end

-- Caller still here but we hit MAX_WAIT_SEC, or the row vanished.
-- Hang up gracefully — the api_hangup_hook on the extension fires
-- the final hangup=true POST so the row gets expired with the
-- right reason.
if session:ready() then
  session:execute("playback", "ivr/ivr-thank_you.wav")
  session:hangup("NORMAL_CLEARING")
end
