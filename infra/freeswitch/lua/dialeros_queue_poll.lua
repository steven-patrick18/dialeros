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

-- Iter 177 — Queue position announcement cadence. We re-announce
-- whenever the caller's position changes, OR every ANNOUNCE_HEARTBEAT_SEC
-- as a reassurance heartbeat. The first poll where we know a
-- position triggers an immediate announce.
local ANNOUNCE_HEARTBEAT_SEC = 60

local admin_url = session:getVariable("dialeros_admin_url") or "http://127.0.0.1:3000"
local token = session:getVariable("dialeros_queue_token") or ""
local call_id = session:getVariable("uuid")

-- Track announcement state across poll iterations.
local last_announced_position = nil
local last_announced_at = -1

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
      elseif j.action == "hold" then
        -- Iter 177 — announce position + ETA when:
        --   * operator has the toggle on (j.announce == true)
        --   * we know our position
        --   * AND either the position has changed since last
        --     announce, or we've heartbeat'd past the
        --     ANNOUNCE_HEARTBEAT_SEC threshold.
        if j.announce and j.position and session:ready() then
          local pos = tonumber(j.position)
          local heartbeat_due =
            (elapsed - last_announced_at) >= ANNOUNCE_HEARTBEAT_SEC
          if pos and (pos ~= last_announced_position or heartbeat_due) then
            -- Pause MOH and speak: "Your position in queue is N.
            -- Estimated wait time is M seconds."
            session:execute(
              "say",
              "en NUMBER pronounced " .. tostring(pos)
            )
            if j.eta_seconds and tonumber(j.eta_seconds) then
              session:execute(
                "say",
                "en NUMBER pronounced " .. tostring(j.eta_seconds)
              )
            end
            last_announced_position = pos
            last_announced_at = elapsed
          end
        end
      end
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
