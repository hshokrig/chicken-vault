import { useEffect, useRef, useState } from 'react';
import { AiQuestionOutcome, GameStatePublic, TeamId } from '@chicken-vault/shared';
import { PlayerSeatEditor } from './PlayerSeatEditor';

interface HostControlsProps {
  state: GameStatePublic;
  onAddPlayer: (payload: { name: string; team: TeamId }) => Promise<void>;
  onUpdatePlayer: (playerId: string, payload: { name?: string; team?: TeamId }) => Promise<void>;
  onRemovePlayer: (playerId: string) => Promise<void>;
  onReorderPlayers: (playerIds: string[]) => Promise<void>;
  onConfigChange: (payload: Partial<GameStatePublic['config']>) => Promise<void>;
  onInitializeWorkbook: () => Promise<void>;
  onStartGame: () => Promise<void>;
  onResetGame: () => Promise<void>;
  onRunDemo: () => Promise<void>;
  onOpenPreflight: () => void;
  onStartInvestigation: () => Promise<void>;
  onAnalyzeQuestionAudio: (audioBlob: Blob) => Promise<AiQuestionOutcome>;
  onAnalyzeQuestionText: (transcript: string) => Promise<AiQuestionOutcome>;
  onCallVault: (calledBy: string | 'AUTO') => Promise<void>;
  onNextRound: () => Promise<void>;
  onStartRealGame: () => Promise<void>;
}

