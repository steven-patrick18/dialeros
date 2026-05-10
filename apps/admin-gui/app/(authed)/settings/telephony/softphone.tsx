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
  volume: number;
  remoteIdentity: string | null;
  error: string | null;
  extension: string | null;
}

export interface SoftphoneApi extends SoftphoneState {
  toggleMute: () => void;
  setVolume: (v: number) => void;
  hangup: () => Promise<void>;
  sendDtmf: (digit: string) => void;
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
    volume: 1.0,
    remoteIdentity: null,
    error: null,
    extension: null,
  });

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const uaRef = useRef<UserAgent | null>(null);
  const registererRef = useRef<Registerer | null>(null);
  const sessionRef = useRef<Session | null>(null);

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
              // Test-call's bridge(user/<ext>) lands here. Auto-answer.
              attachAudio(invitation);
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

  const attachAudio = useCallback((session: Session) => {
    const sdh = session.sessionDescriptionHandler;
    if (!sdh || !('peerConnection' in sdh)) return;
    const pc = (sdh as { peerConnection: RTCPeerConnection }).peerConnection;
    pc.ontrack = (event) => {
      if (!audioRef.current) return;
      if (event.streams[0]) {
        audioRef.current.srcObject = event.streams[0];
      }
    };
  }, []);

  const wireSessionState = useCallback((session: Session) => {
    sessionRef.current = session;
    const remoteUri = session.remoteIdentity?.uri?.user ?? 'unknown';
    setState((prev) => ({
      ...prev,
      inCall: true,
      remoteIdentity: remoteUri,
      muted: false,
    }));

    const onStateChange = (s: SessionState) => {
      if (s === SessionState.Established) {
        setState((prev) => ({ ...prev, inCall: true }));
      }
      if (s === SessionState.Terminated) {
        setState((prev) => ({
          ...prev,
          inCall: false,
          muted: false,
          remoteIdentity: null,
        }));
        if (audioRef.current) {
          audioRef.current.srcObject = null;
        }
        sessionRef.current = null;
      }
    };
    session.stateChange.addListener(onStateChange);
  }, []);

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

  const api: SoftphoneApi = useMemo(
    () => ({
      ...state,
      toggleMute,
      setVolume,
      hangup,
      sendDtmf,
    }),
    [state, toggleMute, setVolume, hangup, sendDtmf],
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
