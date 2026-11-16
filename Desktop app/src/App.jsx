import { useState, useRef, useEffect } from 'react';

// Invoke a Tauri command. Returns { ok, value | error } so callers can show status.
const tauriInvoke = async (cmd, args) => {
    try {
        let value;
        if (window.__TAURI__?.tauri?.invoke) {
            value = await window.__TAURI__.tauri.invoke(cmd, args);
        } else {
            const { invoke } = await import('@tauri-apps/api/tauri');
            value = await invoke(cmd, args);
        }
        return { ok: true, value };
    } catch (err) {
        console.warn(`Tauri command '${cmd}' failed:`, err);
        return { ok: false, error: String(err?.message || err) };
    }
};

const safeInvoke = async (cmd, args) => (await tauriInvoke(cmd, args)).value;

// Small pill showing whether Windows accepted the capture exclusion
function StealthBadge({ stealth }) {
    const color = stealth.ok === null ? '#94a3b8' : stealth.ok ? '#34d399' : '#f87171';
    const label = stealth.ok === null ? 'Checking...' : stealth.ok ? 'Hidden' : 'Visible';
    return (
        <span
            title={stealth.detail || 'Screen-capture exclusion status'}
            style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '999px',
                border: `1px solid ${color}`,
                color,
                fontWeight: 600,
            }}
        >
            {label}
        </span>
    );
}

// Initiate native window dragging in Tauri
const safeStartDragging = async (e) => {
    // Only primary left click initiates drag
    if (e.button !== 0) return;
    try {
        if (window.__TAURI__?.window?.appWindow?.startDragging) {
            await window.__TAURI__.window.appWindow.startDragging();
            return;
        }
        const { appWindow } = await import('@tauri-apps/api/window');
        await appWindow.startDragging();
    } catch (err) {
        console.warn('startDragging unavailable:', err);
    }
};

