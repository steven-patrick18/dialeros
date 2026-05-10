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
  /** Iter 50 — instantaneous level 0..1 sampled by Web Audio Analysers
   * on the mic sender and remote receiver. Driven by RAF, so consumers
   * can render VU bars without managing AudioContext themselves. */
  micLevel: number;
  spkLevel: number;
}

export interface SoftphoneApi extends SoftphoneState {
  toggleMute: () => void;
  setVolume: (v: number) => void;
  hangup: () => Promise<void>;
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
        const src = ctx.createMediaStreamSource(stream);
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        const gain = ctx.createGain();
        gain.gain.value = state.volume;
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
    setState((prev) => ({ ...prev, micLevel: 0, spkLevel: 0 }));
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
    // Iter 51 — playback runs through the AudioContext GainNode now,
    // not the <audio> element. While on hold the gain stays pinned
    // at 0; the slider value is remembered so we can restore on
    // unhold.
    setState((prev) => {
      if (remoteGainRef.current && !prev.onHold) {
        remoteGainRef.current.gain.value = clamped;
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

  // Iter 47 / 51 — local-only hold: silence the mic sender so the
  // far end hears nothing, and pin the playback GainNode to 0 so
  // the agent doesn't hear them either. No SIP re-INVITE /
  // a=sendonly yet — that's a future iter.
  const toggleHold = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const sdh = session.sessionDescriptionHandler;
    if (!sdh || !('peerConnection' in sdh)) return;
    const pc = (sdh as { peerConnection: RTCPeerConnection }).peerConnection;
    let nowHeld = false;
    setState((prev) => {
      nowHeld = !prev.onHold;
      // Pin gain to 0 on hold; restore the slider value on unhold.
      if (remoteGainRef.current) {
        remoteGainRef.current.gain.value = nowHeld ? 0 : prev.volume;
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
  }, []);

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
      sendDtmf,
      toggleHold,
      transfer,
    }),
    [state, toggleMute, setVolume, hangup, sendDtmf, toggleHold, transfer],
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
