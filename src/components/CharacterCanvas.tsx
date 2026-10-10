import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { hapticFeedback } from '../utils/haptics';

interface CharacterCanvasProps {
  gender?: 'male' | 'female';
  isWalking?: boolean;
  gamePage?: 'welcome' | 'character' | 'playing';
  onCharacterClick?: () => void;
}

export const CharacterCanvas: React.FC<CharacterCanvasProps> = ({
  gender = 'male',
  isWalking = false,
  gamePage = 'welcome',
  onCharacterClick,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const manualRotationRef = useRef<number>(0);
  const targetManualRotationRef = useRef<number>(0);
  const mousePosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // 3D Scene and Model References
  const sceneRef = useRef<THREE.Scene | null>(null);
  const characterRootRef = useRef<THREE.Group | null>(null);
  const maleGroupRef = useRef<THREE.Group | null>(null);
  const maleGltfRef = useRef<THREE.Group | null>(null);
  const maleHeadBoneRef = useRef<THREE.Object3D | null>(null);
  const maleMixerRef = useRef<THREE.AnimationMixer | null>(null);
  const maleActionsRef = useRef<Record<string, THREE.AnimationAction>>({});
  const currentActionRef = useRef<string>('idle');

  // Procedural Fallback Mesh (shown instantly until GLTF completes)
  const maleFallbackRef = useRef<THREE.Group | null>(null);
  const maleLimbsRef = useRef<{
    leftArm?: THREE.Group;
    rightArm?: THREE.Group;
    leftLeg?: THREE.Group;
    rightLeg?: THREE.Group;
    head?: THREE.Group;
    pelvis?: THREE.Group;
  }>({});

  // UI state
  const [activeAnimation, setActiveAnimation] = useState<string>('idle');
  const [isModelLoaded, setIsModelLoaded] = useState<boolean>(false);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const width = container.clientWidth || 400;
    const height = container.clientHeight || 450;
    const aspect = width / height;
    // Dynamic FOV and camera distance to prevent character cutoff and ensure clear margins
    const fov = aspect < 0.75 ? 40 : aspect < 1.0 ? 37 : 33;
    const camZ = aspect < 0.75 ? 4.5 : aspect < 1.0 ? 4.2 : 3.8;
    const camera = new THREE.PerspectiveCamera(fov, aspect, 0.1, 100);
    camera.position.set(0, -0.05, camZ);
    camera.lookAt(0, -0.05, 0);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);

    // Warm Studio Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 2.0);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 2.5);
    keyLight.position.set(2.5, 4.5, 3.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.bias = -0.001;
    scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe0f2fe, 1.4);
    fillLight.position.set(-3.0, 2.5, 2.0);
    scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xa7f3d0, 2.2);
    rimLight.position.set(0, 3.5, -3.5);
    scene.add(rimLight);

    // Ground Contact Shadow Disc at y = -0.92
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 256;
    shadowCanvas.height = 256;
    const sCtx = shadowCanvas.getContext('2d')!;
    const grad = sCtx.createRadialGradient(128, 128, 12, 128, 128, 120);
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.7)');
    grad.addColorStop(0.5, 'rgba(15, 23, 42, 0.22)');
    grad.addColorStop(1, 'rgba(15, 23, 42, 0)');
    sCtx.fillStyle = grad;
    sCtx.fillRect(0, 0, 256, 256);

    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowGeo = new THREE.PlaneGeometry(3.0, 3.0);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = -0.92;
    scene.add(shadowMesh);

    // Character Root Node
    const characterRoot = new THREE.Group();
    characterRoot.position.set(0, -0.92, 0);
    scene.add(characterRoot);
    characterRootRef.current = characterRoot;

    // Materials for procedural fallback
    const skinMat = new THREE.MeshStandardMaterial({ color: 0xedd6c8, roughness: 0.55 });
    const jacketMat = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.45 });
    const cargoMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.7 });
    const beanieMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.85 });
    const emeraldMat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.3, metalness: 0.2 });
    const sneakerMat = new THREE.MeshStandardMaterial({ color: 0xe4e4e7, roughness: 0.4 });
    const sneakerSoleMat = new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.9 });

    const maleGroup = new THREE.Group();
    characterRoot.add(maleGroup);
    maleGroupRef.current = maleGroup;

    // Immediate Procedural Fallback (so canvas is never blank!)
    const mFallback = new THREE.Group();
    maleGroup.add(mFallback);
    maleFallbackRef.current = mFallback;

    const mPelvis = new THREE.Group();
    mPelvis.position.y = 1.05;
    mFallback.add(mPelvis);
    maleLimbsRef.current.pelvis = mPelvis;

    const mTorso = new THREE.Group();
    mPelvis.add(mTorso);

    const mBLower = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.34, 0.2, 20), jacketMat);
    mBLower.position.y = 0.14;
    mBLower.castShadow = true;
    mTorso.add(mBLower);

    const mBMid = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.36, 0.2, 20), jacketMat);
    mBMid.position.y = 0.32;
    mBMid.castShadow = true;
    mTorso.add(mBMid);

    const mBUpper = new THREE.Mesh(new THREE.CylinderGeometry(0.40, 0.38, 0.2, 20), jacketMat);
    mBUpper.position.y = 0.50;
    mBUpper.castShadow = true;
    mTorso.add(mBUpper);

    const mCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.25, 0.16, 20), jacketMat);
    mCollar.position.y = 0.66;
    mTorso.add(mCollar);

    const mZipper = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.56, 0.03), emeraldMat);
    mZipper.position.set(0, 0.32, 0.37);
    mTorso.add(mZipper);

    // Head
    const mHeadGroup = new THREE.Group();
    mHeadGroup.position.y = 0.88;
    mTorso.add(mHeadGroup);
    maleLimbsRef.current.head = mHeadGroup;

    const mFace = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 24), skinMat);
    mHeadGroup.add(mFace);

    const mBDome = new THREE.Mesh(new THREE.SphereGeometry(0.19, 20, 16), beanieMat);
    mBDome.position.set(0, 0.05, -0.02);
    mHeadGroup.add(mBDome);

    const mBCuff = new THREE.Mesh(new THREE.CylinderGeometry(0.195, 0.195, 0.08, 20), beanieMat);
    mBCuff.position.set(0, 0.04, -0.01);
    mHeadGroup.add(mBCuff);

    const mShades = new THREE.Mesh(
      new THREE.BoxGeometry(0.24, 0.045, 0.05),
      new THREE.MeshStandardMaterial({ color: 0x09090b, roughness: 0.1, metalness: 0.9 })
    );
    mShades.position.set(0, 0.02, 0.155);
    mHeadGroup.add(mShades);

    // Arms
    const mLArm = new THREE.Group();
    mLArm.position.set(-0.44, 0.52, 0);
    mTorso.add(mLArm);
    maleLimbsRef.current.leftArm = mLArm;

    const mLSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.50, 16), jacketMat);
    mLSleeve.position.y = -0.25;
    mLSleeve.castShadow = true;
    mLArm.add(mLSleeve);

    const mLHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.07), skinMat);
    mLHand.position.y = -0.55;
    mLArm.add(mLHand);

    const mRArm = new THREE.Group();
    mRArm.position.set(0.44, 0.52, 0);
    mTorso.add(mRArm);
    maleLimbsRef.current.rightArm = mRArm;

    const mRSleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.11, 0.50, 16), jacketMat);
    mRSleeve.position.y = -0.25;
    mRSleeve.castShadow = true;
    mRArm.add(mRSleeve);

    const mRHand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.12, 0.07), skinMat);
    mRHand.position.y = -0.55;
    mRArm.add(mRHand);

    // Legs
    const mWaist = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.36, 0.2, 20), cargoMat);
    mWaist.position.y = 0.02;
    mPelvis.add(mWaist);

    const mLLeg = new THREE.Group();
    mLLeg.position.set(-0.19, 0.05, 0);
    mPelvis.add(mLLeg);
    maleLimbsRef.current.leftLeg = mLLeg;

    const mLLegMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.74, 16), cargoMat);
    mLLegMesh.position.y = -0.34;
    mLLegMesh.castShadow = true;
    mLLeg.add(mLLegMesh);

    const mLShoe = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.16, 0.38), sneakerMat);
    mLShoe.position.set(0, -0.73, 0.05);
    mLShoe.castShadow = true;
    mLLeg.add(mLShoe);

    const mLSole = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.07, 0.40), sneakerSoleMat);
    mLSole.position.set(0, -0.81, 0.05);
    mLLeg.add(mLSole);

    const mRLeg = new THREE.Group();
    mRLeg.position.set(0.19, 0.05, 0);
    mPelvis.add(mRLeg);
    maleLimbsRef.current.rightLeg = mRLeg;

    const mRLegMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.74, 16), cargoMat);
    mRLegMesh.position.y = -0.34;
    mRLegMesh.castShadow = true;
    mRLeg.add(mRLegMesh);

    const mRShoe = new THREE.Mesh(new THREE.BoxGeometry(0.21, 0.16, 0.38), sneakerMat);
    mRShoe.position.set(0, -0.73, 0.05);
    mRShoe.castShadow = true;
    mRLeg.add(mRShoe);

    const mRSole = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.07, 0.40), sneakerSoleMat);
    mRSole.position.set(0, -0.81, 0.05);
    mRLeg.add(mRSole);

    // Safe Async GLTF Loader with defensive MeshoptDecoder and WebAssembly detection
    let isDisposed = false;

    const loadCharacterGltf = async () => {
      if (isDisposed) return;
      try {
        const loader = new GLTFLoader();
        if (MeshoptDecoder && typeof (MeshoptDecoder as any)?.ready?.then === 'function') {
          try {
            await (MeshoptDecoder as any).ready;
            loader.setMeshoptDecoder(MeshoptDecoder);
          } catch (meshErr) {
            console.warn('[CharacterCanvas] MeshoptDecoder init notice:', meshErr);
          }
        }

        const modelPath = gender === 'female' ? '/models/michelle.glb' : '/models/nico.glb';
        loader.load(
          modelPath,
          (gltf) => {
            if (isDisposed) return;
            try {
              const model = gltf?.scene;
              if (!model) return;

              model.traverse((child) => {
                if ((child as THREE.Mesh)?.isMesh) {
                  const mesh = child as THREE.Mesh;
                  mesh.castShadow = true;
                  mesh.receiveShadow = true;
                }
                if (child?.name && (child.name.includes('Head') || child.name.includes('Neck'))) {
                  maleHeadBoneRef.current = child;
                }
              });

              // Scale appropriately (around 1.05 - 1.08)
              const scale = gender === 'female' ? 1.0 : 1.05;
              model.scale.set(scale, scale, scale);
              model.position.set(0, 0, 0);

              if (gltf.animations && gltf.animations.length > 0) {
                const mixer = new THREE.AnimationMixer(model);
                maleMixerRef.current = mixer;

                const actions: Record<string, THREE.AnimationAction> = {};
                gltf.animations.forEach((clip) => {
                  if (clip?.name) {
                    actions[clip.name] = mixer.clipAction(clip);
                  }
                });
                maleActionsRef.current = actions;

                const idleAction = actions['idle'] || Object.values(actions)[0];
                if (idleAction) {
                  idleAction.reset().fadeIn(0.3).play();
                }
              }

              if (mFallback) mFallback.visible = false;
              maleGroup.add(model);
              maleGltfRef.current = model;
              setIsModelLoaded(true);
            } catch (traverseErr) {
              console.warn('[CharacterCanvas] GLTF process notice, procedural fallback active:', traverseErr);
            }
          },
          undefined,
          (err) => {
            console.warn('[CharacterCanvas] GLTF load notice, procedural fallback active:', err);
          }
        );
      } catch (loaderErr) {
        console.warn('[CharacterCanvas] GLTFLoader init notice:', loaderErr);
      }
    };

    loadCharacterGltf();

    // Pointer mouse tracking
    const handleMouseMove = (e: MouseEvent) => {
      if (!container) return;
      const rect = container.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) return;
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -(((e.clientY - rect.top) / rect.height) * 2 - 1);
      mousePosRef.current = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)) };
    };

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      const aspect = w / h;
      camera.aspect = aspect;
      camera.fov = aspect < 0.75 ? 40 : aspect < 1.0 ? 37 : 33;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('resize', handleResize);

    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      try {
        resizeObserver = new ResizeObserver(handleResize);
        resizeObserver.observe(container);
      } catch (_) {}
    }

    // Animation Loop
    let animationFrameId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      const delta = clock.getDelta();
      const elapsedTime = clock.getElapsedTime();

      // Update active mixer
      if (maleMixerRef.current) {
        maleMixerRef.current.update(delta);
      }

      // Smooth Orbit Drag Rotation
      manualRotationRef.current = THREE.MathUtils.lerp(
        manualRotationRef.current,
        targetManualRotationRef.current,
        0.1
      );

      // Procedural Fallback Animation
      if (mFallback && mFallback.visible) {
        const breath = Math.sin(elapsedTime * 2.2) * 0.012;
        if (maleLimbsRef.current.pelvis) maleLimbsRef.current.pelvis.position.y = 1.05 + breath;

        if (isWalking) {
          const walkCycle = Math.sin(elapsedTime * 6.5);
          if (maleLimbsRef.current.leftLeg) maleLimbsRef.current.leftLeg.rotation.x = walkCycle * 0.6;
          if (maleLimbsRef.current.rightLeg) maleLimbsRef.current.rightLeg.rotation.x = -walkCycle * 0.6;
          if (maleLimbsRef.current.leftArm) maleLimbsRef.current.leftArm.rotation.x = -walkCycle * 0.45;
          if (maleLimbsRef.current.rightArm) maleLimbsRef.current.rightArm.rotation.x = walkCycle * 0.45;
        } else {
          const idleArm = Math.sin(elapsedTime * 2.0) * 0.035;
          if (maleLimbsRef.current.leftArm) maleLimbsRef.current.leftArm.rotation.x = 0.05 + idleArm;
          if (maleLimbsRef.current.rightArm) maleLimbsRef.current.rightArm.rotation.x = 0.05 - idleArm;
        }

        if (maleLimbsRef.current.head) {
          maleLimbsRef.current.head.rotation.y = THREE.MathUtils.lerp(
            maleLimbsRef.current.head.rotation.y,
            mousePosRef.current.x * 0.35,
            0.08
          );
          maleLimbsRef.current.head.rotation.x = THREE.MathUtils.lerp(
            maleLimbsRef.current.head.rotation.x,
            -mousePosRef.current.y * 0.25,
            0.08
          );
        }
      }

      // Root rotation with gentle ambient sway
      const idleSway = Math.sin(elapsedTime * 1.5) * 0.02;
      if (characterRootRef.current) {
        characterRootRef.current.rotation.y = manualRotationRef.current + idleSway;

        // Head bone tracking on GLTF model
        if (maleHeadBoneRef.current) {
          maleHeadBoneRef.current.rotation.y = THREE.MathUtils.lerp(
            maleHeadBoneRef.current.rotation.y,
            mousePosRef.current.x * 0.25,
            0.08
          );
          maleHeadBoneRef.current.rotation.x = THREE.MathUtils.lerp(
            maleHeadBoneRef.current.rotation.x,
            -mousePosRef.current.y * 0.2,
            0.08
          );
        }
      }

      // Responsive Camera Framing for Phones, Tablets, and Desktops
      const aspect = (container.clientWidth || 400) / (container.clientHeight || 450);
      let targetZ = 3.8;
      if (aspect < 0.7) {
        targetZ = 4.5; // Portrait smartphones
      } else if (aspect < 0.95) {
        targetZ = 4.2; // Small screens / tablets portrait
      } else if (aspect < 1.3) {
        targetZ = 4.0; // Tablets / iPads landscape
      } else {
        targetZ = 3.8; // Laptops / Desktops
      }

      if (gamePage === 'playing') {
        // Ensure ample clearance on playing mission deck
        targetZ = Math.max(targetZ, 4.1);
      }

      camera.position.x = THREE.MathUtils.lerp(camera.position.x, 0, 0.08);
      camera.position.y = THREE.MathUtils.lerp(camera.position.y, 0.0, 0.08);
      camera.position.z = THREE.MathUtils.lerp(camera.position.z, targetZ, 0.08);
      camera.lookAt(0, -0.05, 0);

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      isDisposed = true;
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('resize', handleResize);
      if (resizeObserver) {
        try {
          resizeObserver.disconnect();
        } catch (_) {}
      }
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [gamePage, gender]);

  // Animation switcher
  const switchAnimation = (actionName: string) => {
    const actions = maleActionsRef.current;
    if (actions && actions[actionName]) {
      const prevAction = actions[currentActionRef.current];
      const nextAction = actions[actionName];
      if (prevAction && prevAction !== nextAction) {
        prevAction.fadeOut(0.3);
      }
      nextAction.reset().fadeIn(0.3).play();
      currentActionRef.current = actionName;
    }
    setActiveAnimation(actionName);
  };

  // Sync isWalking
  useEffect(() => {
    if (isWalking) {
      if (maleActionsRef.current['slide']) switchAnimation('slide');
    } else {
      if (maleActionsRef.current['idle']) switchAnimation('idle');
    }
  }, [isWalking]);

  // Pointer drag to orbit 360°
  const handlePointerDown = (e: React.PointerEvent) => {
    setIsDragging(true);
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {}
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDragging) return;
    const deltaX = e.clientX - dragStartRef.current.x;
    targetManualRotationRef.current += deltaX * 0.012;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    setIsDragging(false);
    try {
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    } catch {}
  };

  // Tap to wave
  const handleCanvasClick = () => {
    hapticFeedback.tactileClick();
    const actions = maleActionsRef.current;
    if (actions && actions['waving']) {
      switchAnimation('waving');
      setTimeout(() => {
        if (actions['idle']) switchAnimation('idle');
      }, 2600);
    }
    if (onCharacterClick) {
      onCharacterClick();
    }
  };

  const rotateLeft = () => {
    hapticFeedback.tactileClick();
    targetManualRotationRef.current -= Math.PI / 4;
  };
  const rotateRight = () => {
    hapticFeedback.tactileClick();
    targetManualRotationRef.current += Math.PI / 4;
  };

  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center select-none overflow-hidden">
      {/* 3D WebGL Canvas */}
      <div
        ref={mountRef}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onClick={handleCanvasClick}
      />

      {/* Top Left: Tap & Gesture Hint (Out of the way of character head) */}
      <div className="absolute top-2.5 left-2.5 z-20 pointer-events-none">
        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-lg bg-stone-900/60 backdrop-blur-md border border-stone-700/40 text-[9px] sm:text-[10px] font-mono font-medium text-stone-200">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span>DRAG 360° · TAP TO WAVE</span>
        </span>
      </div>

      {/* Top Right: Animation Controls */}
      {(gamePage === 'welcome' || gamePage === 'character') && (
        <div className="absolute top-2.5 right-2.5 z-20 flex items-center gap-1 bg-stone-900/80 backdrop-blur-md p-0.5 sm:p-1 rounded-xl border border-stone-700/50 text-[10px] font-mono shadow-sm">
          {(
            [
              { id: 'idle', label: 'Idle' },
              { id: 'waving', label: 'Wave' },
              { id: 'slide', label: 'Walk' },
            ] as const
          ).map((act) => (
            <button
              key={act.id}
              onClick={(e) => {
                e.stopPropagation();
                hapticFeedback.tactileClick();
                switchAnimation(act.id);
              }}
              className={`px-2 py-0.5 sm:py-1 rounded-lg transition-all cursor-pointer font-bold ${
                activeAnimation === act.id
                  ? 'bg-emerald-500 text-stone-950 shadow-xs'
                  : 'text-stone-300 hover:text-white hover:bg-stone-800/80'
              }`}
            >
              {act.label}
            </button>
          ))}
        </div>
      )}

      {/* Bottom Rotation Arrows (Positioned at corners so feet/shoes are 100% visible and unobstructed) */}
      <div className="absolute bottom-2 left-2 z-20">
        <button
          onClick={rotateLeft}
          title="Rotate Left 45°"
          type="button"
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-stone-900/70 hover:bg-stone-900 text-stone-200 hover:text-white border border-stone-700/50 shadow-xs text-xs font-mono transition-transform active:scale-95 cursor-pointer backdrop-blur-sm flex items-center justify-center"
        >
          <span>⟲</span>
        </button>
      </div>

      <div className="absolute bottom-2 right-2 z-20">
        <button
          onClick={rotateRight}
          title="Rotate Right 45°"
          type="button"
          className="w-7 h-7 sm:w-8 sm:h-8 rounded-lg bg-stone-900/70 hover:bg-stone-900 text-stone-200 hover:text-white border border-stone-700/50 shadow-xs text-xs font-mono transition-transform active:scale-95 cursor-pointer backdrop-blur-sm flex items-center justify-center"
        >
          <span>⟳</span>
        </button>
      </div>
    </div>
  );
};
