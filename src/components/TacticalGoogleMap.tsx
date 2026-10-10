import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  APIProvider,
  Map,
  AdvancedMarker,
  Pin,
  InfoWindow,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  Compass,
  Footprints,
  Navigation,
  Layers,
  LocateFixed,
  Radio,
  RotateCw,
  RotateCcw,
  Smartphone,
  Crosshair,
} from 'lucide-react';
import { LocalityWaypoint } from '../types';
import { MovementTelemetry, movementTrackingService } from '../services/movementTrackingService';
import { hapticFeedback } from '../utils/haptics';

interface TacticalGoogleMapProps {
  telemetry: MovementTelemetry;
  waypoints?: LocalityWaypoint[];
  activeWaypoint?: LocalityWaypoint | null;
  onSelectWaypoint?: (wp: LocalityWaypoint) => void;
  explorerName: string;
}

function getCardinalDirection(deg: number): string {
  const directions = [
    'N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW',
  ];
  const idx = Math.round(((deg % 360 + 360) % 360) / 22.5) % 16;
  return directions[idx];
}

/**
 * Inner controller that hooks into Google Maps instance for smooth auto-follow,
 * user drag detection, and live breadcrumb polyline rendering
 */
const MapCameraController: React.FC<{
  latitude: number;
  longitude: number;
  heading: number;
  followUser: boolean;
  orientWithCompass: boolean;
  breadcrumbs?: Array<{ lat: number; lng: number }>;
  onUserPanned: () => void;
}> = ({
  latitude,
  longitude,
  heading,
  followUser,
  orientWithCompass,
  breadcrumbs = [],
  onUserPanned,
}) => {
  const map = useMap();
  const polylineRef = useRef<any>(null);

  // Detect when user pans/zooms manually to detach auto-follow
  useEffect(() => {
    if (!map) return;
    const dragListener = map.addListener('dragstart', () => {
      onUserPanned();
    });
    return () => {
      const gMaps = (window as any).google?.maps;
      if (gMaps?.event) {
        gMaps.event.removeListener(dragListener);
      }
    };
  }, [map, onUserPanned]);

  // Smoothly glide map center when follow mode is active
  useEffect(() => {
    if (!map || !followUser) return;
    map.panTo({ lat: latitude, lng: longitude });
  }, [map, latitude, longitude, followUser]);

  // Synchronize camera heading if 360° Heads-Up view is enabled
  useEffect(() => {
    if (!map) return;
    if (orientWithCompass && typeof (map as any).setHeading === 'function') {
      try {
        (map as any).setHeading(heading);
      } catch (_) {}
    }
  }, [map, heading, orientWithCompass]);

  // Render breadcrumbs path onto Google Maps
  useEffect(() => {
    const gMaps = (window as any).google?.maps;
    if (!map || !gMaps?.Polyline) return;

    if (!polylineRef.current) {
      polylineRef.current = new gMaps.Polyline({
        path: breadcrumbs,
        geodesic: true,
        strokeColor: '#10b981',
        strokeOpacity: 0.85,
        strokeWeight: 4,
        map: map,
      });
    } else {
      polylineRef.current.setPath(breadcrumbs);
    }

    return () => {
      if (polylineRef.current) {
        polylineRef.current.setMap(null);
        polylineRef.current = null;
      }
    };
  }, [map, breadcrumbs]);

  return null;
};

