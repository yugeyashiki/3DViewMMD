import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
import { FaceMesh } from '@mediapipe/face_mesh';
import { Camera } from '@mediapipe/camera_utils';

// --- Configuration ---
const CONFIG = {
    // Display
    MONITOR_WIDTH: 0.5,
    ASPECT_RATIO: window.innerWidth / window.innerHeight,
    DEFAULT_EYE_Z: 0.8,
    PROJECTION_DIST: -8.0,

    // Camera Settings
    CAMERA_FOV: 20,            // Slightly wider to show more of the pulled-back scene
    CAMERA_NEAR: 0.1,
    CAMERA_FAR: 1000.0,
    CAMERA_POSITION: { x: 0, y: 12, z: 75 }, // Pulsed further back for "引き" shot
    CAMERA_LOOKAT: { x: 0, y: 10, z: 0 },

    // Face Tracking
    EYE_SCALE_X: 20.0,         // Further increased sensitivity
    EYE_SCALE_Y: 18.0,
    EYE_OFFSET_Y: 14.0,
    EYE_POS_Z: 30.0,
    LERP_SPEED: 0.25,          // More responsive tracking
    BLINK_THRESHOLD: 0.08,

    // Scene
    BACKGROUND_COLOR: 0x333333, // Slightly lighter background
    LIGHT_INTENSITY: 1.5,
    AMBIENT_INTENSITY: 0.8,

    // MMD Settings
    MMD: {
        MODEL_PATH: './Models/Vcreate_mmd.pmx',
        MOTION_PATHS: [
            './Motions/ワールドイズマイン.vmd'
        ],
        USE_PHYSICS: false
    },

    // Box Stage Settings
    BOX_STAGE: {
        BACK_Z: -50,            // バックスクリーンのZ位置
        WALL_COLOR: 0x1a1a2e,   // 壁面の色
        WALL_OPACITY: 0.95,     // 壁面の不透明度
        DEPTH: 50               // 箱の奥行き（バックスクリーンから手前への長さ）
    },

    // Zoom & Depth Settings (Dynamic Profiles)
    PROFILES: {
        NORMAL: {
            ZOOM_MIN_Z: 10,
            ZOOM_MAX_Z: 150,
            FACE_DEPTH_FACTOR: 1200.0,
            FACE_DEPTH_LERP: 0.1,
            PARALLAX_SENSITIVITY: 7.5
        },
        VTS: {
            ZOOM_MIN_Z: 10,
            ZOOM_MAX_Z: 300,
            FACE_DEPTH_FACTOR: 4500.0,
            FACE_DEPTH_LERP: 0.08,
            PARALLAX_SENSITIVITY: 18.0
        }
    },
    WHEEL_SENSITIVITY: 0.15
};

// Current active settings (initially NORMAL)
let currentConfig = { ...CONFIG.PROFILES.NORMAL };

const DEBUG_MODE = new URLSearchParams(window.location.search).has('debug');

function debugLog(...args) {
    if (DEBUG_MODE) {
        console.log('[MMD-DEBUG]', ...args);
    }
}

// --- Globals ---
let scene, camera, renderer;
let mesh = null;
let helper = null;
let clock = new THREE.Clock();
let gridRoom = null;
// Box Stage
let boxStage = { back: null, left: null, right: null, ceiling: null };

// Virtual camera position to combine various inputs
let targetCameraZ = CONFIG.CAMERA_POSITION.z;
let faceDepthOffset = 0;
let baseFaceDistance = null; // Initial Eye distance for calibration
let availableVideoDevices = [];
let currentDeviceIndex = 0;
let currentStream = null;

// --- Mouse Drag Camera Control ---
let isDragging = false;
let lastMouseX = 0;
let lastMouseY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;
const DRAG_SENSITIVITY = 0.3;

// --- Pause Control ---
let isPaused = false;

// --- Auto Reload Control ---
let isReloading = false;

// --- MediaPipe ---
let faceMesh;
let cameraInput;
let userEyePosition = new THREE.Vector3(0, CONFIG.EYE_OFFSET_Y, CONFIG.EYE_POS_Z);
const videoElement = document.getElementById('input_video');

// --- HUD ---
let hudVisible = false;
let hudFaceDetected = false;
let hudRawX = 0;   // nose.x 正規化値 -0.5〜0.5
let hudRawY = 0;   // nose.y 正規化値 -0.5〜0.5
let hudDepthZ = 0; // faceDepthOffset
let lastHudLandmarks = null;  // ランドマーク描画用

