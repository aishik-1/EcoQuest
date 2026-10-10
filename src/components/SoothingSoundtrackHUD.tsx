import React, { useEffect, useState } from 'react';
import {
  Volume2,
  VolumeX,
  Music,
  Sliders,
  Play,
  Pause,
  SkipForward,
  SkipBack,
  Sparkles,
  ListMusic,
  X,
} from 'lucide-react';
import {
  ambientAudioService,
  SOUNDTRACK_PLAYLIST,
  SoundtrackTrack,
} from '../services/ambientAudioService';
import { hapticFeedback } from '../utils/haptics';

interface SoothingSoundtrackHUDProps {
  className?: string;
}

export const SoothingSoundtrackHUD: React.FC<SoothingSoundtrackHUDProps> = ({
  className = '',
}) => {
  const [audioState, setAudioState] = useState(ambientAudioService.getState());
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const unsub = ambientAudioService.subscribe((s) => setAudioState(s));
    return () => unsub();
  }, []);

  const handleTogglePlay = () => {
    hapticFeedback.tactileClick();
    ambientAudioService.togglePlay();
  };

  const handleToggleMute = () => {
    hapticFeedback.tactileClick();
    ambientAudioService.toggleMute();
  };

  const handleNext = () => {
    hapticFeedback.tactileClick();
    ambientAudioService.nextTrack();
  };

  const handlePrev = () => {
    hapticFeedback.tactileClick();
    ambientAudioService.prevTrack();
  };

  const handleSelectTrack = (index: number) => {
    hapticFeedback.tactileClick();
    ambientAudioService.selectTrack(index);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const vol = parseFloat(e.target.value);
    ambientAudioService.setVolume(vol);
  };

  return (
    <div className={`relative ${className}`}>
      {/* Mobile Compact Capsule (< md) */}
      <div className="flex md:hidden items-center gap-1.5 bg-stone-900/95 text-stone-100 backdrop-blur-md px-2 py-1.5 rounded-xl border border-stone-700/60 shadow-xs text-xs font-mono">
        <button
          onClick={handleTogglePlay}
          title={audioState.isPlaying ? 'Pause Music' : 'Play Music'}
          className="w-7 h-7 rounded-lg bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 transition-colors cursor-pointer flex items-center justify-center shrink-0"
        >
          {audioState.isPlaying ? (
            <Pause className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5 ml-0.5" />
          )}
        </button>

        <button
          onClick={() => {
            hapticFeedback.tactileClick();
            setIsOpen(!isOpen);
          }}
          title="Soundtrack Playlist & Volume"
          className={`px-1.5 py-1 rounded-lg transition-colors cursor-pointer flex items-center gap-1 ${
            isOpen ? 'bg-emerald-500/20 text-emerald-300' : 'text-stone-300 hover:text-white'
          }`}
        >
          {audioState.isMuted || audioState.volume === 0 ? (
            <VolumeX className="w-3.5 h-3.5 text-stone-500" />
          ) : (
            <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
          )}
          <ListMusic className="w-3 h-3 text-stone-400" />
        </button>
      </div>

      {/* Desktop Full Capsule (md and up) */}
      <div className="hidden md:flex items-center gap-1.5 sm:gap-2 bg-stone-900/95 text-stone-100 backdrop-blur-md px-2.5 sm:px-3 py-1.5 rounded-full border border-stone-700/60 shadow-lg text-xs font-mono">
        {/* Play/Pause Button */}
        <button
          onClick={handleTogglePlay}
          title={audioState.isPlaying ? 'Pause Music' : 'Play Music'}
          className="p-1 rounded-full bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 transition-colors cursor-pointer"
        >
          {audioState.isPlaying ? (
            <Pause className="w-3.5 h-3.5" />
          ) : (
            <Play className="w-3.5 h-3.5 ml-0.5" />
          )}
        </button>

        {/* Previous Track */}
        <button
          onClick={handlePrev}
          title="Previous Track"
          className="p-0.5 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer hidden xs:inline"
        >
          <SkipBack className="w-3 h-3" />
        </button>

        {/* Next Track */}
        <button
          onClick={handleNext}
          title="Next Track"
          className="p-0.5 text-stone-400 hover:text-stone-200 transition-colors cursor-pointer hidden xs:inline"
        >
          <SkipForward className="w-3 h-3" />
        </button>

        {/* Live Audio Waves */}
        <div className="flex items-center gap-0.5 h-3.5 px-0.5">
          {[40, 75, 100, 60, 30].map((h, i) => (
            <span
              key={i}
              className={`w-0.5 rounded-full transition-all duration-300 ${
                audioState.isPlaying && !audioState.isMuted
                  ? 'bg-emerald-400 animate-pulse'
                  : 'bg-stone-600 h-1'
              }`}
              style={{
                height:
                  audioState.isPlaying && !audioState.isMuted
                    ? `${Math.max(4, (h * audioState.volume) / 6)}px`
                    : '3px',
                animationDelay: `${i * 120}ms`,
              }}
            />
          ))}
        </div>

        {/* Current Track Info */}
        <div
          onClick={() => {
            hapticFeedback.tactileClick();
            setIsOpen(!isOpen);
          }}
          className="cursor-pointer flex items-center gap-1.5 hover:text-emerald-300 transition-colors"
          title="Click to view playlist"
        >
          <span className="text-[11px] font-bold text-stone-200 max-w-[110px] sm:max-w-[140px] truncate">
            {audioState.currentTrack.title}
          </span>
          <span className="text-[10px] text-stone-400 hidden lg:inline">
            ({audioState.currentTrack.mood})
          </span>
        </div>

        {/* Mute Toggle */}
        <button
          onClick={handleToggleMute}
          title={audioState.isMuted ? 'Unmute' : 'Mute'}
          className="p-1 hover:text-emerald-300 text-stone-400 transition-colors cursor-pointer"
        >
          {audioState.isMuted || audioState.volume === 0 ? (
            <VolumeX className="w-3.5 h-3.5 text-stone-500" />
          ) : (
            <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
          )}
        </button>

        {/* Open Playlist / Drawer */}
        <button
          onClick={() => {
            hapticFeedback.tactileClick();
            setIsOpen(!isOpen);
          }}
          title="Soundtrack Playlist"
          className={`p-1 rounded transition-colors cursor-pointer ${
            isOpen ? 'text-emerald-300 bg-stone-800' : 'text-stone-400 hover:text-stone-200'
          }`}
        >
          <ListMusic className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Backdrop for outside click dismissal on both mobile and desktop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px] md:bg-transparent"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Expanded Playlist & Volume Popover (Properly centered & aligned on mobile, anchored on desktop) */}
      {isOpen && (
        <div className="fixed top-16 left-3 right-3 max-w-[340px] mx-auto md:absolute md:top-full md:mt-2 md:right-0 md:left-auto md:w-80 p-3.5 sm:p-4 bg-stone-900/98 backdrop-blur-xl rounded-2xl border border-stone-700/80 shadow-2xl text-stone-100 text-xs font-mono z-50 animate-in fade-in zoom-in-95 duration-150">
          {/* Header Bar */}
          <div className="flex items-center justify-between pb-2.5 mb-3 border-b border-stone-800">
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded-lg bg-emerald-500/20 text-emerald-400 flex items-center justify-center">
                <Music className="w-3.5 h-3.5" />
              </div>
              <div>
                <div className="text-[11px] font-bold text-stone-200 tracking-wide uppercase">
                  SOUNDTRACK PLAYLIST
                </div>
                <div className="text-[9px] text-emerald-400 font-semibold">
                  ● HIGH FIDELITY STEREO
                </div>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1.5 rounded-lg bg-stone-800/80 hover:bg-stone-700 text-stone-400 hover:text-white transition-colors cursor-pointer"
              title="Close Playlist"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Quick Playback Bar inside popover (Essential on mobile!) */}
          <div className="p-2.5 mb-3 bg-stone-800/70 rounded-xl border border-stone-700/50 flex items-center justify-between">
            <div className="min-w-0 pr-2">
              <div className="text-[10px] text-stone-400 uppercase font-semibold">NOW PLAYING</div>
              <div className="text-[11px] font-bold text-emerald-300 truncate">
                {audioState.currentTrack.title}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              <button
                onClick={handlePrev}
                title="Previous Track"
                className="p-1 rounded-lg hover:bg-stone-700 text-stone-300 hover:text-white transition-colors cursor-pointer"
              >
                <SkipBack className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={handleTogglePlay}
                title={audioState.isPlaying ? 'Pause' : 'Play'}
                className="w-7 h-7 rounded-lg bg-emerald-500 text-stone-950 font-bold flex items-center justify-center shadow-xs transition-transform active:scale-95 cursor-pointer"
              >
                {audioState.isPlaying ? (
                  <Pause className="w-3.5 h-3.5" />
                ) : (
                  <Play className="w-3.5 h-3.5 ml-0.5" />
                )}
              </button>
              <button
                onClick={handleNext}
                title="Next Track"
                className="p-1 rounded-lg hover:bg-stone-700 text-stone-300 hover:text-white transition-colors cursor-pointer"
              >
                <SkipForward className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Track Selection List */}
          <div className="space-y-1.5 mb-3">
            {SOUNDTRACK_PLAYLIST.map((track, idx) => {
              const isCurrent = audioState.currentTrackIndex === idx;
              return (
                <button
                  key={track.id}
                  onClick={() => handleSelectTrack(idx)}
                  className={`w-full p-2.5 rounded-xl text-left transition-all flex items-center gap-2.5 cursor-pointer border ${
                    isCurrent
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40 shadow-xs'
                      : 'bg-stone-800/60 hover:bg-stone-800 text-stone-300 border-stone-800 hover:border-stone-700'
                  }`}
                >
                  {/* Track Status / Index Column (Guarantees perfect vertical alignment) */}
                  <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 bg-stone-900/60 text-[10px] font-mono">
                    {isCurrent && audioState.isPlaying ? (
                      <span className="flex items-center gap-0.5 h-3">
                        <span className="w-0.5 h-3 bg-emerald-400 animate-pulse" />
                        <span className="w-0.5 h-2 bg-emerald-400 animate-pulse delay-75" />
                        <span className="w-0.5 h-2.5 bg-emerald-400 animate-pulse delay-150" />
                      </span>
                    ) : isCurrent ? (
                      <span className="text-emerald-400 font-bold">▶</span>
                    ) : (
                      <span className="text-stone-500 font-bold">{idx + 1}</span>
                    )}
                  </div>

                  {/* Title and Artist Info */}
                  <div className="flex-1 min-w-0 pr-1">
                    <div className="font-bold text-[11px] truncate leading-tight">
                      {track.title}
                    </div>
                    <div className="text-[10px] text-stone-400 truncate mt-0.5">
                      {track.artist}
                    </div>
                  </div>

                  {/* Mood Tag */}
                  <span
                    className={`px-2 py-0.5 rounded-md text-[9px] font-mono shrink-0 font-medium ${
                      isCurrent
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                        : 'bg-stone-800 text-stone-400'
                    }`}
                  >
                    {track.mood.split(' ')[0]}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Master Volume Slider with Interactive Mute Icon */}
          <div className="pt-2.5 border-t border-stone-800 space-y-2">
            <div className="flex items-center justify-between text-[11px] text-stone-300 font-semibold">
              <span className="flex items-center gap-1.5 text-stone-400">
                <Sliders className="w-3 h-3 text-emerald-400" />
                <span>Volume</span>
              </span>
              <span className="font-mono text-emerald-400 font-bold">
                {audioState.isMuted ? 'MUTED' : `${Math.round(audioState.volume * 100)}%`}
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <button
                onClick={handleToggleMute}
                title={audioState.isMuted ? 'Unmute' : 'Mute'}
                className="p-1 rounded-lg hover:bg-stone-800 text-stone-400 hover:text-white transition-colors cursor-pointer shrink-0"
              >
                {audioState.isMuted || audioState.volume === 0 ? (
                  <VolumeX className="w-4 h-4 text-stone-500" />
                ) : (
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                )}
              </button>

              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={audioState.isMuted ? 0 : audioState.volume}
                onChange={handleVolumeChange}
                className="flex-1 h-2 bg-stone-700/80 rounded-lg appearance-none cursor-pointer accent-emerald-400"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
