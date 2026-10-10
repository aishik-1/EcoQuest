import React, { useState, useEffect } from 'react';
import {
  Volume2,
  VolumeX,
  Radio,
  Compass,
  Footprints,
  Shield,
  Zap,
  Sparkles,
  Smartphone,
  ChevronRight,
  Headphones,
  Music,
  Mic,
  MicOff,
  RotateCcw,
  Send,
  Award,
} from 'lucide-react';
import { ambientAudioService } from '../services/ambientAudioService';
import { movementTrackingService, MovementTelemetry } from '../services/movementTrackingService';
import { voiceAssistantService, VoiceAssistantState } from '../services/voiceAssistantService';
import { GeneratedMission } from '../services/geminiMissionService';
import { hapticFeedback } from '../utils/haptics';

interface PocketModeHUDProps {
  onClose?: () => void;
  isFullScreen?: boolean;
  explorerName?: string;
  mission?: GeneratedMission;
  playerScore?: number;
  playerInventory?: string[];
}

export const PocketModeHUD: React.FC<PocketModeHUDProps> = ({
  onClose,
  isFullScreen = false,
  explorerName = 'Explorer',
  mission,
  playerScore,
  playerInventory,
}) => {
  const [isRadarPinging, setIsRadarPinging] = useState(false);
  const [hapticCount, setHapticCount] = useState(0);
  const [currentDistance, setCurrentDistance] = useState(128); // meters
  const [customInputText, setCustomInputText] = useState('');
  const [activeChipIndex, setActiveChipIndex] = useState<number | null>(null);

  const [telemetry, setTelemetry] = useState<MovementTelemetry>(
    movementTrackingService.getTelemetry()
  );
  const [audioState, setAudioState] = useState(ambientAudioService.getState());
  const [voiceState, setVoiceState] = useState<VoiceAssistantState>(
    voiceAssistantService.getState()
  );

  const activeMission = mission || voiceAssistantService.getLatestMission();

  useEffect(() => {
    const unsubMotion = movementTrackingService.subscribe((t) => setTelemetry(t));
    const unsubAudio = ambientAudioService.subscribe((a) => setAudioState(a));
    const unsubVoice = voiceAssistantService.subscribe((v) => setVoiceState(v));
    return () => {
      unsubMotion();
      unsubAudio();
      unsubVoice();
    };
  }, []);

  // Quick tactile nature observation chips tailored to Aura's nature hunt rules
  const quickObservationChips = [
    { label: 'Found a Unique Leaf', query: 'I found a uniquely shaped leaf with vibrant veins on the path!', icon: '🍃' },
    { label: 'Found a Smooth Stone', query: 'I located a smooth river stone nestled in the soil!', icon: '🪨' },
    { label: 'Spotted Green Moss', query: 'I spotted velvet green moss growing on a shady tree trunk!', icon: '🌿' },
    { label: 'Found a Curved Twig', query: 'I picked up a sturdy curved twig for the craft spine!', icon: '🪵' },
    { label: 'Give Me a Quest Hint', query: 'Aura, give me a hint for what to search for next!', icon: '✨' },
    { label: 'Where Should I Walk?', query: 'Which direction should I walk along the trail?', icon: '🧭' },
  ];

  const handleChipClick = async (chip: typeof quickObservationChips[0], index: number) => {
    hapticFeedback.buttonPress();
    setActiveChipIndex(index);
    setTimeout(() => setActiveChipIndex(null), 1000);
    await voiceAssistantService.interact(chip.query, {
      telemetry,
      mission: activeMission,
      explorerName,
      playerScore,
      playerInventory,
    });
  };

  const handleSendCustomText = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!customInputText.trim()) return;
    const query = customInputText.trim();
    setCustomInputText('');
    hapticFeedback.buttonPress();
    await voiceAssistantService.interact(query, {
      telemetry,
      mission: activeMission,
      explorerName,
      playerScore,
      playerInventory,
    });
  };

  // Trigger simulated tactile radar ping
  const triggerPing = () => {
    hapticFeedback.radarPulse();
    setIsRadarPinging(true);
    setHapticCount((prev) => prev + 1);
    setCurrentDistance((prev) => Math.max(8, prev - 12));
    setTimeout(() => {
      setIsRadarPinging(false);
    }, 1200);
  };

  const toggleAmbientSound = () => {
    hapticFeedback.tactileClick();
    ambientAudioService.togglePlay();
  };

  const isListening = voiceState.status === 'listening';
  const isSpeaking = voiceState.status === 'speaking';
  const isThinking = voiceState.status === 'thinking';

  return (
    <div
      className={`relative w-full rounded-2xl bg-[#09090b] text-white p-4 sm:p-6 flex flex-col justify-between overflow-hidden border border-white/10 select-none ${
        isFullScreen ? 'min-h-[560px]' : 'min-h-[480px]'
      }`}
    >
      {/* 1. Active Quest & Battery Telemetry Bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono border-b border-white/10 pb-3">
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${telemetry.state === 'MOVING' ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
          <span className="text-white font-semibold">
            {telemetry.state === 'MOVING'
              ? `TRACKING: WALKING (${telemetry.speedMps} M/S · ${telemetry.distanceCoveredMeters}M)`
              : `TRACKING: ON TRAIL (${telemetry.distanceCoveredMeters}M TOTAL)`}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-emerald-400 font-bold bg-emerald-950/60 px-2.5 py-1 rounded-lg border border-emerald-500/30">
          <Sparkles className="w-3.5 h-3.5 text-emerald-300" />
          <span>AURA · ECOQUEST GO</span>
        </div>
      </div>

      {/* 2. Quest Objective Reminder Capsule */}
      <div className="mt-3 p-3 rounded-xl bg-stone-900/90 border border-emerald-500/20 flex items-center justify-between gap-3 text-xs font-mono">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-base shrink-0">🎯</span>
          <div className="truncate">
            <span className="text-neutral-400 uppercase text-[10px] block">Current Quest Phase:</span>
            <span className="text-emerald-300 font-bold truncate">
              {activeMission?.title || 'The Forest Leaf Dragon'}
            </span>
          </div>
        </div>
        <div className="text-[10px] text-neutral-400 bg-black/50 px-2 py-1 rounded border border-white/5 shrink-0">
          Headphones Live 🎧
        </div>
      </div>

      {/* 3. Center Tactical Audio Radar Display with Aura Visualizer */}
      <div className="py-4 text-center flex flex-col items-center">
        {/* Pulsing Radar Ring */}
        <div className="relative w-36 h-36 sm:w-44 sm:h-44 flex items-center justify-center my-2">
          <div className="absolute inset-0 rounded-full border border-emerald-500/20" />
          <div className="absolute inset-4 rounded-full border border-emerald-500/30" />
          <div className="absolute inset-8 rounded-full border border-emerald-500/40" />

          {/* Radar Sweep Line */}
          <div className="absolute inset-0 rounded-full overflow-hidden">
            <div className="w-full h-full animate-radar-sweep origin-center bg-gradient-to-tr from-transparent via-transparent to-emerald-500/25" />
          </div>

          {/* Glowing Aura Ring when speaking/listening */}
          {(isListening || isSpeaking) && (
            <div className={`absolute inset-0 rounded-full border-2 ${isListening ? 'border-rose-400' : 'border-emerald-400'} animate-ping opacity-60`} />
          )}

          {/* Central Bearing & Distance */}
          <div className="relative z-10 flex flex-col items-center">
            <Compass className="w-7 h-7 text-emerald-400 animate-pulse mb-1" />
            <div className="text-2xl sm:text-3xl font-mono font-bold tracking-tight text-white">
              {currentDistance}m
            </div>
            <div className="text-[10px] font-mono text-emerald-400 uppercase tracking-widest mt-0.5">
              BEARING 335° NW
            </div>
          </div>
        </div>

        {/* Aura's Spoken Voice Feedback Card */}
        <div className="w-full max-w-lg mt-2 p-3 sm:p-3.5 rounded-xl bg-neutral-900/90 border border-emerald-500/30 text-left shadow-lg">
          <div className="flex items-center justify-between text-[11px] font-mono font-bold mb-1.5">
            <div className="flex items-center gap-1.5 text-emerald-400">
              <Sparkles className="w-3.5 h-3.5" />
              <span>AURA (MYSTICAL GUIDE)</span>
            </div>
            <div>
              {isListening && <span className="text-rose-400 animate-pulse">LISTENING ({voiceState.silenceSecondsRemaining}s)...</span>}
              {isThinking && <span className="text-amber-400 animate-pulse">EVALUATING DISCOVERY...</span>}
              {isSpeaking && <span className="text-emerald-400 animate-pulse">SPEAKING TO EARPHONES</span>}
              {!isListening && !isThinking && !isSpeaking && <span className="text-neutral-500">READY</span>}
            </div>
          </div>
          <p className="text-xs sm:text-sm font-sans text-neutral-200 leading-snug font-medium italic">
            "{voiceState.lastSpokenText || 'Greetings explorer! I am Aura, your mystical guide. Tell me what natural treasures you discover along the path!'}"
          </p>
        </div>
      </div>

      {/* 4. One-Tap Nature Observation Chips (Hands-free / One-Finger Outdoor Play) */}
      <div className="space-y-1.5 my-2">
        <div className="flex items-center justify-between text-[10px] font-mono text-neutral-400 uppercase">
          <span>Quick Outdoor Observations:</span>
          <span>Tap to Report to Aura</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {quickObservationChips.map((chip, idx) => (
            <button
              key={idx}
              onClick={() => handleChipClick(chip, idx)}
              className={`p-2 rounded-xl border text-[11px] font-mono text-left flex items-center gap-1.5 cursor-pointer transition-all ${
                activeChipIndex === idx
                  ? 'bg-emerald-500 text-black border-emerald-400 font-bold scale-[0.98]'
                  : 'bg-neutral-900/80 hover:bg-neutral-800 text-neutral-300 border-white/10 active:scale-95'
              }`}
            >
              <span className="text-base shrink-0">{chip.icon}</span>
              <span className="truncate">{chip.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* 5. Custom Discovery Query Box */}
      <form onSubmit={handleSendCustomText} className="flex gap-1.5 my-2">
        <input
          type="text"
          value={customInputText}
          onChange={(e) => setCustomInputText(e.target.value)}
          placeholder="Describe your nature discovery to Aura..."
          className="flex-1 px-3 py-2 text-xs font-mono bg-neutral-900 border border-white/10 rounded-xl text-white placeholder-neutral-500 focus:outline-none focus:border-emerald-500"
        />
        <button
          type="submit"
          className="px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-black font-mono font-bold text-xs rounded-xl flex items-center gap-1 cursor-pointer transition-colors"
        >
          <span>Send</span>
          <Send className="w-3 h-3" />
        </button>
      </form>

      {/* 6. Primary Action Dock: Live Mic + Tactical Radar + Audio Toggle + Replay */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 pt-3 border-t border-white/10">
        {/* Large Primary Mic Button */}
        <button
          onClick={() => {
            hapticFeedback.tactileClick();
            voiceAssistantService.unlockAudioContext();
            voiceAssistantService.toggleListening({
              telemetry,
              mission: activeMission,
              explorerName,
              playerScore,
              playerInventory,
            });
          }}
          className={`w-full py-3 px-3 font-mono font-black text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-95 ${
            isListening
              ? 'bg-rose-500 text-black animate-pulse shadow-rose-900/50'
              : isSpeaking
              ? 'bg-amber-400 text-black shadow-amber-900/50'
              : 'bg-emerald-500 hover:bg-emerald-400 text-black shadow-emerald-900/50'
          }`}
        >
          {isListening ? (
            <>
              <MicOff className="w-4 h-4 shrink-0" />
              <span>LISTENING ({voiceState.silenceSecondsRemaining}s) - TAP TO SEND</span>
            </>
          ) : isSpeaking ? (
            <>
              <Headphones className="w-4 h-4 shrink-0 animate-bounce" />
              <span>AURA SPEAKING (TAP TO TALK)</span>
            </>
          ) : (
            <>
              <Mic className="w-4 h-4 shrink-0" />
              <span>TALK TO AURA (MIC 🎙️)</span>
            </>
          )}
        </button>

        {/* Ping Radar Button */}
        <button
          onClick={triggerPing}
          className="w-full py-3 px-3 bg-neutral-900 hover:bg-neutral-800 border border-white/10 active:scale-[0.98] text-emerald-400 font-mono font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <Radio className="w-4 h-4 shrink-0" />
          <span>PING RADAR</span>
        </button>

        {/* Soothing Soundscape Play/Pause */}
        <button
          onClick={toggleAmbientSound}
          className={`w-full py-3 px-3 font-mono font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 border cursor-pointer ${
            audioState.isPlaying
              ? 'bg-neutral-900 text-emerald-400 border-emerald-500/40 active:scale-[0.98]'
              : 'bg-emerald-950 text-emerald-300 border-emerald-600'
          }`}
        >
          <Music className="w-4 h-4 shrink-0" />
          <span>{audioState.isPlaying ? 'PAUSE SOUND' : 'PLAY SOUND'}</span>
        </button>

        {/* Replay Aura Voice */}
        <button
          onClick={() => {
            hapticFeedback.tactileClick();
            voiceAssistantService.replayLastMessage();
          }}
          className="w-full py-3 px-3 bg-neutral-900 hover:bg-neutral-800 border border-white/10 active:scale-[0.98] text-neutral-300 font-mono text-xs rounded-xl transition-all flex items-center justify-center gap-1.5 cursor-pointer"
        >
          <RotateCcw className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>REPLAY AURA</span>
        </button>
      </div>

      {/* Blind Haptic Notification Indicator */}
      {isRadarPinging && (
        <div className="absolute top-6 left-1/2 -translate-x-1/2 bg-emerald-500 text-black px-4 py-1.5 rounded-full text-xs font-mono font-bold tracking-wider animate-bounce shadow-md">
          HAPTIC PULSE SENT (120ms) · RADAR ACQUIRED
        </div>
      )}
    </div>
  );
};
