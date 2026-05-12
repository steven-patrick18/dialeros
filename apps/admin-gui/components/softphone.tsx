'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Inviter,
  Invitation,
  Registerer,
  RegistererState,
  SessionState,
  UserAgent,
  type Session,
} from 'sip.js';
import { TransportState } from 'sip.js/lib/api/transport-state';

/**
 * Iter 35b — browser-side softphone via sip.js + WebRTC.
 *
 * Lifecycle:
 *   - On mount: GET /api/telephony/softphone-config, build a UserAgent,
 *     start it, register.
 *   - Auto-answer any incoming INVITE — the test-call flow bridges from
 *     the carrier leg into user/<ext>, and the admin's browser is
 *     "user/<ext>".
 *   - Audio: set up <audio> element, attach the remote stream from the
 *     SessionDescriptionHandler.
 *   - Controls: mute (mic off), DTMF (RFC 4733 in-band via INFO),
 *     volume (audio element), hang up (terminate session).
 *
 * Exposed as useSoftphone() — so the test-call panel can read state
 * (registered? in-call? muted?) and call control methods.
 */

export interface SoftphoneState {
  ready: boolean;
  registered: boolean;
  inCall: boolean;
  muted: boolean;
  onHold: boolean;
  volume: number;
  remoteIdentity: string | null;
  error: string | null;
  extension: string | null;
  /** Iter 124 — WS transport state separate from `registered`.
   * Browser-sleep / network-drop disconnects the transport
   * BEFORE the REGISTER refresh window fires, so a stale
   * `registered=true` would mislead the agent into thinking
   * inbound calls will land. transportState surfaces the
   * underlying WS status so the panel can render an explicit
   * "reconnecting" indicator. */
  transportConnected: boolean;
  /** Iter 50 — instantaneous level 0..1 sampled by Web Audio Analysers
   * on the mic sender and remote receiver. Driven by RAF, so consumers
   * can render VU bars without managing AudioContext themselves. */
  micLevel: number;
  spkLevel: number;
  /** Iter 54 — live RTP stats from RTCPeerConnection.getStats(). Lets
   * the panel show whether audio packets are actually flowing without
   * making the user open devtools — RX=0 mid-call means the network
   * path is broken before audio gets to the browser. */
  rxPackets: number;
  txPackets: number;
  iceState: string;
}

export interface SoftphoneApi extends SoftphoneState {
  toggleMute: () => void;
  setVolume: (v: number) => void;
  hangup: () => Promise<void>;
  /** Iter 95 — escape hatch when sip.js misses a BYE and the UI
   * sticks at "Connected" forever. Polled call-status check
   * invokes this. */
  forceClear: () => Promise<void>;
  sendDtmf: (digit: string) => void;
  toggleHold: () => void;
  /** Iter 47 — blind transfer via SIP REFER. Target is a SIP URI or
   * just an extension string; we wrap bare strings into the local
   * domain. Resolves when the REFER was sent (not when the far end
   * accepts) — the session terminates locally after a successful
   * transfer. */
  transfer: (target: string) => Promise<void>;
}

const Ctx = createContext<SoftphoneApi | null>(null);

export function useSoftphone(): SoftphoneApi {
  const c = useContext(Ctx);
  if (!c) {
    throw new Error('useSoftphone must be used inside <SoftphoneProvider>');
  }
  return c;
}