export const TacticalGoogleMap: React.FC<TacticalGoogleMapProps> = ({
  telemetry,
  waypoints = [],
  activeWaypoint = null,
  onSelectWaypoint,
  explorerName,
}) => {
  const apiKey =
    (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string) ||
    'AIzaSyCouOCwfceINtENkyw7zhGkCFTkAtJs79k';

  const [selectedPinWaypoint, setSelectedPinWaypoint] = useState<LocalityWaypoint | null>(null);
  const [mapType, setMapType] = useState<'hybrid' | 'satellite' | 'roadmap' | 'terrain'>('hybrid');
  const [clickToWalkMode, setClickToWalkMode] = useState<boolean>(true);
  const [simSpeed, setSimSpeedPreset] = useState<number>(1.4);
  const [followScout, setFollowScout] = useState<boolean>(true);
  const [orientWithCompass, setOrientWithCompass] = useState<boolean>(false);
  const [showJoystick, setShowJoystick] = useState<boolean>(true);
  const [showControlsDrawer, setShowControlsDrawer] = useState<boolean>(false);
  const [needsSensorPermission, setNeedsSensorPermission] = useState<boolean>(false);

  // Virtual Joystick dragging state
  const joystickBaseRef = useRef<HTMLDivElement>(null);
  const [joystickKnobPos, setJoystickKnobPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isJoystickActive, setIsJoystickActive] = useState<boolean>(false);

  // Check iOS permission readiness on mount
  useEffect(() => {
    if (
      typeof DeviceOrientationEvent !== 'undefined' &&
      typeof (DeviceOrientationEvent as any).requestPermission === 'function' &&
      !telemetry.hasSensorHeading
    ) {
      setNeedsSensorPermission(true);
    }
  }, [telemetry.hasSensorHeading]);

  // Sync selected pin with active waypoint
  useEffect(() => {
    if (activeWaypoint) {
      setSelectedPinWaypoint(activeWaypoint);
    }
  }, [activeWaypoint]);

  // Global Keyboard Navigation (WASD & Arrow Keys) for Laptop Movement
  useEffect(() => {
    const activeKeys = new Set<string>();
    let walkInterval: any = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) {
        return;
      }

      const key = e.key.toLowerCase();
      if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) {
        activeKeys.add(key);

        // Turn left 360°
        if (key === 'a' || key === 'arrowleft') {
          movementTrackingService.rotateHeading(-10);
        }
        // Turn right 360°
        if (key === 'd' || key === 'arrowright') {
          movementTrackingService.rotateHeading(10);
        }

        // Start step cadence if holding W/S/Up/Down
        if (!walkInterval && (activeKeys.has('w') || activeKeys.has('s') || activeKeys.has('arrowup') || activeKeys.has('arrowdown'))) {
          walkInterval = setInterval(() => {
            if (activeKeys.has('w') || activeKeys.has('arrowup')) {
              movementTrackingService.moveInHeading(1.2);
            } else if (activeKeys.has('s') || activeKeys.has('arrowdown')) {
              movementTrackingService.moveInHeading(-1.2);
            }
          }, 200);
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      activeKeys.delete(key);
      if (
        !activeKeys.has('w') &&
        !activeKeys.has('s') &&
        !activeKeys.has('arrowup') &&
        !activeKeys.has('arrowdown') &&
        walkInterval
      ) {
        clearInterval(walkInterval);
        walkInterval = null;
        movementTrackingService.stopDirectionalMove();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      if (walkInterval) clearInterval(walkInterval);
    };
  }, []);

  const handleMapClick = (e: any) => {
    if (!clickToWalkMode) return;
    const latLng = e.detail?.latLng;
    if (latLng) {
      hapticFeedback.buttonPress();
      movementTrackingService.walkTowards(latLng.lat, latLng.lng, simSpeed);
    }
  };

  const handleRecenter = () => {
    hapticFeedback.buttonPress();
    setFollowScout(true);
    movementTrackingService.requestCurrentLocation();
  };

  const handleRequestGyroPermission = async () => {
    hapticFeedback.buttonPress();
    const granted = await movementTrackingService.requestOrientationPermission();
    if (granted) {
      setNeedsSensorPermission(false);
    }
  };

  // Joystick touch/mouse event handlers
  const handleJoystickPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    setIsJoystickActive(true);
    updateJoystickFromPointer(e.clientX, e.clientY);
  };

  const updateJoystickFromPointer = useCallback((clientX: number, clientY: number) => {
    if (!joystickBaseRef.current) return;
    const rect = joystickBaseRef.current.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;

    const dx = clientX - centerX;
    const dy = clientY - centerY;
    const dist = Math.hypot(dx, dy);
    const maxRadius = 32;

    const clampedDist = Math.min(dist, maxRadius);
    const angleRad = Math.atan2(dx, -dy); // 0 = up (North), positive clockwise
    const headingDeg = ((angleRad * 180) / Math.PI + 360) % 360;

    const knobX = Math.sin(angleRad) * clampedDist;
    const knobY = -Math.cos(angleRad) * clampedDist;

    setJoystickKnobPos({ x: knobX, y: knobY });

    if (dist > 6) {
      movementTrackingService.startDirectionalMove(headingDeg, 1.8);
    }
  }, []);

  const handleJoystickPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isJoystickActive) return;
    updateJoystickFromPointer(e.clientX, e.clientY);
  };

  const handleJoystickPointerUp = () => {
    setIsJoystickActive(false);
    setJoystickKnobPos({ x: 0, y: 0 });
    movementTrackingService.stopDirectionalMove();
  };

  const categoryColor = (cat: LocalityWaypoint['category']) => {
    switch (cat) {
      case 'Canopy':
        return { bg: '#059669', glyph: '#10b981', ring: 'ring-emerald-400' };
      case 'Botanical':
        return { bg: '#65a30d', glyph: '#84cc16', ring: 'ring-lime-400' };
      case 'Geo':
        return { bg: '#d97706', glyph: '#f59e0b', ring: 'ring-amber-400' };
      case 'Fauna':
        return { bg: '#0284c7', glyph: '#38bdf8', ring: 'ring-sky-400' };
      default:
        return { bg: '#10b981', glyph: '#34d399', ring: 'ring-emerald-400' };
    }
  };

  const cardinal = getCardinalDirection(telemetry.headingDegrees);

  return (
    <div className="w-full rounded-3xl overflow-hidden border border-stone-800 bg-stone-950 shadow-2xl flex flex-col select-none">
      {/* 1. Tactical HUD Header & Map Control Strip */}
      <div className="p-3 sm:p-4 bg-stone-900 border-b border-stone-800 flex flex-wrap items-center justify-between gap-2.5">
        {/* Left: Signal & Locality */}
        <div className="flex items-center gap-2.5">
          <div className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shadow-[0_0_10px_#10b981]" />
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono font-bold text-white uppercase tracking-wider">
                Google Maps Live Radar
              </span>
              <span className="px-2 py-0.5 rounded text-[10px] font-mono font-semibold bg-emerald-950/80 text-emerald-300 border border-emerald-800">
                360° LIVE
              </span>
            </div>
            <p className="text-[11px] font-mono text-stone-400">
              {telemetry.localityName || 'GPS Nature Sector'} · ±{Math.round(telemetry.accuracy)}m
            </p>
          </div>
        </div>

        {/* Center: Live 360° Compass Bearing Pill */}
        <div className="flex items-center gap-1.5 bg-stone-950 px-3 py-1.5 rounded-xl border border-stone-800 text-xs font-mono">
          <Compass
            className="w-4 h-4 text-emerald-400 transition-transform duration-150"
            style={{ transform: `rotate(${telemetry.headingDegrees}deg)` }}
          />
          <span className="text-white font-bold">{telemetry.headingDegrees}°</span>
          <span className="text-emerald-400 font-extrabold">{cardinal}</span>
          <span className="text-stone-600">|</span>
          <span className="text-stone-300">{telemetry.speedKmh} km/h</span>
        </div>

        {/* Right: Map Layers & Recenter */}
        <div className="flex items-center gap-2">
          {/* Layer switcher */}
          <div className="hidden sm:flex items-center gap-1 bg-stone-950 p-1 rounded-xl border border-stone-800 text-xs font-mono">
            <Layers className="w-3.5 h-3.5 text-stone-400 ml-1.5" />
            {(['hybrid', 'terrain', 'roadmap'] as const).map((type) => (
              <button
                key={type}
                onClick={() => {
                  hapticFeedback.tactileClick();
                  setMapType(type);
                }}
                className={`px-2 py-1 rounded-lg uppercase text-[10px] font-bold transition-all cursor-pointer ${
                  mapType === type
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-stone-400 hover:text-white'
                }`}
              >
                {type}
              </button>
            ))}
          </div>

          {/* Follow Scout / Recenter Button */}
          <button
            onClick={handleRecenter}
            className={`px-3 py-1.5 rounded-xl border text-xs font-mono flex items-center gap-1.5 transition-all cursor-pointer ${
              followScout
                ? 'bg-emerald-600 text-white border-emerald-500 shadow-md'
                : 'bg-stone-800 hover:bg-stone-700 text-stone-200 border-stone-700'
            }`}
            title="Keep map centered on your live position"
          >
            <Crosshair className="w-3.5 h-3.5 text-emerald-300" />
            <span className="font-bold">{followScout ? 'Centered' : 'Recenter'}</span>
          </button>
        </div>
      </div>

      {/* iOS Gyroscope Permission Prompt Banner */}
      {needsSensorPermission && (
        <div className="bg-emerald-950/90 border-b border-emerald-800/80 px-4 py-2 flex items-center justify-between text-xs font-mono text-emerald-200">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-emerald-400 shrink-0" />
            <span>Enable iPhone 360° Compass to steer live as you turn your phone</span>
          </div>
          <button
            onClick={handleRequestGyroPermission}
            className="px-3 py-1 rounded-lg bg-emerald-500 text-stone-950 font-bold hover:bg-emerald-400 transition-colors cursor-pointer text-[11px]"
          >
            Calibrate 360° Compass
          </button>
        </div>
      )}

      {/* 2. Interactive Google Map Container */}
      <div className="relative w-full h-[480px] sm:h-[560px] bg-stone-950 overflow-hidden">
        <APIProvider apiKey={apiKey} libraries={['marker']}>
          <Map
            mapId="DEMO_MAP_ID"
            defaultCenter={{ lat: telemetry.latitude, lng: telemetry.longitude }}
            center={{ lat: telemetry.latitude, lng: telemetry.longitude }}
            defaultZoom={17}
            mapTypeId={mapType}
            gestureHandling="greedy"
            disableDefaultUI={false}
            onClick={handleMapClick}
            internalUsageAttributionIds={['gmp_git_agentskills_v1']}
            className="w-full h-full"
          >
            {/* Auto Camera Pan and Breadcrumbs Controller */}
            <MapCameraController
              latitude={telemetry.latitude}
              longitude={telemetry.longitude}
              heading={telemetry.headingDegrees}
              followUser={followScout}
              orientWithCompass={orientWithCompass}
              breadcrumbs={telemetry.breadcrumbs}
              onUserPanned={() => setFollowScout(false)}
            />

            {/* LIVE EXPLORER PLAYER MARKER WITH 360° GOOGLE MAPS DIRECTIONAL BEAM */}
            <AdvancedMarker
              position={{ lat: telemetry.latitude, lng: telemetry.longitude }}
              title={`${explorerName} (Explorer)`}
            >
              <div className="relative flex flex-col items-center justify-center">
                {/* 360° GOOGLE MAPS FLASHLIGHT / VISION CONE (rotates with phone or laptop heading) */}
                <div
                  className="absolute pointer-events-none transition-transform duration-100 ease-out z-0"
                  style={{
                    width: '180px',
                    height: '180px',
                    transform: `rotate(${telemetry.headingDegrees}deg)`,
                    transformOrigin: '90px 90px',
                  }}
                >
                  <svg viewBox="0 0 100 100" className="w-full h-full overflow-visible">
                    <defs>
                      <radialGradient id="googleBeamGradient" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                        <stop offset="0%" stopColor="#10b981" stopOpacity="0.8" />
                        <stop offset="40%" stopColor="#10b981" stopOpacity="0.35" />
                        <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
                      </radialGradient>
                    </defs>
                    {/* Wide 70-degree vision cone radiating forward from player center */}
                    <path
                      d="M 50 50 L 18 4 A 55 55 0 0 1 82 4 Z"
                      fill="url(#googleBeamGradient)"
                    />
                    {/* Inner intense light arc */}
                    <path
                      d="M 50 50 L 32 18 A 38 38 0 0 1 68 18 Z"
                      fill="#34d399"
                      opacity="0.25"
                    />
                  </svg>
                </div>

                {/* Core Live Marker Dot & Directional Arrow */}
                <div className="relative z-20 flex items-center justify-center">
                  {/* Outer pulsing ring */}
                  <div className="absolute w-9 h-9 rounded-full bg-emerald-500/30 animate-ping" />
                  <div className="absolute w-8 h-8 rounded-full bg-emerald-500/20 animate-pulse" />

                  {/* Directional Heading Puck */}
                  <div
                    className="w-8 h-8 rounded-full bg-emerald-600 border-2 border-white shadow-[0_0_12px_rgba(16,185,129,0.8)] flex items-center justify-center text-white transition-transform duration-100 relative z-20"
                    style={{
                      transform: `rotate(${telemetry.headingDegrees}deg)`,
                    }}
                  >
                    <Navigation className="w-4 h-4 fill-white text-white drop-shadow-sm" />
                  </div>
                </div>

                {/* Explorer Callout Tag */}
                <div className="mt-1.5 px-2.5 py-0.5 rounded-full bg-stone-900/95 text-emerald-300 text-[10px] font-mono font-bold border border-emerald-500/50 shadow-lg whitespace-nowrap z-20 flex items-center gap-1">
                  <span>{explorerName || 'Scout'}</span>
                  <span className="text-stone-500">·</span>
                  <span className="text-white">{telemetry.headingDegrees}° {cardinal}</span>
                </div>
              </div>
            </AdvancedMarker>

            {/* Field Waypoint Markers */}
            {waypoints.map((wp) => {
              const isSelected = activeWaypoint?.id === wp.id;
              const { bg, glyph } = categoryColor(wp.category);

              return (
                <AdvancedMarker
                  key={wp.id}
                  position={{ lat: wp.lat, lng: wp.lng }}
                  title={wp.name}
                  onClick={() => {
                    hapticFeedback.tactileClick();
                    setSelectedPinWaypoint(wp);
                    onSelectWaypoint?.(wp);
                  }}
                >
                  <Pin
                    background={isSelected ? '#059669' : bg}
                    glyphColor={glyph}
                    borderColor={isSelected ? '#34d399' : '#ffffff'}
                    scale={isSelected ? 1.25 : 1.0}
                  >
                    <span className="text-sm select-none">{wp.icon}</span>
                  </Pin>
                </AdvancedMarker>
              );
            })}

            {/* Waypoint InfoWindow Popup */}
            {selectedPinWaypoint && (
              <InfoWindow
                position={{
                  lat: selectedPinWaypoint.lat,
                  lng: selectedPinWaypoint.lng,
                }}
                onCloseClick={() => setSelectedPinWaypoint(null)}
              >
                <div className="p-1 max-w-[240px] text-stone-900">
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="text-lg">{selectedPinWaypoint.icon}</span>
                    <div>
                      <h4 className="font-bold text-xs leading-tight text-stone-950">
                        {selectedPinWaypoint.name}
                      </h4>
                      <span className="text-[10px] font-mono text-emerald-700 font-semibold uppercase">
                        {selectedPinWaypoint.category}
                      </span>
                    </div>
                  </div>

                  <p className="text-[11px] text-stone-600 line-clamp-3 mb-2 font-sans leading-tight">
                    {selectedPinWaypoint.description}
                  </p>

                  <div className="flex items-center gap-1 pt-1 border-t border-stone-200">
                    <button
                      onClick={() => {
                        hapticFeedback.buttonPress();
                        onSelectWaypoint?.(selectedPinWaypoint);
                      }}
                      className="flex-1 py-1 px-1.5 rounded bg-emerald-700 hover:bg-emerald-800 text-white text-[10px] font-mono font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                    >
                      <Navigation className="w-3 h-3" />
                      <span>Track Target</span>
                    </button>

                    <button
                      onClick={() => {
                        hapticFeedback.buttonPress();
                        movementTrackingService.walkTowards(
                          selectedPinWaypoint.lat,
                          selectedPinWaypoint.lng,
                          simSpeed
                        );
                      }}
                      className="py-1 px-1.5 rounded bg-stone-800 hover:bg-stone-900 text-white text-[10px] font-mono font-bold flex items-center justify-center gap-1 cursor-pointer transition-colors"
                      title="Simulate walking directly to this waypoint"
                    >
                      <Footprints className="w-3 h-3 text-emerald-400" />
                      <span>Walk Here</span>
                    </button>
                  </div>
                </div>
              </InfoWindow>
            )}
          </Map>
        </APIProvider>

        {/* Floating Top Floating Compass Badge */}
        <div className="absolute top-3 left-3 bg-stone-900/90 backdrop-blur-md px-3 py-1.5 rounded-xl border border-stone-700/80 shadow-lg text-[11px] font-mono text-white flex items-center gap-2 pointer-events-none z-10">
          <Compass
            className="w-4 h-4 text-emerald-400 transition-transform duration-100"
            style={{ transform: `rotate(${telemetry.headingDegrees}deg)` }}
          />
          <span>Bearing: <strong className="text-emerald-400">{telemetry.headingDegrees}° {cardinal}</strong></span>
          <span className="text-stone-500">|</span>
          <span className="text-stone-300">
            {telemetry.hasSensorHeading ? '📱 Gyro Active' : '💻 360° Live'}
          </span>
        </div>

        {/* Floating Center Re-Center Scout Button (Appears if user panned away) */}
        {!followScout && (
          <div className="absolute top-3 right-3 z-10">
            <button
              onClick={handleRecenter}
              className="bg-emerald-600 hover:bg-emerald-500 text-white px-3 py-1.5 rounded-xl shadow-xl font-mono text-xs font-bold flex items-center gap-1.5 border border-emerald-400 transition-all cursor-pointer animate-bounce"
            >
              <LocateFixed className="w-4 h-4" />
              <span>Center On Me</span>
            </button>
          </div>
        )}

        {/* FLOATING VIRTUAL 360° JOYSTICK (Bottom Left) - Enables full 360° movement on laptop & mobile */}
        {showJoystick && (
          <div className="absolute bottom-4 left-4 z-20 flex flex-col items-center">
            <div
              ref={joystickBaseRef}
              onPointerDown={handleJoystickPointerDown}
              onPointerMove={handleJoystickPointerMove}
              onPointerUp={handleJoystickPointerUp}
              onPointerCancel={handleJoystickPointerUp}
              className="relative w-24 h-24 rounded-full bg-stone-900/90 backdrop-blur-md border-2 border-stone-700/90 shadow-2xl flex items-center justify-center cursor-grab active:cursor-grabbing touch-none select-none"
              title="Drag in any 360° direction to steer and walk"
            >
              {/* Cardinal ticks */}
              <span className="absolute top-1 text-[9px] font-mono font-bold text-stone-500">N</span>
              <span className="absolute right-1.5 text-[9px] font-mono font-bold text-stone-500">E</span>
              <span className="absolute bottom-1 text-[9px] font-mono font-bold text-stone-500">S</span>
              <span className="absolute left-1.5 text-[9px] font-mono font-bold text-stone-500">W</span>

              {/* Directional needle indicator */}
              <div
                className="absolute w-full h-full pointer-events-none flex items-center justify-center transition-transform duration-75"
                style={{ transform: `rotate(${telemetry.headingDegrees}deg)` }}
              >
                <div className="w-0.5 h-10 bg-emerald-400/50 -translate-y-3" />
              </div>

              {/* Thumbstick Knob */}
              <div
                className={`w-10 h-10 rounded-full flex items-center justify-center border-2 shadow-lg transition-transform ${
                  isJoystickActive
                    ? 'bg-emerald-500 border-white scale-110 shadow-emerald-500/50'
                    : 'bg-stone-800 border-stone-600'
                }`}
                style={{
                  transform: `translate(${joystickKnobPos.x}px, ${joystickKnobPos.y}px)`,
                }}
              >
                <Navigation
                  className="w-4 h-4 text-white"
                  style={{ transform: `rotate(${telemetry.headingDegrees}deg)` }}
                />
              </div>
            </div>
            <span className="mt-1 text-[9px] font-mono text-stone-400 bg-stone-950/80 px-2 py-0.5 rounded-full border border-stone-800">
              360° Steer & Walk
            </span>
          </div>
        )}

        {/* 360° STEERING WHEEL & CARDINAL PRESET CONTROLS (Bottom Right) */}
        <div className="absolute bottom-4 right-4 z-20 flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1 bg-stone-900/90 backdrop-blur-md p-1.5 rounded-2xl border border-stone-700/80 shadow-xl font-mono text-xs">
            <button
              onClick={() => {
                hapticFeedback.tactileClick();
                movementTrackingService.rotateHeading(-15);
              }}
              className="p-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 transition-colors cursor-pointer"
              title="Turn Left 15°"
            >
              <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
            </button>

            <button
              onClick={() => {
                hapticFeedback.tactileClick();
                movementTrackingService.setHeading(0, 'manual');
              }}
              className="px-2 py-1 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 text-[10px] font-bold transition-colors cursor-pointer"
              title="Point North (0°)"
            >
              NORTH
            </button>

            <button
              onClick={() => {
                hapticFeedback.tactileClick();
                movementTrackingService.rotateHeading(15);
              }}
              className="p-1.5 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 transition-colors cursor-pointer"
              title="Turn Right 15°"
            >
              <RotateCw className="w-3.5 h-3.5 text-emerald-400" />
            </button>
          </div>
        </div>
      </div>

      {/* 3. Sleek Live Telemetry Footer */}
      <div className="px-3.5 py-3 bg-stone-900 border-t border-stone-800 flex flex-wrap items-center justify-between gap-2.5 text-xs font-mono">
        <div className="flex items-center gap-2 text-stone-300">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>
            Live Bearing: <strong className="text-emerald-400">{telemetry.headingDegrees}° {cardinal}</strong>
          </span>
          {telemetry.hasSensorHeading ? (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-emerald-950 text-emerald-300 border border-emerald-800">
              Live Phone 360°
            </span>
          ) : (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-stone-800 text-stone-300 border border-stone-700">
              Live Radar
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-[11px] text-stone-400">
          <span>Steps: <strong className="text-white">{telemetry.stepCount}</strong></span>
          <span className="text-stone-600">·</span>
          <span>Dist: <strong className="text-emerald-400">{telemetry.distanceCoveredMeters}m</strong></span>
          <span className="text-stone-600">·</span>
          <span>Speed: <strong className="text-white">{telemetry.speedMps} m/s</strong></span>
        </div>
      </div>
    </div>
  );
};