const hudEl = {
    panel: () => document.getElementById('tracking-hud'),
    status: () => document.getElementById('hud-face-status'),
    x: () => document.getElementById('hud-x'),
    y: () => document.getElementById('hud-y'),
    z: () => document.getElementById('hud-z'),
    barX: () => document.getElementById('bar-x'),
    barY: () => document.getElementById('bar-y'),
    barZ: () => document.getElementById('bar-z'),
    lmCvs: () => document.getElementById('landmark-canvas'),
};

// バーUIを更新（-1〜1 → 中央が0、左端-1、右端+1）
function setBar(barEl, val, maxAbs) {
    if (!barEl) return;
    const ratio = Math.max(-1, Math.min(1, val / maxAbs));  // -1〜1
    const center = 50;  // %
    if (ratio >= 0) {
        barEl.style.left = center + '%';
        barEl.style.width = (ratio * center) + '%';
    } else {
        barEl.style.left = (center + ratio * center) + '%';
        barEl.style.width = (-ratio * center) + '%';
    }
}

// HUDテキスト・バーの差分更新（rAF内で毎フレーム呼ぶ）
function updateHud() {
    if (!hudVisible) return;
    const s = hudEl.status();
    if (hudFaceDetected) {
        s.textContent = '● DETECTED';
        s.className = 'on';
    } else {
        s.textContent = '● NOT DETECTED';
        s.className = 'off';
    }
    const xStr = hudRawX.toFixed(3);
    const yStr = hudRawY.toFixed(3);
    const zStr = hudDepthZ.toFixed(1);
    if (hudEl.x().textContent !== xStr) hudEl.x().textContent = xStr;
    if (hudEl.y().textContent !== yStr) hudEl.y().textContent = yStr;
    if (hudEl.z().textContent !== zStr) hudEl.z().textContent = zStr;
    setBar(hudEl.barX(), hudRawX, 0.5);
    setBar(hudEl.barY(), hudRawY, 0.5);
    setBar(hudEl.barZ(), hudDepthZ, 30);  // ±30程度の範囲を想定
}

// ランドマーク(鼻・目の内角4点)を overlay canvas に描画
function drawLandmarks() {
    const cvs = hudEl.lmCvs();
    if (!cvs) return;
    const ctx = cvs.getContext('2d');

    // canvas サイズをウィンドウに合わせる（変化した場合のみ）
    if (cvs.width !== window.innerWidth || cvs.height !== window.innerHeight) {
        cvs.width = window.innerWidth;
        cvs.height = window.innerHeight;
    }
    ctx.clearRect(0, 0, cvs.width, cvs.height);

    if (!hudVisible || !hudFaceDetected || !lastHudLandmarks) return;

    const lm = lastHudLandmarks;
    const W = cvs.width, H = cvs.height;

    // 描画するランドマーク index: 鼻先(1)、左目内角(133)、右目内角(362)、顎先(152)
    const pointIndices = [1, 133, 362, 152, 10, 234, 454];
    // カメラ映像がミラー反転しているため x を反転
    const toScreen = (pt) => ({ sx: (1 - pt.x) * W, sy: pt.y * H });

    // 点描画
    ctx.fillStyle = 'rgba(100, 220, 255, 0.85)';
    pointIndices.forEach(idx => {
        if (!lm[idx]) return;
        const { sx, sy } = toScreen(lm[idx]);
        ctx.beginPath();
        ctx.arc(sx, sy, 4, 0, Math.PI * 2);
        ctx.fill();
    });

    // 鼻先に十字マーカー
    const nose = toScreen(lm[1]);
    ctx.strokeStyle = 'rgba(255, 200, 60, 0.9)';
    ctx.lineWidth = 1.5;
    const cs = 10;  // cross size
    ctx.beginPath();
    ctx.moveTo(nose.sx - cs, nose.sy); ctx.lineTo(nose.sx + cs, nose.sy);
    ctx.moveTo(nose.sx, nose.sy - cs); ctx.lineTo(nose.sx, nose.sy + cs);
    ctx.stroke();
}



