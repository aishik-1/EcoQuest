import React, { useState, useEffect, useRef } from 'react';
import {
  Sparkles,
  Camera,
  RefreshCw,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Square,
  CheckCircle2,
  Check,
  Smartphone,
  Flame,
  ArrowRight,
  Shield,
  Radio,
  Footprints,
  MapPin,
  Compass,
  X,
  Music,
  Headphones,
} from 'lucide-react';
import { CharacterCanvas } from './CharacterCanvas';
import { PhotoScavengerModal } from './PhotoScavengerModal';
import { StickerBookModal, StickerEntry } from './StickerBookModal';
import { ambientAudioService } from '../services/ambientAudioService';
import {
  GeneratedMission,
  generateOutdoorMission,
  getCurrentTimeOfDay,
  DailyNatureChallenge,
} from '../services/geminiMissionService';
import {
  movementTrackingService,
  MovementTelemetry,
} from '../services/movementTrackingService';
import { hapticFeedback } from '../utils/haptics';
import { TacticalGoogleMap } from './TacticalGoogleMap';
import { getCurrentGreeting } from '../utils/timeGreeting';
import { VoiceAssistantHUD } from './VoiceAssistantHUD';
import { voiceAssistantService } from '../services/voiceAssistantService';

interface MissionHUDProps {
  explorerName: string;
  isWalking: boolean;
  setIsWalking: (walking: boolean) => void;
  onOpenPocketMode: () => void;
  onBackToCharacterSelect: () => void;
  onOpenDailyChallenges?: () => void;
  onOpenStickers?: () => void;
  onOpenBioCards?: () => void;
  onOpenBlueprint?: () => void;
  unlockedStickers: StickerEntry[];
  setUnlockedStickers: React.Dispatch<React.SetStateAction<StickerEntry[]>>;
  currentLevel: number;
  setCurrentLevel: React.Dispatch<React.SetStateAction<number>>;
  totalXp: number;
  setTotalXp: React.Dispatch<React.SetStateAction<number>>;
  dailyChallenges?: DailyNatureChallenge[];
}

