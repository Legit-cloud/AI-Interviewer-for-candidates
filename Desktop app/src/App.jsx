import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowRight } from '@phosphor-icons/react/ArrowRight';
import { Check } from '@phosphor-icons/react/Check';
import { ChatCircleText } from '@phosphor-icons/react/ChatCircleText';
import { Copy } from '@phosphor-icons/react/Copy';
import { CursorClick } from '@phosphor-icons/react/CursorClick';
import { Lightning } from '@phosphor-icons/react/Lightning';
import { ShieldCheck } from '@phosphor-icons/react/ShieldCheck';
import { ShieldWarning } from '@phosphor-icons/react/ShieldWarning';
import { SignOut } from '@phosphor-icons/react/SignOut';
import { Sliders } from '@phosphor-icons/react/Sliders';
import { Terminal } from '@phosphor-icons/react/Terminal';
import { TextAa } from '@phosphor-icons/react/TextAa';
import { Waveform } from '@phosphor-icons/react/Waveform';
import { X } from '@phosphor-icons/react/X';

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

// macOS Window Traffic Light Header
function MacTrafficLights({ onClose, onMinimize, onMaximize }) {
    return (
        <div
            onMouseDown={(e) => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
        >
            <button
                type="button"
                onClick={onClose}
                title="Close window"
                aria-label="Close"
                style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: '#ff5f56',
                    border: '1px solid #e0443e',
                    cursor: 'pointer',
                    padding: 0,
                    outline: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 6px rgba(255, 95, 86, 0.4)',
                }}
            />
            <button
                type="button"
                onClick={onMinimize}
                title="Toggle opacity"
                aria-label="Minimize"
                style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: '#ffbd2e',
                    border: '1px solid #dea125',
                    cursor: 'pointer',
                    padding: 0,
                    outline: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 6px rgba(255, 189, 46, 0.4)',
                }}
            />
            <button
                type="button"
                onClick={onMaximize}
                title="Quick expand"
                aria-label="Expand"
                style={{
                    width: '12px',
                    height: '12px',
                    borderRadius: '50%',
                    backgroundColor: '#27c93f',
                    border: '1px solid #1aab29',
                    cursor: 'pointer',
                    padding: 0,
                    outline: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 0 6px rgba(39, 201, 63, 0.4)',
                }}
            />
        </div>
    );
}

// Stealth Badge showing Windows capture exclusion state
function StealthBadge({ stealth }) {
    const isHidden = stealth.ok === true;
    const isPending = stealth.ok === null;
    return (
        <div
            title={stealth.detail || 'Screen-capture exclusion status (WDA_EXCLUDEFROMCAPTURE)'}
            style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '5px',
                fontSize: '11px',
                padding: '3px 8px',
                borderRadius: '999px',
                backgroundColor: isPending
                    ? 'rgba(148, 163, 184, 0.12)'
                    : isHidden
                    ? 'rgba(46, 90, 68, 0.25)'
                    : 'rgba(239, 68, 68, 0.14)',
                border: `1px solid ${
                    isPending
                        ? 'rgba(148, 163, 184, 0.25)'
                        : isHidden
                        ? 'rgba(52, 211, 153, 0.35)'
                        : 'rgba(248, 113, 113, 0.35)'
                }`,
                color: isPending ? '#94a3b8' : isHidden ? '#34d399' : '#f87171',
                fontWeight: 600,
                letterSpacing: '0.02em',
            }}
        >
            {isPending ? (
                <Waveform size={13} className="pulse-dot" weight="bold" />
            ) : isHidden ? (
                <ShieldCheck size={13} weight="fill" />
            ) : (
                <ShieldWarning size={13} weight="fill" />
            )}
            <span>{isPending ? 'Checking...' : isHidden ? 'Hidden' : 'Visible'}</span>
        </div>
    );
}