// --- Init ---
async function init() {
    try {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(CONFIG.BACKGROUND_COLOR);

        // --- Enhanced Lighting ---
        // 1. Hemisphere Light (Base ambient light from sky/ground)
        const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
        hemiLight.position.set(0, 20, 0);
        scene.add(hemiLight);

        // 2. Directional Light (Sun-like)
        const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.LIGHT_INTENSITY);
        dirLight.position.set(5, 20, 10);
        dirLight.castShadow = true;
        scene.add(dirLight);

        // 3. Ambient Light (Fill)
        const ambient = new THREE.AmbientLight(0xffffff, CONFIG.AMBIENT_INTENSITY);
        scene.add(ambient);

        // 4. Point Light (Following model area)
        const pointLight = new THREE.PointLight(0xffffff, 1.0);
        pointLight.position.set(0, 15, 5);
        scene.add(pointLight);

        setupThreeJS();
        // Setup floor grid only (no walls/ceiling/video background)
        setupRoom();

        camera.position.set(CONFIG.CAMERA_POSITION.x, CONFIG.CAMERA_POSITION.y, CONFIG.CAMERA_POSITION.z);
        camera.lookAt(CONFIG.CAMERA_LOOKAT.x, CONFIG.CAMERA_LOOKAT.y, CONFIG.CAMERA_LOOKAT.z);

        // MMD Animation Helper
        helper = new MMDAnimationHelper({ sync: true, afterglow: 2.0, resetPhysicsOnLoop: true });

        // Load character MMD
        await loadMMDAsync(CONFIG.MMD.MODEL_PATH, CONFIG.MMD.MOTION_PATHS);
        await setupFaceMesh();

        // Start animation
        clock = new THREE.Clock();
        animate();

    } catch (error) {
        showError('初期化エラー: ' + error.message);
    }
}

function setupThreeJS() {
    camera = new THREE.PerspectiveCamera(CONFIG.CAMERA_FOV, CONFIG.ASPECT_RATIO, CONFIG.CAMERA_NEAR, CONFIG.CAMERA_FAR);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.shadowMap.enabled = true;

    // Manage color space for better appearance
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    document.body.appendChild(renderer.domElement);
    window.addEventListener('resize', onWindowResize, false);

    // Mouse wheel for manual zoom
    window.addEventListener('wheel', (e) => {
        targetCameraZ += e.deltaY * CONFIG.WHEEL_SENSITIVITY;
        targetCameraZ = THREE.MathUtils.clamp(targetCameraZ, currentConfig.ZOOM_MIN_Z, currentConfig.ZOOM_MAX_Z);
    }, { passive: true });

    // Left-click drag for manual camera angle control (exclusive mode)
    renderer.domElement.addEventListener('mousedown', (e) => {
        if (e.button === 0) {
            isDragging = true;
            lastMouseX = e.clientX;
            lastMouseY = e.clientY;
            renderer.domElement.style.cursor = 'grabbing';
        }
    });

    window.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        const dx = e.clientX - lastMouseX;
        const dy = e.clientY - lastMouseY;
        dragOffsetX += dx * DRAG_SENSITIVITY;
        dragOffsetY -= dy * DRAG_SENSITIVITY;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 0 && isDragging) {
            isDragging = false;
            dragOffsetX = 0;
            dragOffsetY = 0;
            renderer.domElement.style.cursor = 'default';
        }
    });
}

function calculateBackScreenSize() {
    const backZ = CONFIG.BOX_STAGE.BACK_Z;
    const camZ = CONFIG.CAMERA_POSITION.z;
    const distance = camZ - backZ;
    const fovRad = THREE.MathUtils.degToRad(CONFIG.CAMERA_FOV);
    const height = 2 * distance * Math.tan(fovRad / 2);
    const width = height * (window.innerWidth / window.innerHeight);
    return { width, height };
}

function setupRoom() {
    gridRoom = new THREE.Group();

    // 床面
    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshPhongMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    gridRoom.add(floor);

    // ボックスステージ（背面壁・左右壁・天井）
    setupBoxStage(gridRoom);

    scene.add(gridRoom);
}