export function SoftphoneProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<SoftphoneState>({
    ready: false,
    registered: false,
    inCall: false,
    muted: false,
    onHold: false,
    volume: 1.0,
    remoteIdentity: null,
    error: null,
    extension: null,
    micLevel: 0,
    spkLevel: 0,
    rxPackets: 0,
    txPackets: 0,
    iceState: '—',
    transportConnected: false,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uaRef = useRef<UserAgent | null>(null);
  const registererRef = useRef<Registerer | null>(null);
  const sessionRef = useRef<Session | null>(null);
  // Iter 50 / 51 — Web Audio plumbing. AudioContext is the playback
  // path AND the analyser source — using it just for VU while the
  // <audio> element played the same stream caused Chrome/Firefox to
  // hijack the stream and mute the audio element. Now: source →
  // analyser → gain → ctx.destination is the only output. The gain
  // node also drives the volume slider + hold (gain=0).
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const spkAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteGainRef = useRef<GainNode | null>(null);
  const remoteSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const micSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const statsTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Set up the UA once.
  useEffect(() => {
    let cancelled = false;
    let cleanupFns: Array<() => void> = [];

    async function init() {
      try {
        const cfg = await fetch('/api/telephony/softphone-config', {
          cache: 'no-store',
        }).then((r) => {
          if (!r.ok) throw new Error(`config ${r.status}`);
          return r.json() as Promise<{
            uri: string;
            ws_url: string;
            password: string;
            extension: string;
            display_name: string;
          }>;
        });
        if (cancelled) return;

        const uri = UserAgent.makeURI(cfg.uri);
        if (!uri) throw new Error(`invalid SIP URI: ${cfg.uri}`);

        const ua = new UserAgent({
          uri,
          authorizationUsername: cfg.extension,
          authorizationPassword: cfg.password,
          displayName: cfg.display_name,
          transportOptions: {
            server: cfg.ws_url,
            // Reconnect aggressively — admin tabs hang around.
            connectionTimeout: 5,
            keepAliveInterval: 30,
          },
          // Auto-handle media — sip.js sets up RTCPeerConnection,
          // getUserMedia for the mic, and exposes the remote stream
          // via the SessionDescriptionHandler.
          sessionDescriptionHandlerFactoryOptions: {
            constraints: { audio: true, video: false },
          },
          delegate: {
            onInvite: (invitation: Invitation) => {
              // Pacer / test-call / agent-dial all reach the agent
              // via FS bridge → INVITE here. Auto-answer; media wires
              // up on stateChange → Established (see wireSessionState).
              wireSessionState(invitation);
              invitation
                .accept({
                  sessionDescriptionHandlerOptions: {
                    constraints: { audio: true, video: false },
                  },
                })
                .catch((e) => {
                  // eslint-disable-next-line no-console
                  console.error('softphone: accept failed', e);
                });
            },
          },
        });
        uaRef.current = ua;

        // Iter 124 — track the WS transport state separately
        // from REGISTER state. A backgrounded browser tab or a
        // network drop kills the WS but REGISTER is cached at
        // FS until expires; the agent still shows "REG" green
        // even though new inbound INVITEs would fail to land.
        // Surfacing transportConnected lets the panel render
        // an explicit reconnecting indicator and lets the
        // visibility/online handlers below decide when to
        // ua.reconnect().
        const transportStateChange = (s: TransportState) => {
          const connected = s === TransportState.Connected;
          setState((prev) => ({
            ...prev,
            transportConnected: connected,
            // When the transport drops, REGISTER is logically
            // stale even though the registerer hasn't fired its
            // own state change yet. Clear it pre-emptively so the
            // panel doesn't lie for the ~75% × expires window
            // until the next refresh attempt fails.
            registered: connected ? prev.registered : false,
          }));
        };
        ua.transport.stateChange.addListener(transportStateChange);
        cleanupFns.push(() =>
          ua.transport.stateChange.removeListener(transportStateChange),
        );

        await ua.start();
        if (cancelled) {
          await ua.stop();
          return;
        }

        const registerer = new Registerer(ua, {
          expires: 600,
          refreshFrequency: 75, // refresh at 75% of expires
        });
        registererRef.current = registerer;

        const stateChange = (s: RegistererState) => {
          setState((prev) => ({
            ...prev,
            registered: s === RegistererState.Registered,
          }));
        };
        registerer.stateChange.addListener(stateChange);
        cleanupFns.push(() =>
          registerer.stateChange.removeListener(stateChange),
        );

        await registerer.register();
        if (cancelled) return;

        setState((prev) => ({
          ...prev,
          ready: true,
          extension: cfg.extension,
        }));
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error('softphone init failed', e);
        if (!cancelled) {
          setState((prev) => ({
            ...prev,
            error: e instanceof Error ? e.message : String(e),
          }));
        }
      }
    }

    init();

    return () => {
      cancelled = true;
      cleanupFns.forEach((fn) => fn());
      const reg = registererRef.current;
      const ua = uaRef.current;
      if (reg) {
        reg.unregister().catch(() => {
          /* ignore */
        });
      }
      if (ua) {
        ua.stop().catch(() => {
          /* ignore */
        });
      }
    };
  }, []);

  // Iter 124 — auto-reconnect on browser sleep / network drop.
  //
  // Three trigger paths:
  //   visibilitychange  — tab comes back to foreground after the
  //                       browser throttled / suspended the WS.
  //                       Most common cause of "I had REG green but
  //                       calls weren't reaching me" complaints.
  //   online            — navigator network state flipped back to
  //                       online (wifi reconnect, suspend resume,
  //                       VPN reconnect).
  //   periodic backstop — 30s interval that re-checks if the
  //                       transport is disconnected and triggers
  //                       reconnect with single-flight guard. Last
  //                       defence in case neither event fires (some
  //                       browsers don't emit `online` reliably).
  //
  // ua.reconnect() is single-flight inside sip.js — calling it
  // while already reconnecting is a no-op. After the transport
  // comes back, the Registerer re-registers automatically.
  useEffect(() => {
    let reconnecting = false;
    async function tryReconnect(reason: string) {
      const ua = uaRef.current;
      const reg = registererRef.current;
      if (!ua) return;
      if (reconnecting) return;
      if (ua.transport.state === TransportState.Connected) return;
      reconnecting = true;
      try {
        // eslint-disable-next-line no-console
        console.info(`[softphone] reconnect attempt (${reason})`);
        await ua.reconnect();
        // Re-register once the transport is back; the Registerer
        // doesn't always fire its own refresh on transport flap.
        if (reg) {
          try {
            await reg.register();
          } catch (e) {
            // eslint-disable-next-line no-console
            console.warn('[softphone] register after reconnect failed', e);
          }
        }
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('[softphone] reconnect failed', e);
      } finally {
        reconnecting = false;
      }
    }

    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void tryReconnect('visibilitychange');
      }
    };
    const onOnline = () => {
      void tryReconnect('online');
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onOnline);

    const backstop = setInterval(() => {
      void tryReconnect('backstop');
    }, 30_000);

    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onOnline);
      clearInterval(backstop);
    };
  }, []);

  // Iter 52 — track-driven media attach.
  //
  //   remoteStream → MediaStreamSource → AnalyserNode (VU)
  //                                    → GainNode (volume + hold)
  //                                    → ctx.destination
  //
  // Critical: MediaStreamAudioSourceNode binds to the FIRST audio
  // track present in the stream at creation time and does NOT pick
  // up tracks added later. Earlier versions built a fresh empty
  // MediaStream then dumped getReceivers tracks into it — if the
  // receiver track wasn't ready at Established (common: ontrack
  // fires a tick later), the source was bound to a track-less
  // stream forever and SPK level stayed flat. Now we wait for an
  // actual track via ontrack and also probe getReceivers once for
  // the already-present case. The chain is built exactly once per
  // call (idempotent guards on the refs).
  const attachMedia = useCallback((session: Session) => {
    const sdh = session.sessionDescriptionHandler;
    if (!sdh || !('peerConnection' in sdh)) return;
    const pc = (sdh as { peerConnection: RTCPeerConnection }).peerConnection;

    if (!audioCtxRef.current) {
      const Ctx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtxRef.current = new Ctx();
    }
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') void ctx.resume();

    function buildRemoteChain(track: MediaStreamTrack) {
      if (spkAnalyserRef.current) return; // already built
      try {
        const stream = new MediaStream([track]);
        // Iter 54d — hybrid playback. The <audio> element is the
        // primary playback path (Chrome's preferred WebRTC code path,
        // works reliably) but pinned to volume 0 so it doesn't
        // produce sound on its own. The decoder stays running because
        // the element is actively consuming the stream — that
        // satisfies the WebRTC stack's "is this track being used"
        // check that gates PCM decoding to the AudioContext.
        //
        // The actual audible output goes through the AudioContext
        // chain with a GainNode that can boost above 1.0 — useful
        // because PCMU @ 8kHz is roughly half the perceived loudness
        // of Opus @ 48kHz. The volume slider still maps 0–1, but a
        // 1.5x boost is baked into the gain so 100% on the slider
        // is loud enough to hear comfortably on earbuds.
        if (audioRef.current) {
          audioRef.current.srcObject = stream;
          audioRef.current.muted = false;
          audioRef.current.volume = 0;
          audioRef.current.play().catch(() => {
            /* autoplay blocked — silent element should be allowed */
          });
        }
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        const gain = ctx.createGain();
        gain.gain.value = state.volume * 1.5;
        src.connect(an);
        an.connect(gain);
        gain.connect(ctx.destination);
        remoteSourceRef.current = src;
        spkAnalyserRef.current = an;
        remoteGainRef.current = gain;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('softphone: remote chain failed', e);
      }
    }

    function buildMicChain(track: MediaStreamTrack) {
      if (micAnalyserRef.current) return;
      try {
        const stream = new MediaStream([track]);
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        src.connect(an);
        // Mic NEVER connects to destination — that would echo the
        // agent's voice back at them.
        micSourceRef.current = src;
        micAnalyserRef.current = an;
      } catch (e) {
        // eslint-disable-next-line no-console
        console.warn('softphone: mic chain failed', e);
      }
    }

    // Probe what's already in place at Established …
    const existingReceiver = pc
      .getReceivers()
      .find((r) => r.track && r.track.kind === 'audio');
    if (existingReceiver?.track) buildRemoteChain(existingReceiver.track);

    const existingSender = pc
      .getSenders()
      .find((s) => s.track && s.track.kind === 'audio');
    if (existingSender?.track) buildMicChain(existingSender.track);

    // … and react to anything that lands later (e.g. re-INVITE,
    // mic permission resolved late, etc.).
    pc.ontrack = (event) => {
      if (event.track && event.track.kind === 'audio') {
        buildRemoteChain(event.track);
      }
    };

    // Iter 54 — surface ICE / connection state changes to the
    // browser console (no console.log noise unless the call
    // actually changes state) and to softphone state for the LCD.
    pc.oniceconnectionstatechange = () => {
      // eslint-disable-next-line no-console
      console.info('softphone ICE:', pc.iceConnectionState);
      setState((prev) => ({ ...prev, iceState: pc.iceConnectionState }));
    };
    pc.onconnectionstatechange = () => {
      // eslint-disable-next-line no-console
      console.info('softphone PC:', pc.connectionState);
    };

    // Iter 54 — RTP throughput poller. Reads getStats() once a
    // second; surfaces `rxPackets` + `txPackets` to softphone state
    // so the panel can render them in the LCD. RX=0 mid-call means
    // the audio never reaches the browser (FS / NAT / DTLS / ICE
    // problem); RX>0 but SPK level=0 means it reaches but isn't
    // decoding into PCM (codec / decoder issue).
    statsTimerRef.current = setInterval(() => {
      void pc.getStats().then((stats) => {
        let rx = 0;
        let tx = 0;
        stats.forEach((s) => {
          const r = s as Record<string, unknown>;
          if (r.type === 'inbound-rtp' && r.kind === 'audio') {
            rx += Number(r.packetsReceived ?? 0);
          }
          if (r.type === 'outbound-rtp' && r.kind === 'audio') {
            tx += Number(r.packetsSent ?? 0);
          }
        });
        setState((prev) => {
          if (prev.rxPackets === rx && prev.txPackets === tx) return prev;
          return { ...prev, rxPackets: rx, txPackets: tx };
        });
      });
    }, 1000);

    const buf = new Uint8Array(256);
    const sample = () => {
      let mic = 0;
      let spk = 0;
      const m = micAnalyserRef.current;
      const s = spkAnalyserRef.current;
      if (m) {
        m.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]! - 128) / 128;
          if (v > peak) peak = v;
        }
        mic = peak;
      }
      if (s) {
        s.getByteTimeDomainData(buf);
        let peak = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = Math.abs(buf[i]! - 128) / 128;
          if (v > peak) peak = v;
        }
        spk = peak;
      }
      setState((prev) => {
        if (
          Math.abs(prev.micLevel - mic) < 0.02 &&
          Math.abs(prev.spkLevel - spk) < 0.02
        ) {
          return prev;
        }
        return { ...prev, micLevel: mic, spkLevel: spk };
      });
      rafRef.current = requestAnimationFrame(sample);
    };
    if (rafRef.current === null) {
      rafRef.current = requestAnimationFrame(sample);
    }
  }, [state.volume]);

  const detachMedia = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (statsTimerRef.current !== null) {
      clearInterval(statsTimerRef.current);
      statsTimerRef.current = null;
    }
    try {
      remoteSourceRef.current?.disconnect();
      micSourceRef.current?.disconnect();
      micAnalyserRef.current?.disconnect();
      spkAnalyserRef.current?.disconnect();
      remoteGainRef.current?.disconnect();
    } catch {
      /* already disconnected */
    }
    remoteSourceRef.current = null;
    micSourceRef.current = null;
    micAnalyserRef.current = null;
    spkAnalyserRef.current = null;
    remoteGainRef.current = null;
    setState((prev) => ({
      ...prev,
      micLevel: 0,
      spkLevel: 0,
      rxPackets: 0,
      txPackets: 0,
      iceState: '—',
    }));
  }, []);

  const wireSessionState = useCallback(
    (session: Session) => {
      sessionRef.current = session;
      const remoteUri = session.remoteIdentity?.uri?.user ?? 'unknown';
      setState((prev) => ({
        ...prev,
        inCall: true,
        remoteIdentity: remoteUri,
        muted: false,
        onHold: false,
      }));

      const onStateChange = (s: SessionState) => {
        if (s === SessionState.Established) {
          // Iter 50 — attach media here, NOT on onInvite. By the time
          // we hit Established the peer connection has finished
          // negotiation and getReceivers() returns the remote audio
          // track, so the customer's audio actually plays.
          attachMedia(session);
          setState((prev) => ({ ...prev, inCall: true }));
        }
        if (s === SessionState.Terminated) {
          detachMedia();
          setState((prev) => ({
            ...prev,
            inCall: false,
            muted: false,
            onHold: false,
            remoteIdentity: null,
          }));
          if (audioRef.current) {
            audioRef.current.srcObject = null;
            audioRef.current.muted = false;
          }
          sessionRef.current = null;
        }
      };
      session.stateChange.addListener(onStateChange);
    },
    [attachMedia, detachMedia],
  );

  const toggleMute = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const sdh = session.sessionDescriptionHandler;
    if (!sdh || !('peerConnection' in sdh)) return;
    const pc = (sdh as { peerConnection: RTCPeerConnection }).peerConnection;
    let nowMuted = false;
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === 'audio') {
        sender.track.enabled = !sender.track.enabled;
        nowMuted = !sender.track.enabled;
      }
    });
    setState((prev) => ({ ...prev, muted: nowMuted }));
  }, []);

  const setVolume = useCallback((v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    // Iter 54d — playback amplitude is a GainNode (with 1.5x boost
    // baked in to compensate for low-loudness PCMU codecs); the
    // audio element stays pinned to volume=0 to keep the decoder
    // alive without producing audible sound. Hold pins gain to 0.
    setState((prev) => {
      if (remoteGainRef.current && !prev.onHold) {
        remoteGainRef.current.gain.value = clamped * 1.5;
      }
      return { ...prev, volume: clamped };
    });
  }, []);

  const hangup = useCallback(async () => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      // Inviter (we placed) vs Invitation (they invited us) — both
      // expose a generic dispose() that cleanly tears down whichever
      // direction the session is in.
      if (session instanceof Invitation) {
        await session.bye();
      } else if (session instanceof Inviter) {
        if (session.state === SessionState.Established) {
          await session.bye();
        } else {
          await session.cancel();
        }
      }
    } catch {
      /* ignore — server may have already torn down */
    }
  }, []);

  /** Iter 95 — emergency "the call's actually gone, just clean up
   * the UI" escape hatch. Used by the call-status poll fallback
   * when FS has hung up but sip.js missed the BYE (transient WS
   * drop, proxy quirk, etc.) and the agent's UI sticks at
   * "Connected" forever. Tries a normal hangup first, then
   * unconditionally clears local state + detaches media. Safe to
   * call when there's no session — it just no-ops the cleanup. */
  const forceClear = useCallback(async () => {
    try {
      await hangup();
    } catch {
      /* ignore */
    }
    detachMedia();
    if (audioRef.current) {
      audioRef.current.srcObject = null;
      audioRef.current.muted = false;
    }
    sessionRef.current = null;
    setState((prev) => ({
      ...prev,
      inCall: false,
      muted: false,
      onHold: false,
      remoteIdentity: null,
    }));
  }, [hangup, detachMedia]);

  const sendDtmf = useCallback((digit: string) => {
    const session = sessionRef.current;
    if (!session) return;
    try {
      session.info({
        requestOptions: {
          body: {
            contentDisposition: 'render',
            contentType: 'application/dtmf-relay',
            content: `Signal=${digit}\r\nDuration=160`,
          },
        },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('softphone: dtmf failed', e);
    }
  }, []);

  // Iter 56 — real SIP hold via re-INVITE with an SDP modifier that
  // flips a=sendrecv ↔ a=sendonly on the local description. The far
  // end sees a proper hold (some carriers play MoH for the
  // recipient, etc.) and reciprocates. We still belt-and-suspender
  // by muting the local mic + pinning the playback GainNode to 0
  // so even if the re-INVITE is rejected the agent perceives hold.
  const toggleHold = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const sdh = session.sessionDescriptionHandler;
    if (!sdh || !('peerConnection' in sdh)) return;
    const pc = (sdh as { peerConnection: RTCPeerConnection }).peerConnection;

    const nowHeld = !state.onHold;
    setState((prev) => {
      if (remoteGainRef.current) {
        remoteGainRef.current.gain.value = nowHeld ? 0 : prev.volume * 1.5;
      }
      return { ...prev, onHold: nowHeld, muted: nowHeld ? true : prev.muted };
    });
    pc.getSenders().forEach((sender) => {
      if (sender.track && sender.track.kind === 'audio') {
        sender.track.enabled = !nowHeld;
      }
    });
    if (audioRef.current) {
      audioRef.current.muted = nowHeld;
    }

    // Iter 56 — send a re-INVITE with the appropriate SDP direction.
    // sip.js routes session.invite() through the same SDH so the
    // modifier rewrites the local offer before it's sent. Far end
    // confirms with sendrecv/recvonly in its answer. We fire-and-
    // forget — the local mic + speaker muting above already give
    // the agent a working hold even if the re-INVITE 4xx's.
    const sdpModifier = (
      description: RTCSessionDescriptionInit,
    ): Promise<RTCSessionDescriptionInit> => {
      if (!description.sdp) return Promise.resolve(description);
      const newDirection = nowHeld ? 'a=sendonly' : 'a=sendrecv';
      const sdp = description.sdp
        .replace(/a=sendrecv/g, newDirection)
        .replace(/a=sendonly/g, newDirection)
        .replace(/a=recvonly/g, newDirection)
        .replace(/a=inactive/g, newDirection);
      return Promise.resolve({ ...description, sdp });
    };
    void session
      .invite({
        sessionDescriptionHandlerModifiers: [sdpModifier],
      })
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.warn('softphone: hold re-INVITE failed', e);
      });
  }, [state.onHold]);

  // Iter 47 — blind transfer via SIP REFER. The agent types a target;
  // we wrap bare digits/extensions into a sip: URI against the same
  // domain we registered to (sip:<target>@<domain>). For SIP URIs
  // (with @) we pass through. After REFER the local session
  // terminates and the far end is connected to the target.
  const transfer = useCallback(async (target: string) => {
    const session = sessionRef.current;
    const ua = uaRef.current;
    if (!session || !ua) return;
    const trimmed = target.trim();
    if (trimmed.length === 0) return;
    const uriString = trimmed.includes('@')
      ? trimmed.startsWith('sip:')
        ? trimmed
        : `sip:${trimmed}`
      : (() => {
          const reg = ua.configuration?.uri?.host ?? '127.0.0.1';
          return `sip:${trimmed}@${reg}`;
        })();
    const uri = UserAgent.makeURI(uriString);
    if (!uri) {
      // eslint-disable-next-line no-console
      console.error('softphone: invalid transfer target', uriString);
      return;
    }
    try {
      await session.refer(uri);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('softphone: transfer failed', e);
    }
  }, []);

  const api: SoftphoneApi = useMemo(
    () => ({
      ...state,
      toggleMute,
      setVolume,
      hangup,
      forceClear,
      sendDtmf,
      toggleHold,
      transfer,
    }),
    [
      state,
      toggleMute,
      setVolume,
      hangup,
      forceClear,
      sendDtmf,
      toggleHold,
      transfer,
    ],
  );

  return (
    <Ctx.Provider value={api}>
      {/* Hidden audio sink — the only way to play remote SIP audio in a
          browser is to bind the remote stream to an HTMLAudioElement.
          autoPlay is required because we attach the stream
          programmatically. */}
      <audio ref={audioRef} autoPlay playsInline />
      {children}
    </Ctx.Provider>
  );
}
