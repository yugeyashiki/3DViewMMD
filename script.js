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
        MODEL_PATH: './Models/model.pmx',
        MOTION_PATHS: [
            './Motions/ビリ モーション_01.vmd',
            './Motions/ビリ 表情・リップ_01.vmd'
        ],
        USE_PHYSICS: false
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

// --- MediaPipe ---
let faceMesh;
let cameraInput;
let userEyePosition = new THREE.Vector3(0, CONFIG.EYE_OFFSET_Y, CONFIG.EYE_POS_Z);
const videoElement = document.getElementById('input_video');

// --- Background Video ---
let bgVideo, bgTexture, bgPlane;

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
        // setupRoom
        setupRoom();

        // Background Video Setup
        setupVideoBackground();

        camera.position.set(CONFIG.CAMERA_POSITION.x, CONFIG.CAMERA_POSITION.y, CONFIG.CAMERA_POSITION.z);
        camera.lookAt(CONFIG.CAMERA_LOOKAT.x, CONFIG.CAMERA_LOOKAT.y, CONFIG.CAMERA_LOOKAT.z);

        // MMD Animation Helper
        helper = new MMDAnimationHelper({ sync: true, afterglow: 2.0, resetPhysicsOnLoop: true });

        // Load MMD
        await loadMMDAsync(CONFIG.MMD.MODEL_PATH, CONFIG.MMD.MOTION_PATHS);
        await setupFaceMesh();

        // Sync: Reset clock, start animation, delay video by 1 second
        if (bgVideo) bgVideo.currentTime = 0;
        clock = new THREE.Clock();
        animate();
        setTimeout(() => startBackgroundVideo(), 1000);

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

function setupRoom() {
    gridRoom = new THREE.Group();
    const floorGeo = new THREE.PlaneGeometry(200, 200);
    const floorMat = new THREE.MeshPhongMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.9 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.1;
    floor.receiveShadow = true;
    gridRoom.add(floor);

    const grid = new THREE.GridHelper(100, 40, 0x555555, 0x222222);
    grid.visible = true; // Visible for debugging
    gridRoom.add(grid);

    scene.add(gridRoom);
}

function onWindowResize() {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
}

function setupVideoBackground() {
    bgVideo = document.getElementById('bg-video');
    if (!bgVideo) return;

    bgTexture = new THREE.VideoTexture(bgVideo);
    bgTexture.colorSpace = THREE.SRGBColorSpace;

    // Create a medium-sized plane behind the model
    // Adjusted to be about half the previous size (80x45) for better parallax
    const geometry = new THREE.PlaneGeometry(80, 45);
    const material = new THREE.MeshBasicMaterial({ map: bgTexture, side: THREE.DoubleSide });
    bgPlane = new THREE.Mesh(geometry, material);

    // Position it far back and adjust height to be centered (y = half of height)
    bgPlane.position.set(0, 22.5, -45);
    scene.add(bgPlane);

    debugLog('Background video texture initialized.');
}

async function startBackgroundVideo() {
    if (bgVideo) {
        try {
            await bgVideo.play();
            debugLog('Background video playback started.');
        } catch (err) {
            console.warn('Video play failed (needs interaction):', err);
        }
    }
}

async function loadMMDAsync(modelUrl, motionUrls) {
    return new Promise((resolve, reject) => {
        const loader = new MMDLoader();
        debugLog('🎬 MMD Loading Start:', modelUrl, motionUrls);

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
                        console.log(`Mesh: ${obj.name} | Material[${idx}]: ${mat.name}`);
                        console.log(`  - Texture (map): ${mat.map ? '✅ Loaded' : '❌ MISSING (Model will be dark)'}`);

                        // Force visibility if textures are missing
                        if (!mat.map) {
                            mat.color.setHex(0xcccccc); // Set to grey to see the model
                        }
                        mat.emissiveIntensity = 0.2; // Add slight self-glow for visibility
                    });
                }
            });
            console.log('--------------------------------------');

            scene.add(mesh);

            helper.add(mesh, {
                animation: mmd.animation,
                physics: CONFIG.MMD.USE_PHYSICS
            });

            debugLog('✅ MMD Loaded successfully');
            resolve();
        },
            (xhr) => {
                if (xhr.lengthComputable) {
                    const percent = Math.round(xhr.loaded / xhr.total * 100);
                    debugLog(`Progress: ${percent}%`);
                }
            },
            (error) => {
                console.error('❌ MMD Loading Error:', error);
                reject(new Error('MMDの読み込みに失敗しました。ファイルパスやテクスチャの欠落を確認してください。'));
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
            // H Key: Toggle camera window visibility
            if (e.key.toLowerCase() === 'h') {
                const container = document.getElementById('video-container');
                if (container) {
                    const isHidden = container.style.display === 'none';
                    container.style.display = isHidden ? 'block' : 'none';
                    debugLog(`Camera window ${isHidden ? 'shown' : 'hidden'} via H key`);
                }
            }
            // Space Key: Pause/Resume animation & background video
            if (e.code === 'Space') {
                e.preventDefault();
                isPaused = !isPaused;
                const bgVideo = document.getElementById('bg-video');
                if (bgVideo) {
                    isPaused ? bgVideo.pause() : bgVideo.play();
                }
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

        // Camera window is hidden by default. Press 'H' to toggle visibility.
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
    // Throttled logging for detection status
    if (DEBUG_MODE) {
        if (!window._lastLogTime) window._lastLogTime = 0;
        const now = Date.now();
        if (now - window._lastLogTime > 2000) {
            if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
                console.log('[FaceMesh] Face detected! Tracking active.');
            } else {
                console.warn('[FaceMesh] Camera is on, but NO face detected. Check video preview.');
            }
            window._lastLogTime = now;
        }
    }

    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        const landmarks = results.multiFaceLandmarks[0];
        updateTracking(landmarks);
    }
}

function updateTracking(lm) {
    const nose = lm[1];

    // Normalized screen offset (-0.5 to 0.5)
    const rawX = (nose.x - 0.5);
    const rawY = -(nose.y - 0.5);

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
}

init();