function setupBoxStage(parentGroup) {
    const backZ = CONFIG.BOX_STAGE.BACK_Z;
    const depth = CONFIG.BOX_STAGE.DEPTH;
    const color = CONFIG.BOX_STAGE.WALL_COLOR;
    const opacity = CONFIG.BOX_STAGE.WALL_OPACITY;
    const { width: backW, height: backH } = calculateBackScreenSize();

    const wallMat = new THREE.MeshStandardMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,
        roughness: 0.8,
        metalness: 0.1
    });

    // ① バックスクリーン（背面壁）
    boxStage.back = new THREE.Mesh(
        new THREE.PlaneGeometry(backW, backH),
        wallMat.clone()
    );
    boxStage.back.position.set(0, backH / 2 - 0.1, backZ);
    boxStage.back.receiveShadow = true;
    parentGroup.add(boxStage.back);

    // ② 左壁
    boxStage.left = new THREE.Mesh(
        new THREE.PlaneGeometry(depth, backH),
        wallMat.clone()
    );
    boxStage.left.rotation.y = Math.PI / 2;
    boxStage.left.position.set(-backW / 2, backH / 2 - 0.1, backZ + depth / 2);
    boxStage.left.receiveShadow = true;
    parentGroup.add(boxStage.left);

    // ③ 右壁
    boxStage.right = new THREE.Mesh(
        new THREE.PlaneGeometry(depth, backH),
        wallMat.clone()
    );
    boxStage.right.rotation.y = -Math.PI / 2;
    boxStage.right.position.set(backW / 2, backH / 2 - 0.1, backZ + depth / 2);
    boxStage.right.receiveShadow = true;
    parentGroup.add(boxStage.right);

    // ④ 天井
    boxStage.ceiling = new THREE.Mesh(
        new THREE.PlaneGeometry(backW, depth),
        wallMat.clone()
    );
    boxStage.ceiling.rotation.x = Math.PI / 2;
    boxStage.ceiling.position.set(0, backH - 0.1, backZ + depth / 2);
    boxStage.ceiling.receiveShadow = true;
    parentGroup.add(boxStage.ceiling);

    console.log(`✅ Box stage created: backW=${backW.toFixed(1)}, backH=${backH.toFixed(1)}, Z=${backZ}`);
}

function updateBoxStageSize() {
    if (!boxStage.back) return;

    const backZ = CONFIG.BOX_STAGE.BACK_Z;
    const depth = CONFIG.BOX_STAGE.DEPTH;
    const { width: backW, height: backH } = calculateBackScreenSize();

    boxStage.back.geometry.dispose();
    boxStage.back.geometry = new THREE.PlaneGeometry(backW, backH);
    boxStage.back.position.set(0, backH / 2 - 0.1, backZ);

    boxStage.left.geometry.dispose();
    boxStage.left.geometry = new THREE.PlaneGeometry(depth, backH);
    boxStage.left.position.set(-backW / 2, backH / 2 - 0.1, backZ + depth / 2);

    boxStage.right.geometry.dispose();
    boxStage.right.geometry = new THREE.PlaneGeometry(depth, backH);
    boxStage.right.position.set(backW / 2, backH / 2 - 0.1, backZ + depth / 2);

    boxStage.ceiling.geometry.dispose();
    boxStage.ceiling.geometry = new THREE.PlaneGeometry(backW, depth);
    boxStage.ceiling.position.set(0, backH - 0.1, backZ + depth / 2);
}

function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    updateBoxStageSize();
}