function pickRecorderMimeType(): string | undefined {
  if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
    return undefined;
  }

  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
    'audio/ogg'
  ];

  for (const candidate of candidates) {
    if (window.MediaRecorder.isTypeSupported(candidate)) {
      return candidate;
    }
  }
  return undefined;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function HostControls({
  state,
  onAddPlayer,
  onUpdatePlayer,
  onRemovePlayer,
  onReorderPlayers,
  onConfigChange,
  onInitializeWorkbook,
  onStartGame,
  onResetGame,
  onRunDemo,
  onOpenPreflight,
  onStartInvestigation,
  onAnalyzeQuestionAudio,
  onAnalyzeQuestionText,
  onCallVault,
  onNextRound,
  onStartRealGame
}: HostControlsProps): JSX.Element {
  const [collapsed, setCollapsed] = useState(true);
  const [newPlayerName, setNewPlayerName] = useState('');
  const [newPlayerTeam, setNewPlayerTeam] = useState<TeamId>('A');
  const [saving, setSaving] = useState(false);
  const [questionStatus, setQuestionStatus] = useState<'IDLE' | 'RECORDING' | 'ANALYZING'>('IDLE');
  const [questionFeedback, setQuestionFeedback] = useState<string | null>(null);
  const [typedQuestion, setTypedQuestion] = useState('');
  const [lastRecordingUrl, setLastRecordingUrl] = useState<string | null>(null);
  const [lastRecordingMeta, setLastRecordingMeta] = useState<{ durationMs: number; bytes: number; mimeType: string } | null>(null);
  const [audioInputs, setAudioInputs] = useState<MediaDeviceInfo[]>([]);
  const [selectedInputId, setSelectedInputId] = useState<string>('');
  const lastRecordingUrlRef = useRef<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<BlobPart[]>([]);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const recordStartedAtRef = useRef<number>(0);

  const [configDraft, setConfigDraft] = useState({
    rounds: state.config.rounds,
    investigationSeconds: state.config.investigationSeconds,
    scoringSeconds: state.config.scoringSeconds,
    vaultStart: state.config.vaultStart,
    insiderEnabled: state.config.insiderEnabled,
    ackWritesEnabled: state.config.ackWritesEnabled
  });

  useEffect(() => {
    setConfigDraft({
      rounds: state.config.rounds,
      investigationSeconds: state.config.investigationSeconds,
      scoringSeconds: state.config.scoringSeconds,
      vaultStart: state.config.vaultStart,
      insiderEnabled: state.config.insiderEnabled,
      ackWritesEnabled: state.config.ackWritesEnabled
    });
  }, [state.config]);

  const currentTurnPlayer =
    state.phase === 'INVESTIGATION'
      ? state.players.find((player) => player.seatIndex === state.round.currentTurnSeatIndex) ?? null
      : null;
  const canSubmitQuestion = questionStatus === 'RECORDING' || (questionStatus === 'IDLE' && typedQuestion.trim().length > 0);

  const stopTracks = (): void => {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
  };

  const resetRecorder = (): void => {
    recorderRef.current = null;
    chunksRef.current = [];
    stopTracks();
  };

  const setRecordingPreview = (blob: Blob): void => {
    const nextUrl = URL.createObjectURL(blob);
    if (lastRecordingUrlRef.current) {
      URL.revokeObjectURL(lastRecordingUrlRef.current);
    }
    lastRecordingUrlRef.current = nextUrl;
    setLastRecordingUrl(nextUrl);
  };

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
      return;
    }

    let cancelled = false;
    const refreshDevices = async (): Promise<void> => {
      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        if (cancelled) {
          return;
        }
        const inputs = devices.filter((device) => device.kind === 'audioinput');
        setAudioInputs(inputs);
        if (!selectedInputId && inputs.length > 0) {
          setSelectedInputId(inputs[0].deviceId);
        }
      } catch {
        if (!cancelled) {
          setAudioInputs([]);
        }
      }
    };

    void refreshDevices();
    navigator.mediaDevices.addEventListener?.('devicechange', refreshDevices);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.('devicechange', refreshDevices);
    };
  }, [selectedInputId]);

  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== 'inactive') {
        recorderRef.current.stop();
      }
      if (lastRecordingUrlRef.current) {
        URL.revokeObjectURL(lastRecordingUrlRef.current);
      }
      resetRecorder();
    };
  }, []);

  const startQuestionRecording = async (): Promise<void> => {
    if (questionStatus !== 'IDLE') {
      return;
    }
    setQuestionFeedback(null);

    if (typeof window === 'undefined' || typeof window.MediaRecorder === 'undefined') {
      setQuestionFeedback('Recording is not supported in this browser.');
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      setQuestionFeedback('Microphone access is unavailable in this browser.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const selectedAudioConstraint = selectedInputId
        ? ({
            deviceId: { exact: selectedInputId },
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } as MediaTrackConstraints)
        : ({
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
          } as MediaTrackConstraints);
      const inputStream = await navigator.mediaDevices.getUserMedia({ audio: selectedAudioConstraint });
      const preferredMimeType = pickRecorderMimeType();
      const recorder = preferredMimeType ? new MediaRecorder(inputStream, { mimeType: preferredMimeType }) : new MediaRecorder(inputStream);

      for (const track of stream.getTracks()) {
        track.stop();
      }

      streamRef.current = inputStream;
      recorderRef.current = recorder;
      chunksRef.current = [];
      recordStartedAtRef.current = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          chunksRef.current.push(event.data);
        }
      };

      recorder.start();
      setQuestionStatus('RECORDING');
      setQuestionFeedback('Recording... allow player speech, then press Submit.');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Microphone permission was denied.';
      setQuestionFeedback(`Unable to start recording: ${message}`);
      resetRecorder();
    }
  };

  const submitRecordedQuestion = async (): Promise<void> => {
    const typedQuestionText = typedQuestion.trim();
    const shouldProcessVoice = questionStatus === 'RECORDING';

    if (!typedQuestionText && !shouldProcessVoice) {
      setQuestionFeedback('Type a question or use ASK to record one.');
      return;
    }

    setQuestionStatus('ANALYZING');
    setQuestionFeedback('Analyzing...');

    try {
      let capturedAudioBlob: Blob | null = null;
      let hasUsableVoice = false;

      const analyzeTypedQuestion = async (prefix?: string): Promise<boolean> => {
        if (!typedQuestionText) {
          return false;
        }

        try {
          const typedOutcome = await onAnalyzeQuestionText(typedQuestionText);
          if (typedOutcome.status === 'RESOLVED') {
            setQuestionFeedback(
              `${prefix ? `${prefix} ` : ''}Resolved from typed text: ${typedOutcome.answer} · ${typedOutcome.editedQuestion ?? typedOutcome.transcript}`
            );
            setTypedQuestion('');
            return true;
          }

          const heard = typedOutcome.transcript?.trim();
          setQuestionFeedback(
            heard
              ? `${prefix ? `${prefix} ` : ''}Typed text heard: "${heard}" but no clear card question was detected.`
              : `${prefix ? `${prefix} ` : ''}Typed text did not produce a clear card question.`
          );
          return true;
        } catch (error) {
          const typedErrorMessage = error instanceof Error ? error.message : 'Typed question analysis failed.';
          setQuestionFeedback(`${prefix ? `${prefix} ` : ''}Typed question failed: ${typedErrorMessage}`);
          return true;
        }
      };

      if (shouldProcessVoice) {
        const recorder = recorderRef.current;
        if (!recorder) {
          setQuestionFeedback('No active recording found. Press ASK first.');
          return;
        }

        capturedAudioBlob = await new Promise<Blob>((resolve, reject) => {
          recorder.addEventListener(
            'stop',
            () => {
              try {
                const blob = new Blob(chunksRef.current, { type: recorder.mimeType || 'audio/webm' });
                resolve(blob);
              } catch (error) {
                reject(error);
              }
            },
            { once: true }
          );
          recorder.addEventListener(
            'error',
            () => {
              reject(new Error('Recording failed while finalizing audio.'));
            },
            { once: true }
          );
          recorder.stop();
        });

        stopTracks();

        if (capturedAudioBlob.size > 0) {
          const durationMs = Math.max(0, Date.now() - recordStartedAtRef.current);
          setRecordingPreview(capturedAudioBlob);
          setLastRecordingMeta({
            durationMs,
            bytes: capturedAudioBlob.size,
            mimeType: capturedAudioBlob.type || recorder.mimeType || 'audio/webm'
          });
          hasUsableVoice = durationMs >= 500 && capturedAudioBlob.size >= 1200;
        }
      }

      if (!hasUsableVoice || !capturedAudioBlob) {
        if (await analyzeTypedQuestion()) {
          return;
        }
        setQuestionFeedback('Recording too short or silent. Ask again and keep mic closer to speaker.');
        return;
      }

      const voiceOutcome = await onAnalyzeQuestionAudio(capturedAudioBlob);
      if (voiceOutcome.status === 'RETRY') {
        if (typedQuestionText) {
          const voicePrefix =
            voiceOutcome.reason === 'NO_VALID_QUESTION'
              ? 'Voice transcription did not capture a clear question.'
              : voiceOutcome.reason === 'MODEL_REFUSED'
                ? 'Voice analysis was refused by the model.'
                : 'Voice analysis failed.';

          if (await analyzeTypedQuestion(voicePrefix)) {
            return;
          }
        }

        if (voiceOutcome.reason === 'NO_VALID_QUESTION') {
          const heard = voiceOutcome.transcript?.trim();
          setQuestionFeedback(
            heard
              ? `Heard: "${heard}" but no clear card question was detected. Ask again.`
              : 'No clear player question detected. Please ask again.'
          );
          return;
        }
        if (voiceOutcome.reason === 'MODEL_REFUSED') {
          setQuestionFeedback('Model refused this request. Please ask again.');
          return;
        }
        setQuestionFeedback('Analysis failed. Please ask again.');
      } else {
        setQuestionFeedback(`Resolved: ${voiceOutcome.answer} · ${voiceOutcome.editedQuestion ?? voiceOutcome.transcript}`);
        setTypedQuestion('');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to analyze recorded question.';
      setQuestionFeedback(message);
    } finally {
      setQuestionStatus('IDLE');
      resetRecorder();
    }
  };

  return (
    <section className="side-panel controls-panel">
      <div className="panel-header">
        <h3>Dealer Controls</h3>
        <div className="panel-header-actions">
          {state.phase !== 'LOBBY' && (
            <button
              type="button"
              className="danger ghost"
              onClick={() => {
                if (window.confirm('Reset game to lobby? Current round progress will be lost.')) {
                  void onResetGame();
                }
              }}
            >
              Reset
            </button>
          )}
          <button type="button" className="ghost" onClick={() => setCollapsed((prev) => !prev)}>
            {collapsed ? 'Expand' : 'Collapse'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="panel-scroll">
          {state.phase === 'LOBBY' && (
            <>
              <h4>Players</h4>
              <div className="inline-row">
                <input
                  placeholder="Player name"
                  value={newPlayerName}
                  onChange={(event) => setNewPlayerName(event.target.value)}
                />
                <select value={newPlayerTeam} onChange={(event) => setNewPlayerTeam(event.target.value as TeamId)}>
                  <option value="A">Team A</option>
                  <option value="B">Team B</option>
                </select>
                <button
                  type="button"
                  onClick={async () => {
                    if (!newPlayerName.trim()) {
                      return;
                    }
                    setSaving(true);
                    try {
                      await onAddPlayer({ name: newPlayerName.trim(), team: newPlayerTeam });
                      setNewPlayerName('');
                    } finally {
                      setSaving(false);
                    }
                  }}
                  disabled={saving}
                >
                  Add
                </button>
              </div>

              <PlayerSeatEditor
                players={state.players}
                onReorder={onReorderPlayers}
                onRemove={onRemovePlayer}
                onRename={(playerId, name) => onUpdatePlayer(playerId, { name })}
                onTeamChange={(playerId, team) => onUpdatePlayer(playerId, { team })}
              />

              <h4>Game Config</h4>
              <div className="config-grid">
                <label>
                  Rounds
                  <input
                    type="number"
                    min={1}
                    value={configDraft.rounds}
                    onChange={(event) => setConfigDraft((prev) => ({ ...prev, rounds: Number(event.target.value) }))}
                  />
                </label>
                <label>
                  Investigation (s)
                  <input
                    type="number"
                    min={10}
                    value={configDraft.investigationSeconds}
                    onChange={(event) =>
                      setConfigDraft((prev) => ({ ...prev, investigationSeconds: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  Scoring (s)
                  <input
                    type="number"
                    min={10}
                    value={configDraft.scoringSeconds}
                    onChange={(event) =>
                      setConfigDraft((prev) => ({ ...prev, scoringSeconds: Number(event.target.value) }))
                    }
                  />
                </label>
                <label>
                  Vault Start
                  <input
                    type="number"
                    min={1}
                    value={configDraft.vaultStart}
                    onChange={(event) => setConfigDraft((prev) => ({ ...prev, vaultStart: Number(event.target.value) }))}
                  />
                </label>
                <label className="inline-checkbox">
                  <input
                    type="checkbox"
                    checked={configDraft.insiderEnabled}
                    onChange={(event) => setConfigDraft((prev) => ({ ...prev, insiderEnabled: event.target.checked }))}
                  />
                  Insider twist enabled
                </label>
                <label className="inline-checkbox">
                  <input
                    type="checkbox"
                    checked={configDraft.ackWritesEnabled}
                    onChange={(event) => setConfigDraft((prev) => ({ ...prev, ackWritesEnabled: event.target.checked }))}
                  />
                  Ack writes enabled
                </label>
              </div>

              <button
                type="button"
                onClick={async () => {
                  setSaving(true);
                  try {
                    await onConfigChange(configDraft);
                    if (state.players.length > 0) {
                      await onInitializeWorkbook();
                    }
                  } finally {
                    setSaving(false);
                  }
                }}
                disabled={saving}
              >
                Save Config
              </button>

              <p className="muted small">
                Last workbook mtime:{' '}
                {state.workbook.lastMtimeMs ? new Date(state.workbook.lastMtimeMs).toLocaleTimeString() : '—'}
              </p>

              <div className="inline-row">
                <button
                  type="button"
                  onClick={() => {
                    void onInitializeWorkbook();
                  }}
                >
                  Initialize Workbook Now
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onRunDemo();
                  }}
                  className="two-line-button"
                >
                  Run
                  <br />
                  Demo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void onStartGame();
                  }}
                  className="two-line-button"
                >
                  Start Real
                  <br />
                  Game
                </button>
              </div>
              {state.demo.status === 'RUNNING' && <p className="muted small">Demo is running now…</p>}
            </>
          )}

          {state.phase === 'SETUP' && (
            <>
              <h4>Setup</h4>
              <p className="muted small">
                Dealer (host) position is between seat {state.round.dealerSeatIndex + 1} and seat{' '}
                {((state.round.dealerSeatIndex + 1) % Math.max(1, state.players.length)) + 1}. Investigation starts clockwise at seat{' '}
                {((state.round.dealerSeatIndex + 1) % Math.max(1, state.players.length)) + 1}.
              </p>
              <p className="muted small">
                Secret card and insider (if enabled) are selected automatically when investigation starts.
              </p>
              <button
                type="button"
                onClick={() => {
                  void onStartInvestigation();
                }}
              >
                Start Investigation
              </button>
            </>
          )}

          {state.phase === 'INVESTIGATION' && (
            <>
              <h4>Investigation</h4>
              <p className="muted small">Dealer flow: ASK to record, then Submit. Question + answer are auto-resolved.</p>
              <div className="inline-row">
                <button
                  type="button"
                  onClick={() => {
                    void startQuestionRecording();
                  }}
                  disabled={questionStatus !== 'IDLE'}
                >
                  ASK
                </button>
                  <button
                    type="button"
                    onClick={() => {
                      void submitRecordedQuestion();
                    }}
                    disabled={!canSubmitQuestion}
                  >
                    Submit
                  </button>
              </div>
              <label className="typed-question-field">
                Typed Question (Fallback)
                <textarea
                  rows={2}
                  placeholder="Type question if voice fails (e.g., Is it red?)"
                  value={typedQuestion}
                  onChange={(event) => setTypedQuestion(event.target.value)}
                  disabled={questionStatus === 'ANALYZING'}
                />
              </label>
              <label>
                Mic Input
                <select
                  value={selectedInputId}
                  onChange={(event) => setSelectedInputId(event.target.value)}
                  disabled={questionStatus !== 'IDLE'}
                >
                  {audioInputs.length === 0 && <option value="">Default microphone</option>}
                  {audioInputs.map((input, index) => (
                    <option key={input.deviceId || `mic-${index}`} value={input.deviceId}>
                      {input.label || `Microphone ${index + 1}`}
                    </option>
                  ))}
                </select>
              </label>
              {lastRecordingUrl && (
                <div className="audio-review">
                  <button
                    type="button"
                    className="ghost"
                    onClick={() => {
                      const audio = previewAudioRef.current;
                      if (!audio) {
                        return;
                      }
                      audio.currentTime = 0;
                      audio.muted = false;
                      audio.volume = 1;
                      audio
                        .play()
                        .catch((error) => {
                          const message = error instanceof Error ? error.message : String(error);
                          setQuestionFeedback(`Cannot play recording: ${message}`);
                        });
                    }}
                    disabled={questionStatus === 'RECORDING'}
                  >
                    Play Last Recording
                  </button>
                  <audio ref={previewAudioRef} src={lastRecordingUrl} preload="metadata" controls className="audio-preview" />
                  {lastRecordingMeta && (
                    <p className="muted small">
                      Last recording: {(lastRecordingMeta.durationMs / 1000).toFixed(1)}s, {formatBytes(lastRecordingMeta.bytes)} (
                      {lastRecordingMeta.mimeType || 'unknown'})
                    </p>
                  )}
                </div>
              )}
              {questionStatus === 'ANALYZING' && <p className="muted small">Analyzing...</p>}
              {questionFeedback && <p className="muted small">{questionFeedback}</p>}

              <button
                type="button"
                onClick={() => {
                  if (currentTurnPlayer) {
                    void onCallVault(currentTurnPlayer.id);
                  }
                }}
                disabled={!currentTurnPlayer || questionStatus === 'ANALYZING'}
              >
                Call Vault (Current Turn)
              </button>
            </>
          )}

          {state.phase === 'SCORING' && (
            <>
              <h4>Scoring</h4>
              <div className="round-code">{state.round.roundCode}</div>
              <p className="muted small">
                Players: set Level, then fill SAFE=Color, MEDIUM=Suits, BOLD=Number+Suits.
              </p>
            </>
          )}

          {state.phase === 'REVEAL' && (
            <>
              <h4>Reveal</h4>
              <button
                type="button"
                onClick={() => {
                  void onNextRound();
                }}
              >
                Next Round
              </button>
            </>
          )}

          {state.phase === 'DONE' && (
            <>
              <h4>Demo Complete</h4>
              <p className="muted small">
                Demo/game ended. Press start to begin the real game from round 1 with the current players.
              </p>
              <button
                type="button"
                onClick={() => {
                  void onStartRealGame();
                }}
              >
                START REAL GAME
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