// Initiate native window dragging in Tauri
const safeStartDragging = async (e) => {
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
    const [fontSize, setFontSize] = useState(14);
    const [opacity, setOpacity] = useState(94);
    const [stealth, setStealth] = useState({ ok: null, detail: '' });
    const [activeTab, setActiveTab] = useState('answers'); // 'answers' | 'transcript'
    const [copiedAnswer, setCopiedAnswer] = useState(false);
    const [customInput, setCustomInput] = useState('');
    const isClickThroughRef = useRef(false);
    const wsRef = useRef(null);
    const feedRef = useRef(null);

    // Auto-scroll feed to bottom when new content arrives
    useEffect(() => {
        if (feedRef.current) {
            feedRef.current.scrollTop = feedRef.current.scrollHeight;
        }
    }, [answerStream, liveSpoken, transcriptLines, activeTab]);

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

    const handleCopyAnswer = async () => {
        if (!answerStream) return;
        try {
            await navigator.clipboard.writeText(answerStream);
            setCopiedAnswer(true);
            setTimeout(() => setCopiedAnswer(false), 1800);
        } catch (err) {
            console.warn('Copy failed:', err);
        }
    };

    const handleSendCustomInput = (e) => {
        if (e) e.preventDefault();
        const cleanText = customInput.trim();
        if (!cleanText || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return;

        try {
            wsRef.current.send(JSON.stringify({
                type: 'transcript.simulate',
                text: cleanText,
                source: 'tab',
            }));
            setCustomInput('');
            setCurrentQuestion(cleanText);
            setAnswerStream('');
        } catch (err) {
            console.warn('Failed to send custom input:', err);
        }
    };

    const connectToSession = async (e) => {
        if (e) e.preventDefault();
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

                    if (data.type === 'client.ping') {
                        ws.send(JSON.stringify({ type: 'client.pong' }));
                        return;
                    }

                    if (data.type === 'transcript.delta') {
                        const interim = String(data.text || '');
                        const committed = String(data.committed || '');
                        const src = String(data.source || 'tab');
                        const speaker = src === 'microphone' ? 'You' : 'Interviewer';
                        const combined = `${committed} ${interim}`.trim();
                        setLiveSpoken(combined ? `${speaker}: ${combined}` : '');
                    } else if (data.type === 'transcript.completed') {
                        setLiveSpoken('');
                        setTranscriptLines((prev) => [
                            ...prev.slice(-30),
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
                ? `Cannot connect to server at ${serverUrl}. Ensure the backend API is active on port 8000.`
                : (err.message || 'Failed to connect.');
            setError(msg);
            setStatusText('');
        }
    };

    // -------------------------------------------------------------
    // Screen 1: Apple Terminal Styled PIN Pairing Screen
    // -------------------------------------------------------------
    if (!connected) {
        return (
            <motion.div
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.25, ease: 'easeOut' }}
                style={{
                    width: '100%',
                    height: '100vh',
                    boxSizing: 'border-box',
                    backgroundColor: `rgba(13, 17, 23, ${opacity / 100})`,
                    borderRadius: '16px',
                    border: '1px solid rgba(255, 255, 255, 0.12)',
                    boxShadow: '0 25px 60px -15px rgba(0, 0, 0, 0.7), inset 0 1px 0 rgba(255, 255, 255, 0.15)',
                    backdropFilter: 'blur(28px)',
                    WebkitBackdropFilter: 'blur(28px)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                    color: '#f1f5f9',
                    userSelect: 'none',
                }}
            >
                {/* macOS Terminal Title Bar */}
                <div
                    data-tauri-drag-region
                    onMouseDown={safeStartDragging}
                    style={{
                        height: '42px',
                        padding: '0 14px',
                        backgroundColor: 'rgba(255, 255, 255, 0.04)',
                        borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                        cursor: 'grab',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        flexShrink: 0,
                    }}
                >
                    <MacTrafficLights
                        onClose={closeWindow}
                        onMinimize={() => setOpacity((prev) => (prev <= 50 ? 94 : 45))}
                        onMaximize={() => setOpacity(94)}
                    />

                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '7px',
                            fontSize: '12px',
                            fontWeight: 600,
                            letterSpacing: '0.04em',
                            color: '#cbd5e1',
                            fontFamily: 'var(--font-mono)',
                        }}
                    >
                        <Terminal size={14} weight="bold" style={{ color: '#38bdf8' }} />
                        <span>vren@audiocore: ~</span>
                    </div>

                    <StealthBadge stealth={stealth} />
                </div>

                {/* Terminal Content Body */}
                <div
                    style={{
                        flex: 1,
                        padding: '24px 20px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'space-between',
                        overflowY: 'auto',
                    }}
                >
                    <div>
                        {/* Terminal Header Prompt */}
                        <div
                            style={{
                                padding: '12px 14px',
                                backgroundColor: 'rgba(0, 0, 0, 0.35)',
                                borderRadius: '10px',
                                border: '1px solid rgba(255, 255, 255, 0.06)',
                                marginBottom: '20px',
                                fontFamily: 'var(--font-mono)',
                                fontSize: '12px',
                                lineHeight: '1.6',
                            }}
                        >
                            <div style={{ color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <span style={{ color: '#2e5a44' }}>➜</span>
                                <span style={{ fontWeight: 600 }}>vren-connect --mode stealth</span>
                            </div>
                            <div style={{ color: '#94a3b8', marginTop: '4px', fontSize: '11px' }}>
                                Ready to stream live talking points directly over active interview calls. Enter your pairing PIN from the web app dashboard.
                            </div>
                        </div>

                        {sessionEnded && (
                            <motion.div
                                initial={{ opacity: 0, y: -6 }}
                                animate={{ opacity: 1, y: 0 }}
                                style={{
                                    marginBottom: '16px',
                                    padding: '10px 12px',
                                    backgroundColor: 'rgba(56, 189, 248, 0.12)',
                                    border: '1px solid rgba(56, 189, 248, 0.3)',
                                    borderRadius: '10px',
                                    fontSize: '12px',
                                    color: '#bae6fd',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                }}
                            >
                                <Lightning size={14} weight="fill" style={{ color: '#38bdf8' }} />
                                <span>Previous interview completed. Enter a new code to resume.</span>
                            </motion.div>
                        )}

                        {/* PIN Entry Form */}
                        <form onSubmit={connectToSession} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                <label
                                    style={{
                                        fontSize: '11px',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.08em',
                                        color: '#94a3b8',
                                        fontWeight: 600,
                                        fontFamily: 'var(--font-mono)',
                                    }}
                                >
                                    6-Digit Session PIN
                                </label>
                                <div style={{ position: 'relative' }}>
                                    <input
                                        type="text"
                                        placeholder="• • • • • •"
                                        value={pin}
                                        maxLength={8}
                                        onChange={(e) => setPin(e.target.value.replace(/\s+/g, ''))}
                                        autoFocus
                                        style={{
                                            padding: '14px',
                                            width: '100%',
                                            backgroundColor: 'rgba(0, 0, 0, 0.5)',
                                            color: '#f8fafc',
                                            border: '1px solid rgba(56, 189, 248, 0.35)',
                                            borderRadius: '10px',
                                            fontSize: '22px',
                                            textAlign: 'center',
                                            letterSpacing: '0.3em',
                                            fontFamily: 'var(--font-mono)',
                                            fontWeight: 700,
                                            outline: 'none',
                                            boxShadow: '0 0 15px rgba(56, 189, 248, 0.1)',
                                            transition: 'border 0.2s ease, box-shadow 0.2s ease',
                                        }}
                                        onFocus={(e) => {
                                            e.target.style.borderColor = '#38bdf8';
                                            e.target.style.boxShadow = '0 0 20px rgba(56, 189, 248, 0.25)';
                                        }}
                                        onBlur={(e) => {
                                            e.target.style.borderColor = 'rgba(56, 189, 248, 0.35)';
                                            e.target.style.boxShadow = '0 0 15px rgba(56, 189, 248, 0.1)';
                                        }}
                                    />
                                </div>
                            </div>

                            <motion.button
                                whileHover={{ scale: 1.015 }}
                                whileTap={{ scale: 0.985 }}
                                type="submit"
                                style={{
                                    padding: '12px',
                                    width: '100%',
                                    background: '#2e5a44',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '10px',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    letterSpacing: '0.03em',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '8px',
                                    boxShadow: '0 4px 14px rgba(46, 90, 68, 0.45)',
                                }}
                            >
                                <span>Connect & Launch HUD</span>
                                <ArrowRight size={15} weight="bold" />
                            </motion.button>
                        </form>

                        {statusText && (
                            <motion.div
                                initial={{ opacity: 0 }}
                                animate={{ opacity: 1 }}
                                style={{
                                    marginTop: '14px',
                                    fontSize: '12px',
                                    color: '#38bdf8',
                                    textAlign: 'center',
                                    fontFamily: 'var(--font-mono)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px',
                                }}
                            >
                                <span className="pulse-dot">●</span>
                                <span>{statusText}</span>
                            </motion.div>
                        )}

                        {error && (
                            <motion.div
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                style={{
                                    marginTop: '14px',
                                    fontSize: '12px',
                                    color: '#f87171',
                                    backgroundColor: 'rgba(239, 68, 68, 0.12)',
                                    border: '1px solid rgba(239, 68, 68, 0.3)',
                                    padding: '10px 12px',
                                    borderRadius: '8px',
                                    fontFamily: 'var(--font-mono)',
                                }}
                            >
                                {error}
                            </motion.div>
                        )}
                    </div>

                    {/* Bottom Advanced Controls */}
                    <div style={{ marginTop: '20px', borderTop: '1px solid rgba(255, 255, 255, 0.08)', paddingTop: '14px' }}>
                        <button
                            type="button"
                            onClick={() => setShowAdvanced(!showAdvanced)}
                            style={{
                                background: 'none',
                                border: 'none',
                                padding: 0,
                                fontSize: '11px',
                                color: '#64748b',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontFamily: 'var(--font-mono)',
                            }}
                        >
                            <Sliders size={13} weight="regular" />
                            <span>{showAdvanced ? 'Hide Terminal Settings' : 'Terminal Preferences (Opacity & API)'}</span>
                        </button>

                        <AnimatePresence>
                            {showAdvanced && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    exit={{ opacity: 0, height: 0 }}
                                    style={{
                                        marginTop: '12px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '10px',
                                        fontSize: '11px',
                                    }}
                                >
                                    <div>
                                        <label style={{ display: 'block', color: '#94a3b8', marginBottom: '4px', fontFamily: 'var(--font-mono)' }}>
                                            API Gateway
                                        </label>
                                        <input
                                            type="text"
                                            value={serverUrl}
                                            onChange={(e) => setServerUrl(e.target.value)}
                                            style={{
                                                padding: '7px 10px',
                                                width: '100%',
                                                backgroundColor: 'rgba(0, 0, 0, 0.3)',
                                                color: '#e2e8f0',
                                                border: '1px solid rgba(255, 255, 255, 0.12)',
                                                borderRadius: '6px',
                                                fontSize: '11px',
                                                fontFamily: 'var(--font-mono)',
                                                outline: 'none',
                                            }}
                                        />
                                    </div>

                                    <div>
                                        <div style={{ display: 'flex', justifyContent: 'space-between', color: '#94a3b8', marginBottom: '4px' }}>
                                            <span>Glassmorphism Opacity</span>
                                            <span style={{ fontFamily: 'var(--font-mono)', color: '#38bdf8' }}>{opacity}%</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="30"
                                            max="100"
                                            value={opacity}
                                            onChange={(e) => setOpacity(Number(e.target.value))}
                                            style={{ width: '100%', accentColor: '#38bdf8', cursor: 'pointer' }}
                                        />
                                    </div>
                                </motion.div>
                            )}
                        </AnimatePresence>
                    </div>
                </div>
            </motion.div>
        );
    }

    // -------------------------------------------------------------
    // Screen 2: Active Apple-Styled Live Terminal HUD
    // -------------------------------------------------------------
    return (
        <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.2 }}
            style={{
                width: '100%',
                height: '100vh',
                boxSizing: 'border-box',
                backgroundColor: `rgba(13, 17, 23, ${opacity / 100})`,
                color: '#f8fafc',
                display: 'flex',
                flexDirection: 'column',
                borderRadius: '16px',
                border: isClickThrough
                    ? '1px solid rgba(59, 130, 246, 0.5)'
                    : '1px solid rgba(255, 255, 255, 0.12)',
                boxShadow: isClickThrough
                    ? '0 0 25px rgba(59, 130, 246, 0.2), 0 25px 60px -15px rgba(0, 0, 0, 0.75)'
                    : '0 25px 60px -15px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 255, 255, 0.14)',
                backdropFilter: 'blur(30px)',
                WebkitBackdropFilter: 'blur(30px)',
                overflow: 'hidden',
                userSelect: isClickThrough ? 'none' : 'text',
            }}
        >
            {/* Top Apple Terminal Title & Controls Bar */}
            <div
                data-tauri-drag-region
                onMouseDown={safeStartDragging}
                style={{
                    height: '42px',
                    padding: '0 14px',
                    backgroundColor: 'rgba(255, 255, 255, 0.04)',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
                    cursor: 'grab',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <MacTrafficLights
                        onClose={closeWindow}
                        onMinimize={() => setOpacity((prev) => (prev <= 50 ? 94 : 45))}
                        onMaximize={() => setOpacity(94)}
                    />

                    <div
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontFamily: 'var(--font-mono)',
                            fontSize: '11px',
                            fontWeight: 600,
                            color: '#94a3b8',
                        }}
                    >
                        <span style={{ color: '#2e5a44' }}>●</span>
                        <span>LIVE HUD</span>
                    </div>

                    <StealthBadge stealth={stealth} />
                </div>

                <div
                    onMouseDown={(e) => e.stopPropagation()}
                    style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                >
                    {/* Click-Through Toggle Button */}
                    <button
                        type="button"
                        onClick={toggleClickThrough}
                        title={isClickThrough ? 'Click-through is ON. Mouse clicks pass through directly to background windows.' : 'Click-through is OFF. You can scroll, copy, and interact.'}
                        style={{
                            padding: '4px 9px',
                            fontSize: '10px',
                            fontWeight: 600,
                            fontFamily: 'var(--font-mono)',
                            backgroundColor: isClickThrough ? '#2563eb' : 'rgba(255, 255, 255, 0.08)',
                            color: isClickThrough ? '#ffffff' : '#cbd5e1',
                            border: `1px solid ${isClickThrough ? '#3b82f6' : 'rgba(255, 255, 255, 0.12)'}`,
                            borderRadius: '6px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                            transition: 'all 0.15s ease',
                        }}
                    >
                        <CursorClick size={12} weight={isClickThrough ? 'fill' : 'regular'} />
                        <span>{isClickThrough ? 'Click-thru ON' : 'Interactive'}</span>
                    </button>

                    {/* Disconnect / End Button */}
                    <button
                        type="button"
                        onClick={disconnect}
                        title="Disconnect session"
                        style={{
                            padding: '4px 8px',
                            fontSize: '10px',
                            fontWeight: 600,
                            fontFamily: 'var(--font-mono)',
                            backgroundColor: 'rgba(255, 255, 255, 0.08)',
                            color: '#cbd5e1',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: '6px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                        }}
                    >
                        <SignOut size={12} weight="bold" />
                        <span>End</span>
                    </button>
                </div>
            </div>

            {/* Segmented View Switcher: Answers vs Live Transcript */}
            <div
                style={{
                    padding: '8px 14px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.06)',
                    backgroundColor: 'rgba(0, 0, 0, 0.25)',
                    flexShrink: 0,
                }}
            >
                <div style={{ display: 'flex', gap: '6px' }}>
                    <button
                        type="button"
                        onClick={() => setActiveTab('answers')}
                        style={{
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 600,
                            fontFamily: 'var(--font-mono)',
                            borderRadius: '6px',
                            border: activeTab === 'answers' ? '1px solid rgba(52, 211, 153, 0.4)' : '1px solid transparent',
                            backgroundColor: activeTab === 'answers' ? 'rgba(46, 90, 68, 0.25)' : 'transparent',
                            color: activeTab === 'answers' ? '#34d399' : '#94a3b8',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                        }}
                    >
                        <span>Copilot Feed</span>
                    </button>

                    <button
                        type="button"
                        onClick={() => setActiveTab('transcript')}
                        style={{
                            padding: '4px 10px',
                            fontSize: '11px',
                            fontWeight: 600,
                            fontFamily: 'var(--font-mono)',
                            borderRadius: '6px',
                            border: activeTab === 'transcript' ? '1px solid rgba(56, 189, 248, 0.4)' : '1px solid transparent',
                            backgroundColor: activeTab === 'transcript' ? 'rgba(56, 189, 248, 0.15)' : 'transparent',
                            color: activeTab === 'transcript' ? '#38bdf8' : '#94a3b8',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px',
                        }}
                    >
                        <ChatCircleText size={13} weight={activeTab === 'transcript' ? 'fill' : 'regular'} />
                        <span>Transcript ({transcriptLines.length})</span>
                    </button>
                </div>

                {answerStream && activeTab === 'answers' && (
                    <button
                        type="button"
                        onClick={handleCopyAnswer}
                        title="Copy answer to clipboard"
                        style={{
                            background: 'none',
                            border: '1px solid rgba(255, 255, 255, 0.12)',
                            borderRadius: '6px',
                            padding: '4px 8px',
                            fontSize: '11px',
                            color: copiedAnswer ? '#34d399' : '#cbd5e1',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '4px',
                            fontFamily: 'var(--font-mono)',
                        }}
                    >
                        {copiedAnswer ? <Check size={12} weight="bold" /> : <Copy size={12} weight="regular" />}
                        <span>{copiedAnswer ? 'Copied' : 'Copy'}</span>
                    </button>
                )}
            </div>

            {/* Scrollable Conversation & Answer Feed */}
            <div
                ref={feedRef}
                style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '16px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                    fontSize: `${fontSize}px`,
                    lineHeight: '1.6',
                }}
            >
                {/* Session Ended Alert Banner */}
                {sessionEnded && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{
                            padding: '12px 14px',
                            backgroundColor: 'rgba(239, 68, 68, 0.14)',
                            border: '1px solid rgba(239, 68, 68, 0.35)',
                            borderRadius: '10px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '8px',
                            fontSize: '12px',
                            color: '#fecaca',
                            fontFamily: 'var(--font-mono)',
                        }}
                    >
                        <span>Interview session concluded on web dashboard.</span>
                        <div style={{ display: 'flex', gap: '6px' }}>
                            <button
                                type="button"
                                onClick={disconnect}
                                style={{
                                    padding: '5px 10px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    backgroundColor: 'rgba(255, 255, 255, 0.12)',
                                    color: '#f8fafc',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                }}
                            >
                                New PIN
                            </button>
                            <button
                                type="button"
                                onClick={closeWindow}
                                style={{
                                    padding: '5px 10px',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    backgroundColor: '#ef4444',
                                    color: '#ffffff',
                                    border: 'none',
                                    borderRadius: '6px',
                                    cursor: 'pointer',
                                }}
                            >
                                Close
                            </button>
                        </div>
                    </motion.div>
                )}

                {/* Detected Interviewer Question Pill Card */}
                {currentQuestion && (
                    <motion.div
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{
                            padding: '12px 14px',
                            backgroundColor: 'rgba(30, 41, 59, 0.75)',
                            border: '1px solid rgba(245, 158, 11, 0.3)',
                            borderLeft: '4px solid #f59e0b',
                            borderRadius: '10px',
                            boxShadow: '0 4px 16px rgba(0, 0, 0, 0.25)',
                        }}
                    >
                        <div
                            style={{
                                fontSize: '10px',
                                textTransform: 'uppercase',
                                letterSpacing: '0.08em',
                                color: '#fbbf24',
                                fontWeight: 700,
                                marginBottom: '4px',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                fontFamily: 'var(--font-mono)',
                            }}
                        >
                            <span>●</span>
                            <span>Interviewer Question</span>
                        </div>
                        <div style={{ color: '#f8fafc', fontWeight: 500 }}>
                            {currentQuestion}
                        </div>
                    </motion.div>
                )}

                {/* Copilot Feed vs Full Transcript View */}
                {activeTab === 'answers' ? (
                    <>
                        {/* Recent conversation turns */}
                        {transcriptLines.slice(-3).map((item) => {
                            const isYou = item.speaker === 'You';
                            return (
                                <motion.div
                                    key={item.id}
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    style={{
                                        padding: '10px 14px',
                                        backgroundColor: isYou ? 'rgba(59, 130, 246, 0.12)' : 'rgba(30, 41, 59, 0.6)',
                                        border: `1px solid ${isYou ? 'rgba(59, 130, 246, 0.28)' : 'rgba(255, 255, 255, 0.08)'}`,
                                        borderLeft: `4px solid ${isYou ? '#60a5fa' : '#94a3b8'}`,
                                        borderRadius: '10px',
                                    }}
                                >
                                    <div
                                        style={{
                                            fontSize: '10px',
                                            fontWeight: 700,
                                            color: isYou ? '#93c5fd' : '#cbd5e1',
                                            marginBottom: '4px',
                                            fontFamily: 'var(--font-mono)',
                                            display: 'flex',
                                            justifyContent: 'space-between',
                                        }}
                                    >
                                        <span>{item.speaker}</span>
                                        {item.timestamp && <span style={{ opacity: 0.6 }}>{item.timestamp}</span>}
                                    </div>
                                    <div style={{ color: '#f1f5f9', fontWeight: 400 }}>{item.text}</div>
                                </motion.div>
                            );
                        })}

                        {answerStream ? (
                            <motion.div
                                initial={{ opacity: 0, y: 6 }}
                                animate={{ opacity: 1, y: 0 }}
                                style={{
                                    padding: '16px',
                                    backgroundColor: 'rgba(15, 23, 42, 0.85)',
                                    border: '1px solid rgba(46, 90, 68, 0.5)',
                                    borderLeft: '4px solid #2e5a44',
                                    borderRadius: '12px',
                                    color: '#f1f5f9',
                                    whiteSpace: 'pre-wrap',
                                    fontWeight: 400,
                                    lineHeight: '1.7',
                                    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3)',
                                }}
                            >
                                <div
                                    style={{
                                        fontSize: '10px',
                                        textTransform: 'uppercase',
                                        letterSpacing: '0.08em',
                                        color: '#34d399',
                                        marginBottom: '10px',
                                        fontWeight: 700,
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '6px',
                                        fontFamily: 'var(--font-mono)',
                                    }}
                                >
                                    <span>Suggested Answer</span>
                                </div>
                                <div>
                                    {answerStream}
                                    {!sessionEnded && <span className="terminal-cursor" />}
                                </div>
                            </motion.div>
                        ) : (
                            !currentQuestion && transcriptLines.length === 0 && !liveSpoken && (
                                <div
                                    style={{
                                        color: '#64748b',
                                        fontSize: '12px',
                                        textAlign: 'center',
                                        marginTop: '40px',
                                        fontFamily: 'var(--font-mono)',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'center',
                                        gap: '8px',
                                    }}
                                >
                                    <Terminal size={22} weight="regular" style={{ opacity: 0.4 }} />
                                    <span>Listening to interview conversation...</span>
                                    <span style={{ fontSize: '11px', color: '#475569' }}>
                                        Interviewer questions and suggested answers appear here live.
                                    </span>
                                </div>
                            )
                        )}
                    </>
                ) : (
                    /* Transcript History View */
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {transcriptLines.length === 0 ? (
                            <div style={{ color: '#64748b', fontSize: '12px', textAlign: 'center', marginTop: '30px', fontFamily: 'var(--font-mono)' }}>
                                No transcript recorded yet.
                            </div>
                        ) : (
                            transcriptLines.map((item) => {
                                const isYou = item.speaker === 'You';
                                return (
                                    <div
                                        key={item.id}
                                        style={{
                                            padding: '8px 12px',
                                            backgroundColor: isYou ? 'rgba(59, 130, 246, 0.1)' : 'rgba(30, 41, 59, 0.5)',
                                            border: `1px solid ${isYou ? 'rgba(59, 130, 246, 0.25)' : 'rgba(255, 255, 255, 0.06)'}`,
                                            borderRadius: '8px',
                                            fontSize: `${fontSize - 1}px`,
                                        }}
                                    >
                                        <div
                                            style={{
                                                fontSize: '10px',
                                                color: isYou ? '#60a5fa' : '#34d399',
                                                fontWeight: 700,
                                                marginBottom: '3px',
                                                fontFamily: 'var(--font-mono)',
                                            }}
                                        >
                                            {item.speaker} {item.timestamp && `· ${item.timestamp}`}
                                        </div>
                                        <div style={{ color: '#e2e8f0' }}>{item.text}</div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                )}

                {/* Real-time Spoken Text Live Delta Bubble */}
                {liveSpoken && (
                    <motion.div
                        initial={{ opacity: 0, y: 3 }}
                        animate={{ opacity: 1, y: 0 }}
                        style={{
                            padding: '10px 14px',
                            backgroundColor: 'rgba(56, 189, 248, 0.1)',
                            borderLeft: '3px solid #38bdf8',
                            borderRadius: '8px',
                            fontSize: `${fontSize - 1}px`,
                            color: '#7dd3fc',
                            fontFamily: 'var(--font-mono)',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}
                    >
                        <span className="pulse-dot" style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', backgroundColor: '#38bdf8' }} />
                        <span>{liveSpoken}</span>
                        <span className="terminal-cursor" />
                    </motion.div>
                )}
            </div>

            {/* Quick Ask / Manual Input Bar */}
            <form
                onSubmit={handleSendCustomInput}
                onMouseDown={(e) => e.stopPropagation()}
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    padding: '8px 12px',
                    backgroundColor: 'rgba(0, 0, 0, 0.45)',
                    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                    flexShrink: 0,
                }}
            >
                <input
                    type="text"
                    value={customInput}
                    onChange={(e) => setCustomInput(e.target.value)}
                    placeholder="Ask a question or type to guide AI..."
                    style={{
                        flex: 1,
                        backgroundColor: 'rgba(255, 255, 255, 0.05)',
                        border: '1px solid rgba(255, 255, 255, 0.12)',
                        borderRadius: '8px',
                        padding: '7px 12px',
                        color: '#f8fafc',
                        fontSize: '12px',
                        fontFamily: 'var(--font-mono)',
                        outline: 'none',
                    }}
                />
                <button
                    type="submit"
                    disabled={!customInput.trim()}
                    title="Send question or prompt"
                    style={{
                        width: '32px',
                        height: '32px',
                        borderRadius: '8px',
                        backgroundColor: customInput.trim() ? '#2e5a44' : 'rgba(255, 255, 255, 0.08)',
                        color: customInput.trim() ? '#ffffff' : '#64748b',
                        border: 'none',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        cursor: customInput.trim() ? 'pointer' : 'default',
                        transition: 'all 0.15s ease',
                        flexShrink: 0,
                    }}
                >
                    <ArrowRight size={14} weight="bold" />
                </button>
            </form>

            {/* Bottom Status & Typography Toolbar */}
            <div
                style={{
                    height: '32px',
                    padding: '0 14px',
                    backgroundColor: 'rgba(0, 0, 0, 0.45)',
                    borderTop: '1px solid rgba(255, 255, 255, 0.08)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: '11px',
                    color: '#64748b',
                    fontFamily: 'var(--font-mono)',
                    flexShrink: 0,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ color: connected ? '#2e5a44' : '#f87171' }}>●</span>
                    <span>{connected ? 'ONLINE' : 'OFFLINE'}</span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <TextAa size={13} weight="bold" />
                        <span>{fontSize}px</span>
                    </span>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                            type="button"
                            onClick={() => setFontSize((s) => Math.max(12, s - 1))}
                            title="Decrease text size"
                            style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: 'none',
                                color: '#cbd5e1',
                                cursor: 'pointer',
                                padding: '2px 7px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontFamily: 'var(--font-mono)',
                            }}
                        >
                            A-
                        </button>
                        <button
                            type="button"
                            onClick={() => setFontSize((s) => Math.min(22, s + 1))}
                            title="Increase text size"
                            style={{
                                background: 'rgba(255, 255, 255, 0.08)',
                                border: 'none',
                                color: '#cbd5e1',
                                cursor: 'pointer',
                                padding: '2px 7px',
                                borderRadius: '4px',
                                fontSize: '10px',
                                fontFamily: 'var(--font-mono)',
                            }}
                        >
                            A+
                        </button>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}