async function loadMMDAsync(modelUrl, motionUrls) {
    return new Promise((resolve, reject) => {
        // LoadingManager でテクスチャ読込エラーを捕捉
        const manager = new THREE.LoadingManager();
        manager.onStart = (url) => console.log('[Loader] Start:', url);
        manager.onError = (url) => console.error('[Loader] ❌ FAILED to load:', url);

        const loader = new MMDLoader(manager);

        // テクスチャの解決パスを明示指定
        // PMX内パスが「textures/filename.png」形式のため ./Models/ を基点にする
        loader.setResourcePath('./Models/');

        console.log('🎬 MMD Loading Start:', modelUrl, motionUrls);

        loader.loadWithAnimation(modelUrl, motionUrls, (mmd) => {
            mesh = mmd.mesh;

            // --- Diagnostic Material Inspection ---
            console.log('--- 🧪 Texture/Material Diagnostic ---');
            mesh.traverse((obj) => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;

                    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                    materials.forEach((mat, idx) => {
                        const texStatus = mat.map ? '✅ Loaded' : '❌ MISSING';
                        console.log(`Mesh: ${obj.name} | Mat[${idx}]: ${mat.name} | map: ${texStatus}`);

                        // テクスチャがない場合のみグレーフォールバック
                        if (!mat.map) {
                            mat.color.setHex(0xcccccc);
                        }
                    });
                }
            });
            console.log('--------------------------------------');

            // ============================================================
            // 🔬 MATERIAL DEEP DIAGNOSTIC (transparent/face/highlight)
            // ============================================================
            console.log('--- 🔬 Deep Diagnostic: transparent/face/highlight materials ---');
            mesh.traverse((obj) => {
                if (!obj.isMesh) return;
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                materials.forEach((mat, idx) => {
                    const n = (mat.name || '').toLowerCase();
                    const isTarget = n.includes('transparent') || n.includes('face') || n.includes('highlight') || n.includes('ハイライト');
                    if (isTarget) {
                        console.group(`%c[DIAG] Mesh:"${obj.name}" Mat[${idx}]:"${mat.name}"`, 'color:#ff9900;font-weight:bold');
                        console.log('  [1] envMap       :', mat.envMap ?? 'null (✅ none)');
                        console.log('  [1] combine      :', mat.combine ?? 'N/A', '(0=Multiply,1=Mix,2=Add)');
                        console.log('  [1] reflectivity :', mat.reflectivity ?? 'N/A');
                        console.log('  [2] transparent  :', mat.transparent);
                        console.log('  [2] opacity      :', mat.opacity);
                        console.log('  [2] alphaTest    :', mat.alphaTest);
                        console.log('  [3] depthWrite   :', mat.depthWrite);
                        console.log('  [3] depthTest    :', mat.depthTest);
                        console.log('  [4] renderOrder  :', obj.renderOrder);
                        console.log('  [4] type         :', mat.type);
                        console.groupEnd();
                    }
                });
            });

            // --- RenderOrder: 全Meshを一覧表示 ---
            console.log('--- 📋 RenderOrder List (all meshes) ---');
            const renderOrderList = [];
            scene.traverse((obj) => {
                if (obj.isMesh) {
                    const matName = Array.isArray(obj.material) ? obj.material.map(m => m.name).join(',') : obj.material?.name;
                    renderOrderList.push({ name: obj.name, matName, renderOrder: obj.renderOrder });
                }
            });
            renderOrderList.sort((a, b) => a.renderOrder - b.renderOrder);
            renderOrderList.forEach(r => console.log(`  renderOrder=${r.renderOrder} | mesh="${r.name}" | mat="${r.matName}"`));

            // --- Scene environment / background ---
            console.log('--- 🌍 Scene Environment ---');
            console.log('  scene.background  :', scene.background);
            console.log('  scene.environment :', scene.environment ?? 'null (✅ not set)');
            console.log('--- 🔬 End of Deep Diagnostic ---');

            // ============================================================
            // 🔧 FIX: 透過マテリアルの設定を強制修正
            // 原因: マテリアル名が "tranceparent"（スペルミス）のため
            //       "transparent" の文字列検索で引っかからなかった
            // ============================================================
            mesh.traverse((obj) => {
                if (!obj.isMesh) return;
                const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                let hasTransparent = false;
                materials.forEach((mat) => {
                    const n = (mat.name || '').toLowerCase();
                    // "tranceparent"（スペルミス含む）"transparent" "highlight" "ハイライト" に対応
                    const isTransparent = n.includes('tranceparent') || n.includes('transparent')
                        || n.includes('highlight') || n.includes('ハイライト');
                    if (isTransparent) {
                        mat.transparent = true;   // アルファブレンディング有効化
                        mat.alphaTest = 0.5;    // 透過境界をはっきりさせる
                        mat.depthWrite = false;  // 透過物の定石: 深度書き込みOFF
                        mat.reflectivity = 0;      // 反射値ゼロ
                        mat.needsUpdate = true;
                        hasTransparent = true;
                        console.log(`%c[FIX] ✅ material fixed: "${mat.name}"`, 'color:#00ff88;font-weight:bold');
                    }
                });
                // 透過マテリアルを持つMeshのrenderOrderを最前面に引き上げ
                if (hasTransparent) {
                    obj.renderOrder = 999;
                    console.log(`%c[FIX] ✅ renderOrder=999 applied to mesh: "${obj.name}"`, 'color:#00ff88');
                }
            });

            scene.add(mesh);

            helper.add(mesh, {
                animation: mmd.animation,
                physics: CONFIG.MMD.USE_PHYSICS
            });

            console.log('✅ MMD Loaded successfully');
            resolve();
        },
            (xhr) => {
                if (xhr.lengthComputable) {
                    const percent = Math.round(xhr.loaded / xhr.total * 100);
                    debugLog(`Progress: ${percent}%`);
                }
            },
            (error) => {
                console.error('❌ MMD Loading Error (detail):', error);
                console.error('  message:', error?.message ?? error);
                console.error('  stack  :', error?.stack ?? '(no stack)');
                const detail = error?.message ?? String(error) ?? '詳細不明';
                reject(new Error(`MMDの読み込みに失敗しました。\n${detail}`));
            });
    });
}

async function requestCameraPermission() {
    return new Promise((resolve, reject) => {
        const consentOverlay = document.getElementById('consent-overlay');
        const allowButton = document.getElementById('allow-camera');
        const denyButton = document.getElementById('deny-camera');

        if (!consentOverlay || !allowButton || !denyButton) {
            resolve();
            return;
        }

        allowButton.onclick = () => {
            consentOverlay.style.display = 'none';
            resolve();
        };
        denyButton.onclick = () => {
            consentOverlay.style.display = 'none';
            reject(new Error('カメラアクセス拒否'));
        };
    });
}