export default function App() {
    const [pin, setPin] = useState('');
    const [serverUrl, setServerUrl] = useState('http://localhost:8000');
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [connected, setConnected] = useState(false);
    const [sessionEnded, setSessionEnded] = useState(false);
    const [statusText, setStatusText] = useState('');
    const [error, setError] = useState('');
    const [currentQuestion, setCurrentQuestion] = useState('');
    const [answerStream, setAnswerStream] = useState('');
    const [liveSpoken, setLiveSpoken] = useState('');
    const [transcriptLines, setTranscriptLines] = useState([]);
    const [isClickThrough, setIsClickThrough] = useState(false);
    const [fontSize, setFontSize] = useState(15);
    const [opacity, setOpacity] = useState(90);
    const [stealth, setStealth] = useState({ ok: null, detail: '' });
    const isClickThroughRef = useRef(false);
    const wsRef = useRef(null);
    const feedRef = useRef(null);

    // Auto-scroll feed to bottom when new content arrives
    useEffect(() => {
        if (feedRef.current) {
            feedRef.current.scrollTop = feedRef.current.scrollHeight;
        }
    }, [answerStream, liveSpoken, transcriptLines]);

    // Apply screen-capture exclusion and record whether Windows accepted it
    const applyStealth = async (ignoreMouse) => {
        const res = await tauriInvoke('apply_stealth', { enableCaptureExclude: true, ignoreMouse });
        setStealth(res.ok ? { ok: true, detail: res.value } : { ok: false, detail: res.error });
        return res;
    };

    // Apply on load, then re-check periodically so the overlay never stays visible
    useEffect(() => {
        applyStealth(false);
        const id = setInterval(() => applyStealth(isClickThroughRef.current), 5000);
        return () => clearInterval(id);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        isClickThroughRef.current = isClickThrough;
    }, [isClickThrough]);

    const toggleClickThrough = async () => {
        const next = !isClickThrough;
        setIsClickThrough(next);
        await applyStealth(next);
    };

    const disconnect = async () => {
        if (wsRef.current) {
            wsRef.current.close();
            wsRef.current = null;
        }
        setConnected(false);
        setIsClickThrough(false);
        await applyStealth(false);
    };

    const closeWindow = async () => {
        try {
            if (wsRef.current) {
                wsRef.current.close();
                wsRef.current = null;
            }
            const res = await tauriInvoke('close_app');
            if (!res.ok) {
                if (window.__TAURI__?.window?.appWindow?.close) {
                    await window.__TAURI__.window.appWindow.close();
                    return;
                }
                const { appWindow } = await import('@tauri-apps/api/window');
                await appWindow.close();
            }
        } catch (err) {
            console.warn('closeWindow error:', err);
            window.close();
        }
    };

    const connectToSession = async (e) => {
        e.preventDefault();
        setError('');
        setStatusText('Redeeming code with Vren AI backend...');

        const cleanPin = pin.trim();
        if (!cleanPin) {
            setError('Please enter your 6-digit PIN.');
            return;
        }

        try {
            // 1. Redeem pairing PIN code with backend
            const cleanServer = serverUrl.trim().replace(/\/$/, '');
            const redeemRes = await fetch(`${cleanServer}/v1/pairing/redeem`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ code: cleanPin, role: 'display' }),
            });

            if (!redeemRes.ok) {
                const errData = await redeemRes.json().catch(() => ({}));
                const msg = errData.error?.message || errData.message || 'Invalid or expired PIN. Check the code on the web app.';
                throw new Error(msg);
            }

            const { session_id, ws_token, ws_path } = await redeemRes.json();
            setStatusText('Connecting to live interview socket...');

            // 2. Open live WebSocket connection
            const wsBase = cleanServer.replace(/^http/, 'ws');
            const targetPath = ws_path || `/v1/live/${session_id}`;
            const wsUrl = `${wsBase}${targetPath}?token=${ws_token}`;

            const ws = new WebSocket(wsUrl);
            wsRef.current = ws;

            ws.onopen = async () => {
                setConnected(true);
                setSessionEnded(false);
                setStatusText('');
                setAnswerStream('');
                setTranscriptLines([]);
                setCurrentQuestion('');
                await applyStealth(isClickThroughRef.current);
            };

            ws.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);

                    // Maintain heartbeat
                    if (data.type === 'client.ping') {
                        ws.send(JSON.stringify({ type: 'client.pong' }));
                        return;
                    }

                    if (data.type === 'transcript.delta') {
                        const text = String(data.text || '');
                        const src = String(data.source || 'tab');
                        const speaker = src === 'microphone' ? 'You' : 'Interviewer';
                        setLiveSpoken(text ? `${speaker}: ${text}` : '');
                    } else if (data.type === 'transcript.completed') {
                        setLiveSpoken('');
                        setTranscriptLines((prev) => [
                            ...prev.slice(-25),
                            {
                                id: data.item_id || Math.random().toString(),
                                speaker: data.speaker || (data.source === 'microphone' ? 'You' : 'Interviewer'),
                                text: data.text || '',
                                timestamp: data.timestamp || '',
                            },
                        ]);
                    } else if (data.type === 'question.detected') {
                        setCurrentQuestion(data.text || 'Question detected');
                    } else if (data.type === 'answer.started') {
                        setCurrentQuestion(data.question_text || 'Answering question...');
                        setAnswerStream('');
                    } else if (data.type === 'answer.delta') {
                        setAnswerStream((prev) => prev + (data.delta || ''));
                    } else if (data.type === 'answer.ready') {
                        const ans = data.answer?.answer || data.answer?.outline?.join(' ') || '';
                        if (ans) setAnswerStream(ans);
                    } else if (data.type === 'answer.unavailable') {
                        setAnswerStream('Answer unavailable.');
                    } else if (data.type === 'session.ended' || data.type === 'session.finalized') {
                        setSessionEnded(true);
                        setIsClickThrough(false);
                        applyStealth(false);
                        setAnswerStream((prev) => prev ? `${prev}\n\n[Session ended]` : '[Session ended]');
                    }
                } catch (parseErr) {
                    console.error('Failed to parse socket message:', parseErr);
                }
            };

            ws.onclose = async () => {
                setSessionEnded(true);
                setConnected(false);
                setIsClickThrough(false);
                await applyStealth(false);
            };

            ws.onerror = (err) => {
                console.error('WebSocket encountered an error:', err);
                setError('WebSocket connection error. Is the backend server running?');
            };
        } catch (err) {
            console.error(err);
            const msg = err.message === 'Failed to fetch'
                ? `Cannot connect to server at ${serverUrl}. Make sure the backend API is running on port 8000.`
                : (err.message || 'Failed to connect.');
            setError(msg);
            setStatusText('');
        }
    };

    // -------------------------------------------------------------
    // Screen 1: PIN Connection & Repositioning Screen
    // -------------------------------------------------------------
    if (!connected) {
        return (
            <div
                style={{
                    padding: '16px',
                    backgroundColor: `rgba(15, 17, 23, ${opacity / 100})`,
                    height: '100vh',
                    boxSizing: 'border-box',
                    borderRadius: '12px',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    display: 'flex',
                    flexDirection: 'column',
                    fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                    color: '#e2e8f0',
                    userSelect: 'none',
                    backdropFilter: 'blur(16px)',
                }}
            >
                {/* Drag Handle Bar */}
                <div
                    data-tauri-drag-region
                    onMouseDown={safeStartDragging}
                    style={{
                        height: '38px',
                        backgroundColor: 'rgba(255, 255, 255, 0.08)',
                        color: '#94a3b8',
                        cursor: 'grab',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '0 12px',
                        marginBottom: '16px',
                        borderRadius: '8px',
                        fontSize: '12px',
                        fontWeight: '600',
                        letterSpacing: '0.05em',
                        border: '1px solid rgba(255, 255, 255, 0.06)',
                    }}
                >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>≡</span>
                        <span>DRAG TO POSITION</span>
                    </span>
                    <div
                        onMouseDown={(e) => e.stopPropagation()}
                        style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                    >
                        <StealthBadge stealth={stealth} />
                        <button
                            type="button"
                            onClick={closeWindow}
                            title="Close AudioCore window"
                            style={{
                                padding: '2px 7px',
                                fontSize: '11px',
                                fontWeight: '600',
                                backgroundColor: 'rgba(239, 68, 68, 0.2)',
                                color: '#fca5a5',
                                border: '1px solid rgba(239, 68, 68, 0.35)',
                                borderRadius: '5px',
                                cursor: 'pointer',
                            }}
                        >
                            ✕
                        </button>
                    </div>
                </div>

                {sessionEnded && (
                    <div
                        style={{
                            marginBottom: '12px',
                            padding: '8px 10px',
                            backgroundColor: 'rgba(56, 189, 248, 0.12)',
                            border: '1px solid rgba(56, 189, 248, 0.25)',
                            borderRadius: '8px',
                            fontSize: '12px',
                            color: '#bae6fd',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                        }}
                    >
                        <span>Session ended. Ready for a new PIN or close the window.</span>
                    </div>
                )}

                <div style={{ marginBottom: '14px' }}>
                    <h2 style={{ fontSize: '16px', margin: '0 0 4px 0', fontWeight: '600', color: '#f8fafc' }}>
                        Sync to Interview
                    </h2>
                    <p style={{ fontSize: '12px', margin: 0, color: '#94a3b8', lineHeight: '1.4' }}>
                        Start a session in the web app, then enter the 6-digit code below.
                    </p>
                </div>

                <form onSubmit={connectToSession} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <div>
                        <input
                            type="text"
                            placeholder="Enter 6-digit PIN"
                            value={pin}
                            maxLength={8}
                            onChange={(e) => setPin(e.target.value.replace(/\s+/g, ''))}
                            autoFocus
                            style={{
                                padding: '12px',
                                width: '100%',
                                boxSizing: 'border-box',
                                backgroundColor: 'rgba(0, 0, 0, 0.4)',
                                color: '#f8fafc',
                                border: '1px solid rgba(255, 255, 255, 0.15)',
                                borderRadius: '8px',
                                fontSize: '18px',
                                textAlign: 'center',
                                letterSpacing: '0.25em',
                                fontWeight: 'bold',
                                outline: 'none',
                            }}
                        />
                    </div>

                    <button
                        type="submit"
                        style={{
                            padding: '11px',
                            width: '100%',
                            backgroundColor: '#10b981',
                            color: '#0f172a',
                            border: 'none',
                            borderRadius: '8px',
                            fontWeight: '600',
                            fontSize: '14px',
                            cursor: 'pointer',
                            boxShadow: '0 2px 10px rgba(16, 185, 129, 0.25)',
                        }}
                    >
                        Sync to Interview
                    </button>

                    <button
                        type="button"
                        onClick={closeWindow}
                        style={{
                            padding: '9px',
                            width: '100%',
                            backgroundColor: 'rgba(239, 68, 68, 0.14)',
                            color: '#fca5a5',
                            border: '1px solid rgba(239, 68, 68, 0.3)',
                            borderRadius: '8px',
                            fontWeight: '600',
                            fontSize: '12px',
                            cursor: 'pointer',
                        }}
                    >
                        Close Window
                    </button>
                </form>

                {statusText && (
                    <div style={{ marginTop: '12px', fontSize: '12px', color: '#38bdf8', textAlign: 'center' }}>
                        {statusText}
                    </div>
                )}

                {error && (
                    <div style={{ marginTop: '12px', fontSize: '12px', color: '#f87171', backgroundColor: 'rgba(239, 68, 68, 0.1)', padding: '8px', borderRadius: '6px' }}>
                        {error}
                    </div>
                )}

                <div style={{ marginTop: 'auto', paddingTop: '16px' }}>
                    <div
                        onClick={() => setShowAdvanced(!showAdvanced)}
                        style={{ fontSize: '11px', color: '#64748b', cursor: 'pointer', textAlign: 'center' }}
                    >
                        {showAdvanced ? '▼ Hide Settings' : '▶ Advanced: Server & Window'}
                    </div>

                    {showAdvanced && (
                        <div style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px', fontSize: '11px' }}>
                            <div>
                                <label style={{ display: 'block', color: '#94a3b8', marginBottom: '3px' }}>Backend API URL</label>
                                <input
                                    type="text"
                                    value={serverUrl}
                                    onChange={(e) => setServerUrl(e.target.value)}
                                    style={{
                                        padding: '6px 8px',
                                        width: '100%',
                                        boxSizing: 'border-box',
                                        backgroundColor: '#1e293b',
                                        color: '#f8fafc',
                                        border: '1px solid #334155',
                                        borderRadius: '4px',
                                        fontSize: '11px',
                                    }}
                                />
                            </div>

                            <div>
                                <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: '2px' }}>
                                    <span>Background Opacity</span>
                                    <span>{opacity}%</span>
                                </div>
                                <input
                                    type="range"
                                    min="30"
                                    max="100"
                                    value={opacity}
                                    onChange={(e) => setOpacity(Number(e.target.value))}
                                    style={{ width: '100%' }}
                                />
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    }

    // -------------------------------------------------------------
    // Screen 2: Active Transparent Live Overlay Screen
    // -------------------------------------------------------------
    return (
        <div
            style={{
                width: '100%',
                height: '100vh',
                boxSizing: 'border-box',
                backgroundColor: `rgba(15, 17, 23, ${opacity / 100})`,
                color: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                fontFamily: 'Inter, system-ui, -apple-system, sans-serif',
                borderRadius: '12px',
                border: '1px solid rgba(255, 255, 255, 0.1)',
                backdropFilter: 'blur(16px)',
                overflow: 'hidden',
            }}
        >
            {/* Top Drag & Control Bar */}
            <div
                data-tauri-drag-region
                onMouseDown={safeStartDragging}
                style={{
                    height: '34px',
                    padding: '0 10px',
                    backgroundColor: 'rgba(255, 255, 255, 0.06)',
                    cursor: 'grab',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    userSelect: 'none',
                    flexShrink: 0,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#94a3b8', fontWeight: '600' }}>
                    <span>≡</span>
                    <span>DRAG</span>
                    <StealthBadge stealth={stealth} />
                </div>

                <div
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                    <button
                        type="button"
                        onClick={toggleClickThrough}
                        title={isClickThrough ? 'Click-through is ACTIVE. Overlay ignores mouse clicks.' : 'Click-through is OFF. You can interact with this overlay.'}
                        style={{
                            padding: '3px 8px',
                            fontSize: '10px',
                            fontWeight: '600',
                            backgroundColor: isClickThrough ? '#3b82f6' : 'rgba(255, 255, 255, 0.1)',
                            color: isClickThrough ? '#ffffff' : '#cbd5e1',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                        }}
                    >
                        {isClickThrough ? 'Click-Through: ON' : 'Click-Through: OFF'}
                    </button>

                    <button
                        type="button"
                        onClick={disconnect}
                        title="Disconnect from current session and enter a new PIN"
                        style={{
                            padding: '3px 7px',
                            fontSize: '10px',
                            fontWeight: '600',
                            backgroundColor: 'rgba(255, 255, 255, 0.1)',
                            color: '#cbd5e1',
                            border: 'none',
                            borderRadius: '4px',
                            cursor: 'pointer',
                        }}
                    >
                        End
                    </button>

                    <button
                        type="button"
                        onClick={closeWindow}
                        title="Close AudioCore window"
                        style={{
                            padding: '3px 7px',
                            fontSize: '11px',
                            fontWeight: '600',
                            backgroundColor: 'rgba(239, 68, 68, 0.22)',
                            color: '#fca5a5',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            borderRadius: '4px',
                            cursor: 'pointer',
                        }}
                    >
                        ✕
                    </button>
                </div>
            </div>

            {/* Scrollable Conversation & Answer Feed */}
            <div
                ref={feedRef}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '14px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    fontSize: `${fontSize}px`,
                    lineHeight: '1.5',
                }}
            >
                {sessionEnded && (
                    <div
                        style={{
                            padding: '10px 12px',
                            backgroundColor: 'rgba(239, 68, 68, 0.14)',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            borderRadius: '8px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            fontSize: '12px',
                            color: '#fecaca',
                        }}
                    >
                        <span>Interview session ended on web app.</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                                type="button"
                                onClick={disconnect}
                                style={{
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    backgroundColor: 'rgba(255, 255, 255, 0.12)',
                                    color: '#f8fafc',
                                    border: 'none',
                                    borderRadius: '5px',
                                    cursor: 'pointer',
                                }}
                            >
                                New PIN
                            </button>
                            <button
                                type="button"
                                onClick={closeWindow}
                                style={{
                                    padding: '4px 8px',
                                    fontSize: '11px',
                                    fontWeight: '600',
                                    backgroundColor: '#ef4444',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '5px',
                                    cursor: 'pointer',
                                }}
                            >
                                Close Window
                            </button>
                        </div>
                    </div>
                )}
                {/* Active Question Banner */}
                {currentQuestion && (
                    <div
                        style={{
                            padding: '8px 10px',
                            backgroundColor: 'rgba(245, 158, 11, 0.12)',
                            borderLeft: '3px solid #f59e0b',
                            borderRadius: '4px',
                            fontSize: `${fontSize - 1}px`,
                            fontWeight: '500',
                            color: '#fbbf24',
                        }}
                    >
                        <span style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', opacity: 0.8 }}>
                            Interviewer Question
                        </span>
                        {currentQuestion}
                    </div>
                )}

                {/* Live Answer Container */}
                {answerStream ? (
                    <div
                        style={{
                            padding: '12px',
                            backgroundColor: 'rgba(16, 185, 129, 0.1)',
                            borderLeft: '3px solid #10b981',
                            borderRadius: '6px',
                            color: '#e2e8f0',
                            whiteSpace: 'pre-wrap',
                            fontWeight: '400',
                        }}
                    >
                        <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '0.05em', color: '#34d399', marginBottom: '6px', fontWeight: 'bold' }}>
                            Ready-to-Say Answer
                        </div>
                        {answerStream}
                    </div>
                ) : (
                    !currentQuestion && transcriptLines.length === 0 && !liveSpoken && (
                        <div style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', marginTop: '20px' }}>
                            Listening for interview conversation...
                        </div>
                    )
                )}

                {/* Real-time Spoken Text Preview */}
                {liveSpoken && (
                    <div
                        style={{
                            padding: '6px 10px',
                            backgroundColor: 'rgba(56, 189, 248, 0.08)',
                            borderLeft: '2px solid #38bdf8',
                            borderRadius: '4px',
                            fontSize: `${fontSize - 2}px`,
                            color: '#7dd3fc',
                            fontStyle: 'italic',
                        }}
                    >
                        {liveSpoken}
                    </div>
                )}

                {/* Recent Transcript History */}
                {transcriptLines.length > 0 && (
                    <div style={{ marginTop: 'auto', paddingTop: '8px', borderTop: '1px solid rgba(255, 255, 255, 0.06)' }}>
                        <div style={{ fontSize: '10px', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                            Live Transcript
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                            {transcriptLines.slice(-6).map((item) => {
                                const isYou = item.speaker === 'You';
                                return (
                                    <div key={item.id} style={{ fontSize: `${fontSize - 2}px`, color: isYou ? '#93c5fd' : '#cbd5e1' }}>
                                        <strong style={{ color: isYou ? '#60a5fa' : '#34d399' }}>
                                            {item.speaker}:
                                        </strong>{' '}
                                        {item.text}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>

            {/* Bottom Font Controls */}
            <div
                style={{
                    height: '24px',
                    padding: '0 10px',
                    backgroundColor: 'rgba(0, 0, 0, 0.3)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '10px',
                    color: '#64748b',
                    flexShrink: 0,
                }}
            >
                <span>Size: {fontSize}px</span>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button
                        onClick={() => setFontSize((s) => Math.max(12, s - 1))}
                        style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0 4px' }}
                    >
                        A-
                    </button>
                    <button
                        onClick={() => setFontSize((s) => Math.min(22, s + 1))}
                        style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: '0 4px' }}
                    >
                        A+
                    </button>
                </div>
            </div>
        </div>
    );
}
