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
  // Iter 50 — Web Audio plumbing for VU meters. Lazily-created shared
  // AudioContext; per-call analyser nodes torn down on hangup.
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micAnalyserRef = useRef<AnalyserNode | null>(null);
  const spkAnalyserRef = useRef<AnalyserNode | null>(null);
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

  // Iter 50 — robust media attach. Earlier versions wired pc.ontrack
  // BEFORE invitation.accept() completed, which raced with sip.js
  // populating receivers during SDP processing — by the time our
  // listener was set the ontrack event for the remote audio had
  // already fired and we lost it. Customer audio came up silent.
  // Now we run on stateChange → Established (peer connection is
  // active, receivers populated) and assemble the remote stream
  // ourselves from getReceivers(). ontrack still listens for late
  // additions (re-INVITEs, etc.).
  const attachMedia = useCallback((session: Session) => {
    const sdh = session.sessionDescriptionHandler;
    if (!sdh || !('peerConnection' in sdh)) return;
    const pc = (sdh as { peerConnection: RTCPeerConnection }).peerConnection;

    const remoteStream = new MediaStream();
    pc.getReceivers().forEach((r) => {
      if (r.track && r.track.kind === 'audio') remoteStream.addTrack(r.track);
    });
    pc.ontrack = (event) => {
      if (event.track && event.track.kind === 'audio') {
        remoteStream.addTrack(event.track);
      }
    };

    if (audioRef.current) {
      audioRef.current.srcObject = remoteStream;
      audioRef.current.muted = false;
      // Browsers can throw NotAllowedError on play() if autoplay
      // policy decided not to allow it. Safe to swallow — user can
      // toggle the volume slider to nudge it.
      audioRef.current.play().catch(() => {
        /* autoplay policy */
      });
    }

    // VU meters. AudioContext requires a user gesture on Chrome —
    // by the time a call connects the agent has already clicked
    // Call / accepted, so this is fine.
    try {
      if (!audioCtxRef.current) {
        const Ctx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        audioCtxRef.current = new Ctx();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') void ctx.resume();

      const localStream = new MediaStream();
      pc.getSenders().forEach((s) => {
        if (s.track && s.track.kind === 'audio') localStream.addTrack(s.track);
      });
      if (localStream.getAudioTracks().length > 0) {
        const src = ctx.createMediaStreamSource(localStream);
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        src.connect(an);
        micAnalyserRef.current = an;
      }
      if (remoteStream.getAudioTracks().length > 0) {
        const src = ctx.createMediaStreamSource(remoteStream);
        const an = ctx.createAnalyser();
        an.fftSize = 256;
        src.connect(an);
        spkAnalyserRef.current = an;
      }

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
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('softphone: VU setup failed', e);
    }
  }, []);

  const detachMedia = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    micAnalyserRef.current?.disconnect();
    spkAnalyserRef.current?.disconnect();
    micAnalyserRef.current = null;
    spkAnalyserRef.current = null;
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
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
    setState((prev) => ({ ...prev, volume: clamped }));
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

  // Iter 47 — local-only hold: mute the mic so far end hears nothing,
  // and mute the audio element so the agent doesn't hear anything
  // either. No SIP re-INVITE / a=sendonly yet — that's a future iter.
  // Sufficient for the agent UX of "park this call privately".
  const toggleHold = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    const sdh = session.sessionDescriptionHandler;
    if (!sdh || !('peerConnection' in sdh)) return;
    const pc = (sdh as { peerConnection: RTCPeerConnection }).peerConnection;
    let nowHeld = false;
    setState((prev) => {
      nowHeld = !prev.onHold;
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