function showError(message) {
    const errorContainer = document.getElementById('error-container');
    const errorMessage = document.getElementById('error-message');
    if (errorContainer && errorMessage) {
        errorMessage.textContent = message;
        errorContainer.style.display = 'block';
    }
    console.error('[ERROR]', message);
}

async function setupFaceMesh() {
    try {
        await requestCameraPermission();
        const video = document.getElementById('input_video');
        const switchBtn = document.getElementById('switch-camera');

        // --- List Cameras ---
        const devices = await navigator.mediaDevices.enumerateDevices();
        availableVideoDevices = devices.filter(device => device.kind === 'videoinput');

        console.log('--- 📷 Available Cameras ---');
        availableVideoDevices.forEach((d, i) => console.log(`[${i}] ${d.label} (ID: ${d.deviceId})`));

        // Initial selection: Prefer physical camera (not virtual cameras)
        let initialIndex = availableVideoDevices.findIndex(device => {
            const label = device.label.toLowerCase();
            const virtualKeywords = ['vtubestudio', 'vtube studio', 'obs', 'unity', 'webcam 7', 'splitcam', 'manycam', 'nizima', 'virtual camera'];
            return label !== '' && !virtualKeywords.some(keyword => label.includes(keyword));
        });

        if (initialIndex === -1 && availableVideoDevices.length > 0) {
            // Second preference: VTube Studio or nizima virtual camera
            initialIndex = availableVideoDevices.findIndex(device => {
                const label = device.label.toLowerCase();
                return label.includes('vtubestudio') || label.includes('vtube studio') || label.includes('nizima');
            });
        }

        // Fallback: use first available device
        currentDeviceIndex = initialIndex !== -1 ? initialIndex : 0;
        console.log(`[Camera] Selected index: ${currentDeviceIndex} (${availableVideoDevices[currentDeviceIndex]?.label || 'unknown'})`);

        // Init FaceMesh
        faceMesh = new FaceMesh({ locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}` });
        faceMesh.setOptions({
            maxNumFaces: 1,
            refineLandmarks: true,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        faceMesh.onResults(onFaceResults);

        // --- Start Camera ---
        await startCamera(availableVideoDevices[currentDeviceIndex]);

        // --- Setup Switch Button ---
        if (switchBtn) {
            switchBtn.onclick = async () => {
                if (availableVideoDevices.length <= 1) return;
                currentDeviceIndex = (currentDeviceIndex + 1) % availableVideoDevices.length;
                await startCamera(availableVideoDevices[currentDeviceIndex]);
            };
        }

        // --- Keyboard Shortcuts ---
        window.addEventListener('keydown', (e) => {
            // H Key: Toggle HUD (face tracking display) visibility
            if (e.key.toLowerCase() === 'h') {
                hudVisible = !hudVisible;
                const hud = hudEl.panel();
                const lmCvs = hudEl.lmCvs();
                if (hud) hud.style.display = hudVisible ? '' : 'none';
                if (lmCvs) lmCvs.style.display = hudVisible ? '' : 'none';
                debugLog(`HUD ${hudVisible ? 'shown' : 'hidden'} via H key`);
            }
            // Space Key: Pause/Resume animation
            if (e.code === 'Space') {
                e.preventDefault();
                isPaused = !isPaused;
                debugLog(`Animation ${isPaused ? 'PAUSED ⏸' : 'RESUMED ▶'}`);
            }
        });

        // Standard frame processing loop
        const processFrame = async () => {
            // Stability Check: Only send if video is playing, has enough data, and valid dimensions
            if (video && !video.paused && !video.ended && video.readyState >= 3 && video.videoWidth > 0) {
                try {
                    await faceMesh.send({ image: video });
                } catch (err) {
                    console.error('[FaceMesh] Processing error (safe to ignore if temporary):', err);
                }
            }
            requestAnimationFrame(processFrame);
        };
        processFrame();

        // HUD is shown by default. Press 'H' to toggle visibility.
    } catch (error) {
        showError('カメラの起動に失敗しました: ' + error.message);
    }
}

async function startCamera(selectedDevice) {
    if (!selectedDevice) return;
    const video = document.getElementById('input_video');

    // Stop existing stream
    if (currentStream) {
        currentStream.getTracks().forEach(track => track.stop());
    }

    console.log('%c[Camera] Switching to: ' + selectedDevice.label, 'color: #00ffff; font-weight: bold;');

    // Apply Dynamic Profile: VTS profile for any virtual camera
    const label = selectedDevice.label.toLowerCase();
    const isVirtual = ['vtubestudio', 'vtube studio', 'nizima', '3tene', 'virtual camera'].some(kw => label.includes(kw));
    currentConfig = isVirtual ? { ...CONFIG.PROFILES.VTS } : { ...CONFIG.PROFILES.NORMAL };
    console.log(`[Camera] Applied Profile: ${isVirtual ? 'VTS (High Sensitivity)' : 'NORMAL (Standard)'}`);

    // Constraints: Using 'exact' to ensure the correct device is selected
    const manualConstraints = {
        video: {
            deviceId: { exact: selectedDevice.deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    };

    try {
        currentStream = await navigator.mediaDevices.getUserMedia(manualConstraints);
        video.srcObject = currentStream;
        await video.play();

        const track = currentStream.getVideoTracks()[0];
        const settings = track.getSettings();
        console.log(`[Camera] Actual Stream Resolution: ${settings.width}x${settings.height} @ ${settings.frameRate}fps`);
        console.log('[Camera] Camera system initialized successfully.');
    } catch (e) {
        console.error('[Camera] Failed to start camera:', e);
        // Specialized message for "In Use" error
        const msg = (e.name === 'NotReadableError')
            ? 'カメラが他のアプリ（VTube Studio等）で使用中です。VTSを閉じるか、VTS仮想カメラ（VTubeStudioCam）に切り替えてください。'
            : 'カメラの切り替えに失敗しました。ブラウザの許可設定を確認してください。';
        showError(msg);
    }
}

function onFaceResults(results) {
    // HUD: 検出状態を更新
    hudFaceDetected = !!(results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0);
    lastHudLandmarks = hudFaceDetected ? results.multiFaceLandmarks[0] : null;

    // Throttled logging for detection status
    if (DEBUG_MODE) {
        if (!window._lastLogTime) window._lastLogTime = 0;
        const now = Date.now();
        if (now - window._lastLogTime > 2000) {
            if (hudFaceDetected) {
                console.log('[FaceMesh] Face detected! Tracking active.');
            } else {
                console.warn('[FaceMesh] Camera is on, but NO face detected. Check video preview.');
            }
            window._lastLogTime = now;
        }
    }

    if (hudFaceDetected) {
        const landmarks = results.multiFaceLandmarks[0];
        updateTracking(landmarks);
    }
}

function updateTracking(lm) {
    const nose = lm[1];

    // Normalized screen offset (-0.5 to 0.5)
    const rawX = (nose.x - 0.5);
    const rawY = -(nose.y - 0.5);

    // HUD raw values
    hudRawX = rawX;
    hudRawY = rawY;

    // Target change based on face movement
    const targetX = rawX * CONFIG.MONITOR_WIDTH * CONFIG.EYE_SCALE_X;
    const targetY = rawY * (CONFIG.MONITOR_WIDTH / window.innerWidth * window.innerHeight) * CONFIG.EYE_SCALE_Y;

    // Smoothly update userEyePosition
    userEyePosition.x = THREE.MathUtils.lerp(userEyePosition.x, targetX, CONFIG.LERP_SPEED);
    userEyePosition.y = THREE.MathUtils.lerp(userEyePosition.y, targetY + CONFIG.EYE_OFFSET_Y, CONFIG.LERP_SPEED);

    // --- Face Depth (Z) Calculation ---
    // Use distance between inner eye corners (133 and 362)
    const p1 = lm[133];
    const p2 = lm[362];
    const currentDist = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

    if (baseFaceDistance === null) {
        baseFaceDistance = currentDist; // Calibrate on first detection
        debugLog('Base face distance calibrated:', baseFaceDistance);
    }

    // Larger currentDist means face is closer. Offset is negative (toward model).
    const depthChange = (currentDist - baseFaceDistance) * currentConfig.FACE_DEPTH_FACTOR;
    faceDepthOffset = THREE.MathUtils.lerp(faceDepthOffset, -depthChange, currentConfig.FACE_DEPTH_LERP);
    hudDepthZ = faceDepthOffset;  // HUD用に同期

    // Occasional debug log for distance changes
    if (DEBUG_MODE && Math.random() < 0.01) {
        console.log(`[Depth] Dist: ${currentDist.toFixed(4)}, Offset: ${faceDepthOffset.toFixed(2)}`);
    }

    // Blink detection remains optimized for MMD morphs
    if (mesh) {
        const leftOpen = (lm[159].y - lm[145].y) / (lm[33].x - lm[133].x);
        const blinkValue = Math.abs(leftOpen) < CONFIG.BLINK_THRESHOLD ? 1.0 : 0.0;
        const morphDict = mesh.morphTargetDictionary;
        if (morphDict) {
            ['まばたき', 'Blink', 'まばたき左', 'まばたき右'].forEach(name => {
                const idx = morphDict[name];
                if (idx !== undefined) mesh.morphTargetInfluences[idx] = blinkValue;
            });
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();

    if (helper && !isPaused) {
        helper.update(delta);
    }

    if (userEyePosition) {
        // --- Natural Parallax Logic ---
        const parallaxSensitivity = currentConfig.PARALLAX_SENSITIVITY;

        if (isDragging) {
            // Exclusive Mode: Face tracking paused, mouse controls camera
            camera.position.x = dragOffsetX;
            camera.position.y = CONFIG.CAMERA_POSITION.y + dragOffsetY;
        } else {
            // Normal Mode: Face tracking controls camera
            camera.position.x = userEyePosition.x * parallaxSensitivity;
            camera.position.y = (userEyePosition.y - CONFIG.EYE_OFFSET_Y) * parallaxSensitivity + CONFIG.CAMERA_POSITION.y;
        }

        // Z-axis (zoom) is always active regardless of drag state
        camera.position.z = targetCameraZ + faceDepthOffset;
        camera.position.z = THREE.MathUtils.clamp(camera.position.z, currentConfig.ZOOM_MIN_Z, currentConfig.ZOOM_MAX_Z * 1.5);

        camera.lookAt(CONFIG.CAMERA_LOOKAT.x, CONFIG.CAMERA_LOOKAT.y, CONFIG.CAMERA_LOOKAT.z);
    }

    renderer.render(scene, camera);

    // HUD & landmark overlay update (same rAF loop)
    updateHud();
    drawLandmarks();
}

init();

// ============================================================
// 🔄 Auto-Reload: Vite HMR でモデル/モーション変更を検知して再ロード
// ============================================================

/**
 * 現在ロード済みの MMD メッシュをシーンから除去し、
 * 最新のファイルで再ロードする
 */
async function reloadMMD() {
    if (isReloading) return;
    isReloading = true;

    console.log('%c[Auto-Reload] 🔄 MMD re-loading...', 'color:#00ffff;font-weight:bold');

    try {
        // 1. 旧モデルをシーン・helper から削除
        if (mesh) {
            helper.remove(mesh);
            scene.remove(mesh);
            mesh.traverse((obj) => {
                if (obj.isMesh) {
                    obj.geometry?.dispose();
                    const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
                    mats.forEach(m => m?.dispose());
                }
            });
            mesh = null;
        }

        // 2. 物理 helper をリセット
        helper = new MMDAnimationHelper({ sync: true, afterglow: 2.0, resetPhysicsOnLoop: true });

        // 3. クロックをリセット
        clock = new THREE.Clock();
        baseFaceDistance = null;  // 顔距離キャリブレーションもリセット

        // 4. サーバーから最新ファイル一覧を取得して再ロード
        const res = await fetch('/__mmd_assets');
        const assets = await res.json();

        // Models/ から最初の .pmx を、Motions/ から全 .vmd を使う
        const modelFile = (assets['Models'] || []).find(f => f.endsWith('.pmx'));
        const motionFiles = (assets['Motions'] || []).filter(f => f.endsWith('.vmd'));

        if (!modelFile) {
            console.warn('[Auto-Reload] ⚠ No .pmx file found in Models/');
            isReloading = false;
            return;
        }
        if (motionFiles.length === 0) {
            console.warn('[Auto-Reload] ⚠ No .vmd file found in Motions/');
            isReloading = false;
            return;
        }

        // キャッシュバスターを付与してブラウザキャッシュを回避
        const bust = `?t=${Date.now()}`;
        const modelUrl = modelFile + bust;
        const motionUrls = motionFiles.map(f => f + bust);

        console.log(`[Auto-Reload] Model : ${modelFile}`);
        console.log(`[Auto-Reload] Motion: ${motionFiles.join(', ')}`);

        await loadMMDAsync(modelUrl, motionUrls);
        console.log('%c[Auto-Reload] ✅ Done!', 'color:#00ff88;font-weight:bold');

    } catch (err) {
        console.error('[Auto-Reload] ❌ Failed:', err);
    } finally {
        isReloading = false;
    }
}

// Vite HMR: カスタムイベント受信
if (import.meta.hot) {
    import.meta.hot.on('mmd:asset-changed', (data) => {
        console.log(`[HMR] 📁 Asset changed: ${data.path} (${data.assetType})`);
        reloadMMD();
    });
}
