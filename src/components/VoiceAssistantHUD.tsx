import React, { useState, useEffect, useRef } from 'react';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Radio,
  Settings,
  Sparkles,
  RotateCcw,
  X,
  Check,
  Key,
  MessageSquare,
  Send,
  Keyboard,
  Trash2,
  Camera,
} from 'lucide-react';
import {
  voiceAssistantService,
  VoiceAssistantState,
} from '../services/voiceAssistantService';
import { MovementTelemetry } from '../services/movementTrackingService';
import { GeneratedMission } from '../services/geminiMissionService';
import { LocalityWaypoint } from '../types';
import { hapticFeedback } from '../utils/haptics';

interface VoiceAssistantHUDProps {
  telemetry: MovementTelemetry;
  mission: GeneratedMission;
  activeWaypoint?: LocalityWaypoint | null;
  explorerName?: string;
  playerScore?: number;
  playerInventory?: string[];
  foundItems?: string[];
  onToggleItemFound?: (item: string) => void;
  onActionTriggered?: (action: string, payload?: any) => void;
}

export const VoiceAssistantHUD: React.FC<VoiceAssistantHUDProps> = ({
  telemetry,
  mission,
  activeWaypoint,
  explorerName = 'Explorer',
  playerScore,
  playerInventory,
  foundItems = [],
  onToggleItemFound,
  onActionTriggered,
}) => {
  const [state, setState] = useState<VoiceAssistantState>(
    voiceAssistantService.getState()
  );
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isTextInputOpen, setIsTextInputOpen] = useState(false);
  const [typedMessage, setTypedMessage] = useState('');
  const [customKeyInput, setCustomKeyInput] = useState('');
  const [keyUpdateStatus, setKeyUpdateStatus] = useState<string | null>(null);
  const historyBottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const unsub = voiceAssistantService.subscribe((s) => setState(s));
    const unsubAction = voiceAssistantService.onAction((action, payload) => {
      if (onActionTriggered) {
        onActionTriggered(action, payload);
      }
    });
    return () => {
      unsub();
      unsubAction();
    };
  }, [onActionTriggered]);

  // Keep background context synced
  useEffect(() => {
    voiceAssistantService.updateContext({
      telemetry,
      mission,
      activeWaypoint,
      explorerName,
      playerScore,
      playerInventory,
    });
  }, [telemetry, mission, activeWaypoint, explorerName, playerScore, playerInventory]);

  // Proactive movement coaching in background
  useEffect(() => {
    voiceAssistantService.onMovementTelemetry(telemetry, mission);
  }, [telemetry, mission]);

  // Scroll history dialog to bottom when opened
  useEffect(() => {
    if (isHistoryOpen) {
      setTimeout(() => {
        historyBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    }
  }, [isHistoryOpen, state.lastSpokenText]);

  const handleMicClick = () => {
    hapticFeedback.buttonPress();
    voiceAssistantService.unlockAudioContext();
    voiceAssistantService.toggleListening({
      telemetry,
      mission,
      activeWaypoint,
      explorerName,
    });
  };

  const handleMuteToggle = () => {
    hapticFeedback.tactileClick();
    voiceAssistantService.toggleMute();
  };

  const handleSendTypedMessage = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!typedMessage.trim()) return;
    const msg = typedMessage.trim();
    setTypedMessage('');
    setIsTextInputOpen(false);
    hapticFeedback.buttonPress();
    voiceAssistantService.interact(msg, {
      telemetry,
      mission,
      activeWaypoint,
      explorerName,
      playerScore,
      playerInventory,
    });
  };

  const handleSaveApiKey = async () => {
    if (!customKeyInput.trim()) return;
    try {
      setKeyUpdateStatus('Saving...');
      const res = await fetch('/api/elevenlabs/set-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: customKeyInput.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('ecoquest_voice_api_key', customKeyInput.trim());
        setKeyUpdateStatus('Key saved successfully!');
        setTimeout(() => {
          setKeyUpdateStatus(null);
          setIsSettingsOpen(false);
        }, 1500);
      } else {
        setKeyUpdateStatus(data.error || 'Error saving key');
      }
    } catch (_) {
      setKeyUpdateStatus('Failed to update key');
    }
  };

  const isListening = state.status === 'listening';
  const isThinking = state.status === 'thinking';
  const isSpeaking = state.status === 'speaking';

  const history = voiceAssistantService.getConversationHistory();
  const scavengerItems = mission?.scavengerItems || [];
  const remainingItems = scavengerItems.filter((item) => !foundItems.includes(item));
  const allItemsFound = scavengerItems.length > 0 && remainingItems.length === 0;

  return (
    <>
      {/* Sleek, Non-Intrusive Siri/Google Assistant Dock */}
      <div className="w-full my-2 sm:my-3">
        <div className="relative overflow-hidden rounded-2xl bg-stone-900/95 dark:bg-stone-900/95 border border-stone-700/80 shadow-[0_4px_16px_rgba(0,0,0,0.18)] backdrop-blur-md px-3.5 py-2.5 sm:px-4 sm:py-3 transition-all">
          {/* Subtle Ambient Aura when listening or speaking */}
          {isListening && (
            <div className="absolute inset-0 bg-gradient-to-r from-red-500/10 via-amber-500/15 to-emerald-500/10 animate-pulse pointer-events-none" />
          )}
          {isSpeaking && (
            <div className="absolute inset-0 bg-gradient-to-r from-cyan-500/10 via-emerald-500/15 to-teal-500/10 animate-pulse pointer-events-none" />
          )}

          <div className="relative flex items-center justify-between gap-3 min-w-0">
            {/* Left: Interactive Siri/Google Assistant Orb & Status */}
            <div
              onClick={handleMicClick}
              className="flex items-center gap-3 min-w-0 cursor-pointer group select-none"
              title="Click or say 'EcoQuest' to speak"
            >
              {/* Animated Siri/Google Glowing Orb */}
              <div className="relative flex items-center justify-center shrink-0">
                {/* Outer Breathing Rings */}
                {isListening ? (
                  <span className="absolute -inset-1.5 rounded-full bg-gradient-to-tr from-amber-400 via-rose-500 to-emerald-400 opacity-75 blur-xs animate-spin duration-3000" />
                ) : isSpeaking ? (
                  <span className="absolute -inset-1.5 rounded-full bg-gradient-to-tr from-cyan-400 via-emerald-400 to-teal-400 opacity-70 blur-xs animate-pulse" />
                ) : isThinking ? (
                  <span className="absolute -inset-1.5 rounded-full bg-gradient-to-tr from-amber-400 to-purple-500 opacity-70 blur-xs animate-spin" />
                ) : (
                  <span className="absolute -inset-1 rounded-full bg-emerald-500/20 group-hover:bg-emerald-500/40 transition-colors" />
                )}

                {/* Core Orb Button */}
                <div
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition-transform active:scale-95 shadow-md relative z-10 ${
                    isListening
                      ? 'bg-rose-500 text-white scale-105'
                      : isSpeaking
                      ? 'bg-emerald-600 text-white'
                      : isThinking
                      ? 'bg-amber-500 text-stone-950 animate-pulse'
                      : 'bg-stone-800 text-emerald-400 border border-stone-700/80 group-hover:border-emerald-500/50'
                  }`}
                >
                  {isListening ? (
                    <Mic className="w-5 h-5 animate-bounce" />
                  ) : isSpeaking ? (
                    <Radio className="w-5 h-5 animate-pulse" />
                  ) : isThinking ? (
                    <Sparkles className="w-5 h-5 animate-spin" />
                  ) : (
                    <Mic className="w-5 h-5 group-hover:scale-110 transition-transform" />
                  )}
                </div>
              </div>

              {/* Status & Wake Word Hint */}
              <div className="flex flex-col min-w-0">
                <div className="flex items-center gap-1.5 sm:gap-2 flex-wrap">
                  <span className="font-display font-extrabold text-xs sm:text-sm text-stone-100 tracking-tight">
                    Aura
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-md bg-stone-800 text-emerald-400 border border-stone-700/50">
                    EcoQuest Guide
                  </span>

                  {/* Quest Specimen Tracker Badge */}
                  <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-md bg-emerald-950/80 text-emerald-300 border border-emerald-700/60 font-bold">
                    🌿 {foundItems.length}/{scavengerItems.length} Found
                  </span>

                  {/* Standalone Voice Relay Connection Badge */}
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md flex items-center gap-1 border ${
                      state.isRelayConnected
                        ? 'bg-emerald-950/80 text-emerald-300 border-emerald-700/80'
                        : 'bg-stone-800 text-stone-400 border-stone-700'
                    }`}
                    title={state.isRelayConnected ? 'Connected to /ws/aura-voice WebSocket relay' : 'Connecting to voice relay...'}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full ${
                        state.isRelayConnected ? 'bg-emerald-400 animate-ping' : 'bg-stone-500'
                      }`}
                    />
                    <span className="hidden sm:inline">{state.isRelayConnected ? 'WS RELAY LIVE' : 'SYNCING'}</span>
                  </span>

                  {/* Wake Word Standby Indicator */}
                  <span
                    className={`text-[9px] font-mono px-1.5 py-0.5 rounded-md flex items-center gap-1 border ${
                      state.isWakeWordEnabled
                        ? 'bg-emerald-950/90 text-emerald-300 border-emerald-700/70'
                        : 'bg-stone-800 text-stone-400 border-stone-700'
                    }`}
                    title="Aura is listening for the 'Aura' wake word"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span>EAR ACTIVE ("AURA")</span>
                  </span>

                  {/* Countdown indicator when listening */}
                  {isListening && (
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-rose-500/30 text-rose-300 border border-rose-500/50 animate-pulse flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping" />
                        Listening ({state.silenceSecondsRemaining}s)
                      </span>
                      {/* Live input audio level meter */}
                      <div className="flex items-end gap-0.5 h-3 px-1">
                        <span
                          className="w-1 bg-emerald-400 rounded-full transition-all duration-75"
                          style={{ height: `${Math.max(4, Math.min(14, (state.inputAudioLevel || 10) * 0.14))}px` }}
                        />
                        <span
                          className="w-1 bg-emerald-400 rounded-full transition-all duration-75"
                          style={{ height: `${Math.max(4, Math.min(18, (state.inputAudioLevel || 10) * 0.2))}px` }}
                        />
                        <span
                          className="w-1 bg-emerald-400 rounded-full transition-all duration-75"
                          style={{ height: `${Math.max(4, Math.min(14, (state.inputAudioLevel || 10) * 0.16))}px` }}
                        />
                      </div>
                    </div>
                  )}
                  {isThinking && (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-amber-500/30 text-amber-300 border border-amber-500/50">
                      Thinking...
                    </span>
                  )}
                  {isSpeaking && (
                    <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded-full bg-emerald-500/30 text-emerald-300 border border-emerald-500/50 flex items-center gap-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                      Speaking
                    </span>
                  )}
                </div>

                <div className="text-[11px] sm:text-xs text-stone-400 flex items-center gap-1.5 truncate">
                  {isListening ? (
                    state.currentTranscript ? (
                      <span className="text-emerald-300 font-bold truncate flex items-center gap-1.5 animate-pulse">
                        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                        Hearing: "{state.currentTranscript}"
                      </span>
                    ) : (
                      <span className="text-rose-300 font-medium truncate flex items-center gap-1">
                        <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping shrink-0" />
                        Listening to your voice... Speak now (or tap Send below)
                      </span>
                    )
                  ) : isSpeaking ? (
                    <span className="text-emerald-300 font-medium truncate">
                      Aura speaking in soothing companion voice
                    </span>
                  ) : isThinking ? (
                    <span className="text-amber-300 font-medium">Evaluating quest progress with live game state...</span>
                  ) : (
                    <span className="truncate">
                      Say <strong className="text-emerald-400 font-mono font-bold">"Aura"</strong> or tap mic to speak
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* If currently listening, show immediate SEND NOW button */}
            {isListening && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  hapticFeedback.buttonPress();
                  voiceAssistantService.processCapturedSpeech();
                }}
                className="px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-stone-950 font-mono text-xs font-black uppercase tracking-wider flex items-center gap-1 cursor-pointer shadow-md shrink-0 animate-in zoom-in-95"
                title="Finish speaking and send speech to Aura"
              >
                <span>Send ➔</span>
              </button>
            )}

            {/* Right: Quick Controls (History Drawer, Keyboard Input, Replay, Mute, Settings) */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              {/* Conversation History Drawer Button */}
              <button
                onClick={() => {
                  hapticFeedback.tactileClick();
                  setIsHistoryOpen(true);
                }}
                className="relative p-1.5 sm:p-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-stone-100 transition-colors cursor-pointer border border-stone-700/60"
                title="View full conversation history with Aura"
              >
                <MessageSquare className="w-4 h-4" />
                {history.length > 0 && (
                  <span className="absolute -top-1 -right-1 px-1 rounded-full bg-emerald-600 text-white font-mono text-[9px] font-bold">
                    {history.length}
                  </span>
                )}
              </button>

              {/* Text Input Toggle Button (for quiet environments or mic muted) */}
              <button
                onClick={() => {
                  hapticFeedback.tactileClick();
                  setIsTextInputOpen(!isTextInputOpen);
                }}
                className={`p-1.5 sm:p-2 rounded-xl transition-colors cursor-pointer border ${
                  isTextInputOpen
                    ? 'bg-emerald-900/80 text-emerald-300 border-emerald-600'
                    : 'bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-stone-100 border-stone-700/60'
                }`}
                title="Type message to Aura"
              >
                <Keyboard className="w-4 h-4" />
              </button>

              {/* Replay Button if speech was recently played */}
              {state.lastSpokenText && !isSpeaking && !isListening && (
                <button
                  onClick={() => {
                    hapticFeedback.tactileClick();
                    voiceAssistantService.replayLastMessage();
                  }}
                  className="p-1.5 sm:p-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-stone-100 transition-colors cursor-pointer border border-stone-700/60"
                  title="Replay last spoken guidance"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>
              )}

              {/* Mute Button */}
              <button
                onClick={handleMuteToggle}
                className={`p-1.5 sm:p-2 rounded-xl transition-colors cursor-pointer border ${
                  state.isMuted
                    ? 'bg-rose-950/60 text-rose-400 border-rose-800/80 hover:bg-rose-900/80'
                    : 'bg-stone-800 text-stone-300 border-stone-700/60 hover:bg-stone-700 hover:text-stone-100'
                }`}
                title={state.isMuted ? 'Unmute voice assistant' : 'Mute voice assistant'}
              >
                {state.isMuted ? (
                  <VolumeX className="w-4 h-4" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
              </button>

              {/* Settings / API Key Popover Button */}
              <button
                onClick={() => setIsSettingsOpen(true)}
                className="p-1.5 sm:p-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer border border-stone-700/60"
                title="Voice Assistant & ElevenLabs Settings"
              >
                <Settings className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Mic Permission or Error Notice */}
          {state.errorMessage && (
            <div className="mt-2.5 p-2 rounded-xl bg-rose-950/80 border border-rose-800/80 text-rose-200 text-xs flex items-center justify-between gap-2">
              <span className="truncate">{state.errorMessage}</span>
              <button
                type="button"
                onClick={async () => {
                  hapticFeedback.buttonPress();
                  await voiceAssistantService.testMicrophone();
                  handleMicClick();
                }}
                className="px-2.5 py-1 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-mono text-[10px] font-bold uppercase shrink-0 cursor-pointer shadow-xs"
              >
                Allow Mic
              </button>
            </div>
          )}

          {/* Quick Inline Keyboard Text Input Bar */}
          {isTextInputOpen && (
            <form onSubmit={handleSendTypedMessage} className="mt-2.5 pt-2 border-t border-stone-800/80 flex items-center gap-2">
              <input
                type="text"
                value={typedMessage}
                onChange={(e) => setTypedMessage(e.target.value)}
                placeholder="Type anything to Aura (e.g. 'I found the pebbles', 'give me a clue')..."
                className="flex-1 bg-stone-950 border border-stone-700 rounded-xl px-3 py-1.5 text-xs text-stone-100 font-sans outline-none focus:border-emerald-500"
                autoFocus
              />
              <button
                type="submit"
                className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-stone-950 font-mono text-xs font-bold flex items-center gap-1 cursor-pointer"
              >
                <Send className="w-3.5 h-3.5" />
                <span>Send</span>
              </button>
            </form>
          )}

          {/* Aura Live Spoken Subtitle & Thought Drawer (1-2 sentences) */}
          {state.lastSpokenText && (
            <div className="mt-2.5 pt-2 border-t border-stone-800/80 flex items-start gap-2.5">
              <span className="text-base select-none mt-0.5">✨</span>
              <div className="flex-1 min-w-0">
                <p className="text-xs sm:text-[13px] text-stone-200 font-sans font-medium leading-relaxed">
                  "{state.lastSpokenText}"
                </p>
                {state.lastThought && (
                  <span className="text-[10px] font-mono text-stone-500 block mt-0.5">
                    Brain: {state.lastThought}
                  </span>
                )}
              </div>
            </div>
          )}

          {/* Dynamic Quick Voice Chips - SPECIFICALLY TAILORED TO ACTIVE QUEST & REMAINING SPECIMENS */}
          <div className="mt-2.5 pt-2 border-t border-stone-800/60 flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            <span className="text-[9px] font-mono font-bold text-stone-500 uppercase tracking-wider shrink-0">
              TALK TO AURA:
            </span>

            {/* Primary Instant Task Inquiry Button */}
            <button
              type="button"
              onClick={() => {
                hapticFeedback.buttonPress();
                voiceAssistantService.askWhatIsMyTask();
              }}
              className="text-[10px] font-mono font-bold px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-stone-950 border border-emerald-300 shrink-0 cursor-pointer shadow-xs transition-transform active:scale-95 flex items-center gap-1 animate-pulse"
              title="Ask Aura 'What is my task?' and hear spoken response"
            >
              <span>🎯 What is my task?</span>
            </button>

            {/* Quick Test Voice Audio Output Button */}
            <button
              type="button"
              onClick={() => {
                hapticFeedback.buttonPress();
                voiceAssistantService.testVoiceSpeaker();
              }}
              className="text-[10px] font-mono px-2 py-1 rounded-lg bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-600/80 shrink-0 cursor-pointer transition-colors flex items-center gap-1"
              title="Test Aura Voice Assistant neural speaker"
            >
              <Volume2 className="w-3 h-3" />
              <span>🔊 Test Voice</span>
            </button>

            {/* Dynamic remaining items chips */}
            {remainingItems.slice(0, 2).map((item, idx) => (
              <button
                key={idx}
                onClick={() => {
                  hapticFeedback.buttonPress();
                  voiceAssistantService.interact(`I just found the ${item}!`);
                }}
                className="text-[10px] font-mono px-2 py-1 rounded-lg bg-emerald-950/80 hover:bg-emerald-900 text-emerald-300 border border-emerald-700/80 shrink-0 cursor-pointer transition-colors flex items-center gap-1"
              >
                <span>🍃 Found {item.split('(')[0].trim()}</span>
              </button>
            ))}

            {/* All items collected chip -> open camera */}
            {allItemsFound && (
              <button
                onClick={() => {
                  hapticFeedback.buttonPress();
                  voiceAssistantService.interact('I found all items and finished the craft, open the camera box to take a picture!');
                }}
                className="text-[10px] font-mono px-2 py-1 rounded-lg bg-amber-950/80 hover:bg-amber-900 text-amber-300 border border-amber-600/80 shrink-0 cursor-pointer transition-colors flex items-center gap-1"
              >
                <Camera className="w-3 h-3" />
                <span>📸 Snap Craft Photo</span>
              </button>
            )}

            <button
              onClick={() => {
                hapticFeedback.buttonPress();
                voiceAssistantService.interact('Give me a location clue for our quest!');
              }}
              className="text-[10px] font-mono px-2 py-1 rounded-lg bg-stone-800/90 hover:bg-stone-700 text-emerald-300 border border-stone-700/60 shrink-0 cursor-pointer transition-colors"
            >
              💡 Give clue
            </button>
            <button
              onClick={() => {
                hapticFeedback.buttonPress();
                voiceAssistantService.interact('What time is it right now?');
              }}
              className="text-[10px] font-mono px-2 py-1 rounded-lg bg-stone-800/90 hover:bg-stone-700 text-cyan-300 border border-stone-700/60 shrink-0 cursor-pointer transition-colors"
            >
              ⏰ What time is it?
            </button>
            <button
              onClick={() => {
                hapticFeedback.buttonPress();
                voiceAssistantService.interact('Tell me a funny nature joke!');
              }}
              className="text-[10px] font-mono px-2 py-1 rounded-lg bg-stone-800/90 hover:bg-stone-700 text-purple-300 border border-stone-700/60 shrink-0 cursor-pointer transition-colors"
            >
              😂 Nature joke
            </button>
            <button
              onClick={() => {
                hapticFeedback.buttonPress();
                voiceAssistantService.interact('Where am I currently? Tell me my area, city, state, and country!');
              }}
              className="text-[10px] font-mono px-2 py-1 rounded-lg bg-stone-800/90 hover:bg-stone-700 text-rose-300 border border-stone-700/60 shrink-0 cursor-pointer transition-colors"
            >
              📍 Where am I? (Area & City)
            </button>
          </div>
        </div>
      </div>

      {/* FULL CONVERSATION HISTORY & FIELD CODEX LOG DIALOG */}
      {isHistoryOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-lg rounded-3xl bg-stone-900 text-stone-100 border border-stone-700 p-5 sm:p-6 shadow-2xl relative flex flex-col max-h-[85vh]">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-800">
              <div className="flex items-center gap-2">
                <MessageSquare className="w-5 h-5 text-emerald-400" />
                <div>
                  <h3 className="font-display font-extrabold text-base text-stone-100">
                    Aura Expedition Conversation Memory
                  </h3>
                  <div className="text-[10px] font-mono text-stone-400">
                    Active Quest: {mission?.title || 'Outdoor Nature Hunt'} · {foundItems.length}/{scavengerItems.length} specimens recorded
                  </div>
                </div>
              </div>
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="p-1 rounded-xl text-stone-400 hover:text-stone-100 hover:bg-stone-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conversation Log List */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3 pr-1 text-xs">
              {history.length === 0 ? (
                <div className="p-6 rounded-2xl bg-stone-800/50 border border-stone-800 text-center text-stone-400 font-mono">
                  No conversation recorded yet. Say "Aura" or tap the mic to begin exploring!
                </div>
              ) : (
                history.map((turn, idx) => (
                  <div
                    key={idx}
                    className={`p-3 rounded-2xl flex flex-col gap-1 border ${
                      turn.role === 'user'
                        ? 'bg-stone-800/90 border-stone-700/80 text-stone-200 ml-4'
                        : 'bg-emerald-950/60 border-emerald-800/70 text-emerald-100 mr-4'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono font-bold">
                      <span className={turn.role === 'user' ? 'text-stone-400' : 'text-emerald-400 flex items-center gap-1'}>
                        {turn.role === 'user' ? `👤 ${explorerName}` : '✨ Aura (Companion)'}
                      </span>
                      {turn.timestamp && (
                        <span className="text-stone-500">
                          {new Date(turn.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                      )}
                    </div>
                    <p className="font-sans text-xs sm:text-[13px] leading-relaxed">
                      {turn.text}
                    </p>
                  </div>
                ))
              )}
              <div ref={historyBottomRef} />
            </div>

            {/* Footer with Clear and Close Actions */}
            <div className="pt-3 border-t border-stone-800 flex items-center justify-between">
              <button
                onClick={() => {
                  hapticFeedback.tactileClick();
                  voiceAssistantService.clearConversationHistory();
                  setState(voiceAssistantService.getState());
                }}
                className="text-[11px] font-mono text-stone-500 hover:text-rose-400 flex items-center gap-1 cursor-pointer transition-colors"
                title="Clear conversation history from device"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Clear Memory</span>
              </button>

              <button
                onClick={() => setIsHistoryOpen(false)}
                className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 font-mono text-xs font-bold cursor-pointer"
              >
                Back to Quest
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Settings Dialog (Tucked away, zero clutter on main screen) */}
      {isSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150">
          <div className="w-full max-w-md rounded-2xl bg-stone-900 text-stone-100 border border-stone-700 p-5 shadow-2xl relative">
            <div className="flex items-center justify-between pb-3 border-b border-stone-800">
              <div className="flex items-center gap-2">
                <Key className="w-4 h-4 text-emerald-400" />
                <h3 className="font-display font-extrabold text-base">
                  Voice Assistant Settings
                </h3>
              </div>
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="p-1 rounded-lg text-stone-400 hover:text-stone-100 hover:bg-stone-800 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="py-4 space-y-4 text-xs font-mono">
              <div>
                <label className="block text-stone-300 font-bold mb-1">
                  Wake-Word Detection:
                </label>
                <div className="p-2.5 rounded-xl bg-stone-800/80 border border-stone-700 flex items-center justify-between">
                  <div>
                    <div className="text-stone-200 font-bold">Say "EcoQuest"</div>
                    <div className="text-stone-400 text-[10px]">
                      Turns on mic automatically with wake chime, auto-turns off after 5s of silence
                    </div>
                  </div>
                  <button
                    onClick={() => voiceAssistantService.toggleWakeWord()}
                    className={`px-3 py-1 rounded-lg font-bold text-[11px] cursor-pointer transition-colors ${
                      state.isWakeWordEnabled
                        ? 'bg-emerald-600 text-white'
                        : 'bg-stone-700 text-stone-300'
                    }`}
                  >
                    {state.isWakeWordEnabled ? 'ACTIVE' : 'OFF'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-stone-300 font-bold mb-1">
                  Active Voice Persona (Fixed & Consistent):
                </label>
                <div className="p-2.5 rounded-xl bg-stone-800/80 border border-stone-700 text-stone-300 text-[11px]">
                  Aura · Soothing Companion Voice (Zephyr / ElevenLabs Rachel)
                  <div className="text-stone-400 text-[10px] mt-0.5">
                    Natural, warm, human-like voice with acoustic warmth EQ, pleasing to the ears in earphones.
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-stone-300 font-bold mb-1">
                  ElevenLabs API Key (Optional):
                </label>
                <div className="flex gap-2">
                  <input
                    type="password"
                    placeholder="Enter sk_... key"
                    value={customKeyInput}
                    onChange={(e) => setCustomKeyInput(e.target.value)}
                    className="flex-1 px-3 py-2 rounded-xl bg-stone-950 border border-stone-700 text-stone-100 text-xs focus:outline-hidden focus:border-emerald-500 font-mono"
                  />
                  <button
                    onClick={handleSaveApiKey}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold cursor-pointer transition-colors text-xs"
                  >
                    Save
                  </button>
                </div>
                {keyUpdateStatus && (
                  <div className="mt-1 text-[11px] text-emerald-400">
                    {keyUpdateStatus}
                  </div>
                )}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setIsSettingsOpen(false)}
                className="px-4 py-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 font-mono text-xs font-bold cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