export const MissionHUD: React.FC<MissionHUDProps> = ({
  explorerName,
  isWalking,
  setIsWalking,
  onOpenPocketMode,
  onBackToCharacterSelect,
  onOpenDailyChallenges,
  onOpenStickers,
  onOpenBioCards,
  onOpenBlueprint,
  unlockedStickers,
  setUnlockedStickers,
  currentLevel,
  setCurrentLevel,
  totalXp,
  setTotalXp,
  dailyChallenges = [],
}) => {
  // Modals
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isStickerBookModalOpen, setIsStickerBookModalOpen] = useState(false);

  // Active found nature items for current quest (synced with Aura voice memory)
  const [foundItems, setFoundItems] = useState<string[]>(() => voiceAssistantService.getFoundItems());

  // Time-aware welcome greeting calculation based on actual local time
  const [timeGreeting, setTimeGreeting] = useState(() => getCurrentGreeting());

  useEffect(() => {
    const timer = setInterval(() => {
      setTimeGreeting(getCurrentGreeting());
    }, 15000);
    return () => clearInterval(timer);
  }, []);

  // Compact Ambient Audio State
  const [audioState, setAudioState] = useState(ambientAudioService.getState());

  useEffect(() => {
    const unsubAudio = ambientAudioService.subscribe((s) => setAudioState(s));
    ambientAudioService.start();
    return () => unsubAudio();
  }, []);

  // Movement Telemetry
  const [telemetry, setTelemetry] = useState<MovementTelemetry>(
    movementTrackingService.getTelemetry()
  );

  useEffect(() => {
    const unsub = movementTrackingService.subscribe((t) => {
      setTelemetry(t);
      setIsWalking(t.state === 'MOVING');
    });
    return () => unsub();
  }, [setIsWalking]);

  // Active Outdoor Mission
  const [activeMission, setActiveMission] = useState<GeneratedMission>({
    id: 'mission-dragon-default',
    title: 'The Forest Leaf Dragon',
    objective: 'Gather natural items and craft a miniature dragon on the soil.',
    audioScript:
      'Scan the ground around your feet. Find two broad fallen leaves, a sturdy twig, and two smooth pebbles. Assemble a forest dragon on the earth, then snap a photo for your Field Codex!',
    biome: 'Redwood & Oak Woodland',
    timeOfDay: 'Afternoon',
    scavengerItems: [
      '2x Broad Leaves (Wings)',
      '1x Curved Twig (Spine)',
      '2x River Pebbles (Eyes)',
    ],
    craftInstructions:
      'Lay the curved twig flat as the dragon spine. Place the two broad leaves on either side as wings. Crown the top with two pebbles as dragon eyes!',
    targetLandmark: 'Ancient Canopy Clearing',
    targetDistanceMeters: 180,
    targetBearingDegrees: 335,
    rewardXp: 350,
    stickerReward: {
      id: 'stk-dragon',
      name: 'Verdant Leaf Dragon',
      rarity: 'Mythic',
      badgeEmoji: '🐉',
      lore: 'A gentle woodland guardian crafted on the soil from autumn leaves and river pebbles.',
    },
  });

  const [isGeneratingMission, setIsGeneratingMission] = useState(false);
  const [isExpeditionStarted, setIsExpeditionStarted] = useState(true);

  const handleToggleExpedition = (forceStart?: boolean) => {
    hapticFeedback.startPlaying();
    const shouldStart = forceStart !== undefined ? forceStart : !isExpeditionStarted;
    movementTrackingService.setExpeditionActive(shouldStart);
    setIsExpeditionStarted(shouldStart);
    if (shouldStart) {
      ambientAudioService.start();
    }
  };

  const handleStartMissionPhoneMode = async () => {
    hapticFeedback.startPlaying();
    handleToggleExpedition(true);
    voiceAssistantService.startMissionWithAura(activeMission, explorerName);
    onOpenPocketMode();
  };

  const handleGenerateGeminiMission = async () => {
    setIsGeneratingMission(true);
    try {
      hapticFeedback.buttonPress();
      const newMission = await generateOutdoorMission({
        biome: activeMission.biome,
        timeOfDay: getCurrentTimeOfDay(),
        difficulty: 'Adventurer',
      });
      setActiveMission(newMission);
      voiceAssistantService.clearFoundItems();
      setFoundItems([]);
      voiceAssistantService.announceExpeditionStart(newMission, explorerName);
    } catch (err) {
      console.error(err);
    } finally {
      setIsGeneratingMission(false);
    }
  };

  const handleToggleItemFound = (item: string) => {
    hapticFeedback.tactileClick();
    const isCurrentlyFound = foundItems.includes(item);
    let next: string[];
    if (isCurrentlyFound) {
      next = foundItems.filter((i) => i !== item);
    } else {
      next = [...foundItems, item];
      setTotalXp((prev) => prev + 50);
    }
    setFoundItems(next);
    voiceAssistantService.setFoundItems(next);

    // If all items are now found, open the picture box!
    if (!isCurrentlyFound && activeMission.scavengerItems.every((si) => next.includes(si))) {
      hapticFeedback.missionCompleted();
      setTimeout(() => {
        setIsPhotoModalOpen(true);
      }, 700);
    }
  };

  const handleVoiceAction = (action: string, payload?: any) => {
    if (action === 'SHOW_LOCATION') {
      hapticFeedback.radarPulse();
      const mapElem = document.getElementById('tactical-google-map');
      if (mapElem) {
        mapElem.scrollIntoView({ behavior: 'smooth' });
      }
    } else if (action === 'RECORD_FOUND_ITEM') {
      hapticFeedback.tactileClick();
      const current = voiceAssistantService.getFoundItems();
      setFoundItems(current);
      if (payload?.pointsAwarded) {
        setTotalXp((xp) => xp + payload.pointsAwarded);
      }
      if (payload?.allItemsFound || activeMission.scavengerItems.every((si) => current.includes(si))) {
        hapticFeedback.missionCompleted();
        setTimeout(() => {
          setIsPhotoModalOpen(true);
        }, 800);
      }
    } else if (action === 'OPEN_PHOTO_CAMERA' || action === 'COMPLETE_TASK') {
      hapticFeedback.buttonPress();
      const current = voiceAssistantService.getFoundItems();
      setFoundItems(current);
      setIsPhotoModalOpen(true);
    } else if (action === 'NEXT_TASK') {
      handleGenerateGeminiMission();
    } else if (action === 'POCKET_MODE') {
      onOpenPocketMode();
    } else if (action === 'AWARD_POINTS' && payload?.points) {
      setTotalXp((xp) => xp + payload.points);
    }
  };

  const handleMissionCompleted = (photoDataUrl: string) => {
    hapticFeedback.missionCompleted();
    setIsPhotoModalOpen(false);
    setTotalXp((prev) => prev + activeMission.rewardXp);
    setCurrentLevel((prev) => Math.min(prev + 1, 7));

    // Announce craft verification through voice assistant!
    voiceAssistantService.announceCraftVerified(
      activeMission.stickerReward.name,
      activeMission.rewardXp
    );

    const newSticker: StickerEntry = {
      id: `stk-${Date.now()}`,
      name: activeMission.stickerReward.name,
      badgeEmoji: activeMission.stickerReward.badgeEmoji,
      rarity: activeMission.stickerReward.rarity,
      category: 'craft',
      biome: activeMission.biome,
      dateUnlocked: 'Just Now',
      lore: activeMission.stickerReward.lore,
      ingredients: activeMission.scavengerItems,
      photoUrl: photoDataUrl,
      xpEarned: activeMission.rewardXp,
    };

    setUnlockedStickers((prev) => [newSticker, ...prev]);
    if (onOpenStickers) {
      onOpenStickers();
    } else {
      setIsStickerBookModalOpen(true);
    }
  };

  const missionWaypoints = React.useMemo(() => [
    {
      id: 'wp-craft-objective',
      name: activeMission.targetLandmark || 'Dragon Crafting Clearing',
      category: 'Botanical' as const,
      description: activeMission.craftInstructions || activeMission.objective,
      audioPrompt: 'Collect your craft items and assemble on the ground.',
      lat: (telemetry.latitude || 37.7749) + 0.0005,
      lng: (telemetry.longitude || -122.4194) + 0.0006,
      icon: '🍃',
      completed: false,
      distanceMeters: activeMission.targetDistanceMeters || 120,
    },
    {
      id: 'wp-geo-pebbles',
      name: 'River Pebble Deposit',
      category: 'Geo' as const,
      description: 'Search near gravel or dry dirt path for smooth dragon eye pebbles.',
      audioPrompt: 'Collect two smooth pebbles for the dragon eyes.',
      lat: (telemetry.latitude || 37.7749) - 0.0004,
      lng: (telemetry.longitude || -122.4194) + 0.0005,
      icon: '🪨',
      completed: false,
      distanceMeters: 65,
    },
  ], [telemetry.latitude, telemetry.longitude, activeMission]);

  return (
    <div className="relative z-10 w-full max-w-6xl mx-auto px-3 sm:px-6 lg:px-8 py-3 sm:py-6 space-y-4 sm:space-y-6 select-none font-['Plus_Jakarta_Sans',sans-serif]">
      {/* =========================================================================
          1. TIME-OF-DAY WELCOME BANNER (PROMINENT GREETING)
          ========================================================================= */}
      <div className="p-3.5 sm:p-5 rounded-2xl sm:rounded-3xl bg-stone-100/95 border border-stone-300/80 shadow-[0_4px_0_0_#d6d3d1] flex flex-wrap items-center justify-between gap-3 sm:gap-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-emerald-800 uppercase tracking-wider">
            <span>{timeGreeting.emoji}</span>
            <span>{timeGreeting.periodLabel}</span>
            <span className="text-stone-400">·</span>
            <span className="text-stone-600 font-mono">{timeGreeting.clockTime}</span>
          </div>
          <h1 className="text-lg sm:text-2xl lg:text-3xl font-display font-extrabold text-stone-900 tracking-tight leading-tight">
            {timeGreeting.salutation},{' '}
            <span className="text-emerald-800 underline decoration-emerald-500/60 decoration-2 underline-offset-4">
              {explorerName.trim() ? explorerName : 'Explorer'}
            </span>
            !
          </h1>
          <p className="text-xs sm:text-sm font-mono text-stone-600 max-w-xl">
            {timeGreeting.subTitle}
          </p>
        </div>

        {/* Compact Right Dock: Progress + Character + Audio Control */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 shrink-0 flex-wrap justify-end">
          {/* Back to Character Window Button */}
          <button
            onClick={() => {
              hapticFeedback.tactileClick();
              onBackToCharacterSelect();
            }}
            title="Inspect 3D Explorer & Loadout"
            className="px-2 sm:px-2.5 py-1.5 rounded-xl bg-stone-200/90 hover:bg-stone-300 text-stone-800 font-mono text-xs font-bold border border-stone-300 shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Compass className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[11px] sm:text-xs">CHARACTER</span>
          </button>

          {/* Level & XP Capsule */}
          <div className="px-2 sm:px-2.5 py-1.5 rounded-xl bg-stone-200/90 border border-stone-300 font-mono text-xs flex items-center gap-1 sm:gap-1.5 text-stone-800 shadow-xs">
            <span className="font-bold">Stage {currentLevel}/7</span>
            <span className="text-stone-400">·</span>
            <span className="font-bold text-emerald-800 tabular-nums">{totalXp} XP</span>
          </div>

          {/* Minimal Discreet Ambient Audio Toggle */}
          <button
            onClick={() => {
              hapticFeedback.tactileClick();
              ambientAudioService.togglePlay();
            }}
            title={audioState.isPlaying ? 'Mute ambient sound' : 'Play soothing ambient sound'}
            className="w-8 h-8 rounded-xl bg-stone-200/90 hover:bg-stone-300 active:bg-stone-400 text-stone-700 border border-stone-300 shadow-xs flex items-center justify-center cursor-pointer transition-colors"
          >
            {audioState.isPlaying && !audioState.isMuted ? (
              <Volume2 className="w-3.5 h-3.5 text-emerald-700" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-stone-400" />
            )}
          </button>

          {/* Pocket Mode Actuator */}
          <button
            onClick={onOpenPocketMode}
            className="px-2.5 sm:px-3 py-1.5 rounded-xl bg-stone-200/90 hover:bg-stone-300 text-stone-800 font-mono text-xs font-bold border border-stone-300/80 shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <Smartphone className="w-3.5 h-3.5 text-emerald-600" />
            <span className="text-[11px] sm:text-xs">PHONE MODE</span>
          </button>
        </div>
      </div>

      {/* =========================================================================
          2. AURA · MYSTICAL, WITTY, & HIGHLY INTELLIGENT COMPANION (ECOQUEST GO)
          Leads the expedition with autonomous reasoning, voice TTS & voice commands
          ========================================================================= */}
      <VoiceAssistantHUD
        telemetry={telemetry}
        mission={activeMission}
        activeWaypoint={missionWaypoints[0] || null}
        explorerName={explorerName}
        playerScore={totalXp}
        playerInventory={unlockedStickers.map((s) => s.name)}
        foundItems={foundItems}
        onToggleItemFound={handleToggleItemFound}
        onActionTriggered={handleVoiceAction}
      />

      {/* =========================================================================
          3. CORE MISSION EXPEDITION DECK: 3D CHARACTER + TACTICAL GOOGLE MAP
          Both the 3D Character and Tactical Map are cleanly presented!
          ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6 items-stretch">
        {/* Left Deck: 3D Character Viewport */}
        <div className="flex flex-col rounded-3xl overflow-hidden bg-stone-100/95 border border-stone-300/80 shadow-[0_4px_0_0_#d6d3d1]">
          {/* Card Header */}
          <div className="flex items-center justify-between px-3.5 sm:px-4 py-3 border-b border-stone-300/70 bg-stone-200/60">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-600 animate-pulse" />
              <h3 className="font-display font-extrabold text-sm sm:text-base text-stone-900 tracking-tight">
                3D Human Explorer Avatar
              </h3>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono">
              <span className="px-2.5 py-0.5 rounded-md bg-stone-300/90 font-bold text-stone-800">
                {isWalking ? '🏃 WALKING' : '🛑 STATIONARY'}
              </span>
            </div>
          </div>

          {/* 3D WebGL Canvas */}
          <div className="relative w-full flex-1 min-h-[300px] sm:min-h-[380px] bg-stone-200/40">
            <CharacterCanvas
              gender="male"
              isWalking={isWalking}
              gamePage="playing"
            />
          </div>

          {/* Card Footer */}
          <div className="p-3 bg-stone-200/50 border-t border-stone-300/70 flex items-center justify-between text-xs font-mono">
            <div className="text-stone-700 flex items-center gap-1.5 truncate font-medium">
              <span>Nicolás Martins · Codename: {explorerName || 'Ranger'}</span>
            </div>
            <button
              onClick={onBackToCharacterSelect}
              className="text-emerald-800 hover:text-emerald-950 font-bold underline cursor-pointer shrink-0 ml-2"
            >
              Customizer ↗
            </button>
          </div>
        </div>

        {/* Right Deck: Tactical Google Map */}
        <div id="tactical-google-map" className="flex flex-col">
          <TacticalGoogleMap
            telemetry={telemetry}
            waypoints={missionWaypoints}
            explorerName={explorerName}
          />
        </div>
      </div>

      {/* =========================================================================
          3. CURRENT EXPEDITION MISSION TASK (PHYSICAL CRAFTING CARD)
          ========================================================================= */}
      <section className="p-4 sm:p-6 rounded-3xl bg-stone-100/95 border border-stone-300/80 shadow-[0_4px_0_0_#d6d3d1] space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-stone-300/80">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 sm:w-10 sm:h-10 rounded-2xl bg-stone-900 text-emerald-400 flex items-center justify-center font-bold text-lg shadow-sm">
              🎯
            </div>
            <div>
              <span className="text-[10px] font-mono font-bold uppercase text-emerald-800 tracking-wider">
                CURRENT EXPEDITION OBJECTIVE
              </span>
              <h2 className="text-lg sm:text-2xl font-display font-extrabold text-stone-900 tracking-tight leading-tight">
                {activeMission.title}
              </h2>
            </div>
          </div>

          <button
            onClick={handleGenerateGeminiMission}
            disabled={isGeneratingMission}
            className="px-3 py-1.5 rounded-xl bg-stone-200/90 hover:bg-stone-300 text-stone-800 font-mono text-xs font-bold border border-stone-300 shadow-xs flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-stone-600 ${isGeneratingMission ? 'animate-spin' : ''}`} />
            <span>{isGeneratingMission ? 'Generating...' : 'New Mission'}</span>
          </button>
        </div>

        {/* Objective */}
        <p className="text-xs sm:text-sm font-mono text-stone-800 font-medium leading-relaxed bg-stone-200/70 p-3 sm:p-3.5 rounded-2xl border border-stone-300/70">
          {activeMission.objective}
        </p>

        {/* Scavenger items grid with interactive collection and Aura memory sync */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[11px] font-mono">
            <span className="text-stone-500 uppercase font-bold tracking-wider">
              Nature Ingredients to Collect ({foundItems.length}/{activeMission.scavengerItems.length} Found):
            </span>
            <span className="text-emerald-700 font-semibold">
              {activeMission.scavengerItems.every((si) => foundItems.includes(si))
                ? '✨ All Specimens Ready!'
                : 'Tap to check or tell Aura'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            {activeMission.scavengerItems.map((item, idx) => {
              const isFound = foundItems.includes(item);
              return (
                <button
                  key={idx}
                  onClick={() => handleToggleItemFound(item)}
                  className={`p-3 rounded-2xl border text-left transition-all cursor-pointer flex items-center justify-between gap-2.5 active:scale-98 ${
                    isFound
                      ? 'bg-emerald-900/15 border-emerald-600/80 text-emerald-950 shadow-xs'
                      : 'bg-stone-200/90 hover:bg-stone-300 border-stone-300 text-stone-800'
                  }`}
                  title={isFound ? 'Collected! Click to uncheck' : 'Click to mark as found or say "I found it" to Aura'}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className={`w-5 h-5 rounded-full flex items-center justify-center shrink-0 border transition-colors ${
                        isFound
                          ? 'bg-emerald-600 text-white border-emerald-700'
                          : 'bg-stone-100 text-transparent border-stone-400'
                      }`}
                    >
                      <Check className="w-3.5 h-3.5" />
                    </div>
                    <span className={`text-xs font-mono font-medium truncate ${isFound ? 'line-through text-emerald-900/80 font-bold' : ''}`}>
                      {item}
                    </span>
                  </div>
                  {isFound ? (
                    <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-md bg-emerald-700/20 text-emerald-800 shrink-0">
                      +50 XP
                    </span>
                  ) : (
                    <span className="text-[9px] font-mono text-stone-400 shrink-0">
                      SEARCHING
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* All Items Found Celebration Banner & Direct Camera Actuator */}
          {activeMission.scavengerItems.length > 0 &&
            activeMission.scavengerItems.every((si) => foundItems.includes(si)) && (
              <div className="p-3.5 sm:p-4 rounded-2xl bg-gradient-to-r from-emerald-800 via-teal-800 to-emerald-900 text-stone-50 border border-emerald-600/60 shadow-lg flex flex-wrap items-center justify-between gap-3 animate-in fade-in zoom-in-95 duration-200">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-2 text-xs font-mono font-bold text-emerald-300 uppercase">
                    <span>🎉 ALL SPECIMENS COLLECTED!</span>
                  </div>
                  <p className="text-xs sm:text-sm font-sans font-medium text-emerald-100">
                    Aura recorded all items! Arrange them on the ground and click the picture box to snap your craft photo.
                  </p>
                </div>
                <button
                  onClick={() => {
                    hapticFeedback.buttonPress();
                    setIsPhotoModalOpen(true);
                  }}
                  className="py-2.5 px-4 rounded-xl font-mono text-xs font-bold uppercase tracking-wider bg-emerald-400 hover:bg-emerald-300 text-stone-950 shadow-md cursor-pointer flex items-center gap-2 active:scale-95 transition-all"
                >
                  <Camera className="w-4 h-4 text-stone-950" />
                  <span>OPEN PICTURE BOX 📸</span>
                </button>
              </div>
            )}
        </div>

        {/* Reward & Craft Photo Buttons */}
        <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs font-mono font-bold text-stone-800 bg-stone-200/80 px-3 py-2 rounded-xl border border-stone-300">
            <span className="text-base">{activeMission.stickerReward.badgeEmoji}</span>
            <span>+{activeMission.rewardXp} XP · {activeMission.stickerReward.name}</span>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {/* Primary Action: Start Mission in Phone Mode */}
            <button
              onClick={handleStartMissionPhoneMode}
              className="py-3 px-4 sm:px-6 rounded-2xl font-mono text-xs sm:text-sm font-black uppercase tracking-wider bg-emerald-600 hover:bg-emerald-500 text-stone-950 border-t border-emerald-300 shadow-[0_4px_0_0_#065f46] active:shadow-none active:translate-y-1 transition-all flex items-center gap-2 cursor-pointer shadow-lg"
            >
              <Smartphone className="w-4 h-4 sm:w-5 sm:h-5 text-stone-950 shrink-0" />
              <Headphones className="w-4 h-4 sm:w-5 sm:h-5 text-stone-950 shrink-0" />
              <span>START MISSION (PHONE MODE 📱)</span>
            </button>

            <button
              onClick={() => {
                hapticFeedback.buttonPress();
                setIsPhotoModalOpen(true);
              }}
              className="py-3 px-4 sm:px-5 rounded-2xl font-mono text-xs font-bold uppercase tracking-wider bg-stone-900 hover:bg-stone-800 text-stone-50 border-t border-stone-600 shadow-[0_4px_0_0_#0c0a09] active:shadow-none active:translate-y-1 transition-all flex items-center gap-2 cursor-pointer"
            >
              <Camera className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>CRAFT & SNAP PHOTO</span>
            </button>
          </div>
        </div>
      </section>

      {/* Modals */}
      {isPhotoModalOpen && (
        <PhotoScavengerModal
          mission={activeMission}
          foundItems={foundItems}
          onClose={() => setIsPhotoModalOpen(false)}
          onMissionCompleted={handleMissionCompleted}
        />
      )}

      {isStickerBookModalOpen && (
        <StickerBookModal
          onClose={() => setIsStickerBookModalOpen(false)}
          unlockedStickers={unlockedStickers}
        />
      )}
    </div>
  );
};
