---
description: MediaPipe Face Meshによる顔トラッキングでThree.jsカメラをリアルタイム制御する手順（パララックス・ズーム・まばたき）
---

# Face Tracking Camera Control

MediaPipe Face Meshで顔ランドマークを検出し、Three.jsカメラのパララックス（視差）効果とズームをリアルタイム制御する手順。

## 前提条件

### 必要なパッケージ
```json
{
  "dependencies": {
    "@mediapipe/face_mesh": "^0.4.1633559619",
    "@mediapipe/camera_utils": "^0.3.1675466862",
    "three": "^0.160.0"
  }
}
```

### HTML側の準備
```html
<!-- カメラ映像表示用 -->
<video id="input_video" playsinline></video>
```

## アーキテクチャ概要

```
Webカメラ
  ↓ getUserMedia
video要素
  ↓ requestAnimationFrame
MediaPipe Face Mesh
  ↓ onResults
ランドマーク解析
  ├── 鼻先 (#1)          → パララックス (カメラXY)
  ├── 目の内隅 (#133,#362) → ズーム (カメラZ)
  └── 目の開閉 (#159,#145等) → まばたきモーフ
  ↓
Three.js カメラ位置更新
```

## 実装手順

### Step 1: CONFIG定義

```javascript
const CONFIG = {
    // カメラ基本位置
    CAMERA_POSITION: { x: 0, y: 12, z: 75 },
    CAMERA_LOOKAT: { x: 0, y: 10, z: 0 },

    // トラッキング感度
    MONITOR_WIDTH: 0.5,
    EYE_SCALE_X: 20.0,        // X軸パララックス感度
    EYE_SCALE_Y: 18.0,        // Y軸パララックス感度
    EYE_OFFSET_Y: 14.0,       // Y方向のベースオフセット
    EYE_POS_Z: 30.0,          // Z方向の初期位置
    LERP_SPEED: 0.25,         // 0-1: 高いほど即応的、低いほど滑らか
    BLINK_THRESHOLD: 0.08,    // まばたき判定閾値

    // カメラプロファイル（物理カメラ/仮想カメラで自動切替）
    PROFILES: {
        NORMAL: {              // 物理Webカメラ用
            ZOOM_MIN_Z: 10,
            ZOOM_MAX_Z: 150,
            FACE_DEPTH_FACTOR: 1200.0,
            FACE_DEPTH_LERP: 0.1,
            PARALLAX_SENSITIVITY: 7.5
        },
        VTS: {                 // VTube Studio等の仮想カメラ用
            ZOOM_MIN_Z: 10,
            ZOOM_MAX_Z: 300,
            FACE_DEPTH_FACTOR: 4500.0,
            FACE_DEPTH_LERP: 0.08,
            PARALLAX_SENSITIVITY: 18.0
        }
    },
    WHEEL_SENSITIVITY: 0.15   // マウスホイールズーム感度
};
```

### Step 2: グローバル変数

```javascript
let currentConfig = { ...CONFIG.PROFILES.NORMAL };
let userEyePosition = new THREE.Vector3(0, CONFIG.EYE_OFFSET_Y, CONFIG.EYE_POS_Z);
let targetCameraZ = CONFIG.CAMERA_POSITION.z;
let faceDepthOffset = 0;
let baseFaceDistance = null;  // 初回キャリブレーション値

// マウスドラッグ（排他制御用）
let isDragging = false;
let dragOffsetX = 0, dragOffsetY = 0;
let lastMouseX = 0, lastMouseY = 0;
const DRAG_SENSITIVITY = 0.3;
```

### Step 3: カメラデバイス管理

```javascript
let availableVideoDevices = [];
let currentDeviceIndex = 0;
let currentStream = null;

async function initCameraDevices() {
    const devices = await navigator.mediaDevices.enumerateDevices();
    availableVideoDevices = devices.filter(d => d.kind === 'videoinput');

    // 物理カメラ優先で選択（仮想カメラを除外）
    const virtualKeywords = [
        'vtubestudio', 'vtube studio', 'obs', 'unity',
        'webcam 7', 'splitcam', 'manycam', 'virtual camera'
    ];
    let idx = availableVideoDevices.findIndex(d => {
        const label = d.label.toLowerCase();
        return label !== '' && !virtualKeywords.some(kw => label.includes(kw));
    });

    // フォールバック：VTube Studio仮想カメラ → 最初のデバイス
    if (idx === -1) {
        idx = availableVideoDevices.findIndex(d => {
            const label = d.label.toLowerCase();
            return label.includes('vtubestudio') || label.includes('vtube studio');
        });
    }
    currentDeviceIndex = idx !== -1 ? idx : 0;
}
```

### Step 4: カメラ起動＋プロファイル自動切替

```javascript
async function startCamera(selectedDevice) {
    if (!selectedDevice) return;
    const video = document.getElementById('input_video');

    // 既存ストリーム停止
    if (currentStream) {
        currentStream.getTracks().forEach(t => t.stop());
    }

    // プロファイル自動切替
    const label = selectedDevice.label.toLowerCase();
    const isVirtual = ['vtubestudio', 'vtube studio', 'nizima', '3tene', 'virtual camera']
        .some(kw => label.includes(kw));
    currentConfig = isVirtual ? { ...CONFIG.PROFILES.VTS } : { ...CONFIG.PROFILES.NORMAL };

    const constraints = {
        video: {
            deviceId: { exact: selectedDevice.deviceId },
            width: { ideal: 1280 },
            height: { ideal: 720 }
        }
    };

    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = currentStream;
    await video.play();
}
```

### Step 5: MediaPipe Face Mesh 初期化

```javascript
import { FaceMesh } from '@mediapipe/face_mesh';

const faceMesh = new FaceMesh({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});

faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
});

faceMesh.onResults(onFaceResults);

// フレーム処理ループ
const video = document.getElementById('input_video');
async function processFrame() {
    if (video && !video.paused && !video.ended && video.readyState >= 3 && video.videoWidth > 0) {
        try {
            await faceMesh.send({ image: video });
        } catch (err) {
            // 一時的なエラーは無視
        }
    }
    requestAnimationFrame(processFrame);
}
processFrame();
```

### Step 6: トラッキング結果の処理

```javascript
function onFaceResults(results) {
    if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
        updateTracking(results.multiFaceLandmarks[0]);
    }
}

function updateTracking(lm) {
    // === パララックス（XY移動） ===
    const nose = lm[1];  // 鼻先
    const rawX = (nose.x - 0.5);
    const rawY = -(nose.y - 0.5);
    const targetX = rawX * CONFIG.MONITOR_WIDTH * CONFIG.EYE_SCALE_X;
    const targetY = rawY * (CONFIG.MONITOR_WIDTH / window.innerWidth * window.innerHeight) * CONFIG.EYE_SCALE_Y;

    userEyePosition.x = THREE.MathUtils.lerp(userEyePosition.x, targetX, CONFIG.LERP_SPEED);
    userEyePosition.y = THREE.MathUtils.lerp(userEyePosition.y, targetY + CONFIG.EYE_OFFSET_Y, CONFIG.LERP_SPEED);

    // === ズーム（Z移動） ===
    const p1 = lm[133];  // 左目内隅
    const p2 = lm[362];  // 右目内隅
    const currentDist = Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));

    if (baseFaceDistance === null) {
        baseFaceDistance = currentDist;  // 初回キャリブレーション
    }

    const depthChange = (currentDist - baseFaceDistance) * currentConfig.FACE_DEPTH_FACTOR;
    faceDepthOffset = THREE.MathUtils.lerp(faceDepthOffset, -depthChange, currentConfig.FACE_DEPTH_LERP);

    // === まばたき検出（オプション：MMDモーフ用） ===
    // mesh にMMDモデルのメッシュが入っている場合
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
```

### Step 7: マウス排他制御（ドラッグ中は顔トラッキング一時停止）

```javascript
// mousedown → ドラッグ開始（顔トラッキング一時停止）
renderer.domElement.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
        isDragging = true;
        lastMouseX = e.clientX;
        lastMouseY = e.clientY;
        renderer.domElement.style.cursor = 'grabbing';
    }
});

// mousemove → ドラッグ中のカメラ移動
window.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    dragOffsetX += (e.clientX - lastMouseX) * DRAG_SENSITIVITY;
    dragOffsetY -= (e.clientY - lastMouseY) * DRAG_SENSITIVITY;
    lastMouseX = e.clientX;
    lastMouseY = e.clientY;
});

// mouseup → ドラッグ終了（顔トラッキング復帰、オフセットリセット）
window.addEventListener('mouseup', (e) => {
    if (e.button === 0 && isDragging) {
        isDragging = false;
        dragOffsetX = 0;
        dragOffsetY = 0;
        renderer.domElement.style.cursor = 'default';
    }
});

// マウスホイール → 手動ズーム（常時有効）
window.addEventListener('wheel', (e) => {
    targetCameraZ += e.deltaY * CONFIG.WHEEL_SENSITIVITY;
    targetCameraZ = THREE.MathUtils.clamp(targetCameraZ, currentConfig.ZOOM_MIN_Z, currentConfig.ZOOM_MAX_Z);
}, { passive: true });
```

### Step 8: animate() 内でのカメラ位置反映

```javascript
function animate() {
    requestAnimationFrame(animate);

    if (isDragging) {
        // ドラッグモード：マウスでXY制御
        camera.position.x = dragOffsetX;
        camera.position.y = CONFIG.CAMERA_POSITION.y + dragOffsetY;
    } else {
        // 通常モード：顔トラッキングでXY制御
        const s = currentConfig.PARALLAX_SENSITIVITY;
        camera.position.x = userEyePosition.x * s;
        camera.position.y = (userEyePosition.y - CONFIG.EYE_OFFSET_Y) * s + CONFIG.CAMERA_POSITION.y;
    }

    // Z軸（ズーム）は常時有効
    camera.position.z = targetCameraZ + faceDepthOffset;
    camera.position.z = THREE.MathUtils.clamp(
        camera.position.z,
        currentConfig.ZOOM_MIN_Z,
        currentConfig.ZOOM_MAX_Z * 1.5
    );

    camera.lookAt(CONFIG.CAMERA_LOOKAT.x, CONFIG.CAMERA_LOOKAT.y, CONFIG.CAMERA_LOOKAT.z);
    renderer.render(scene, camera);
}
```

## ランドマーク番号リファレンス

| 番号 | 部位 | 用途 |
|---|---|---|
| #1 | 鼻先 | パララックス（XY移動の基準） |
| #133 | 左目内隅 | ズーム（目の間隔計算） |
| #362 | 右目内隅 | ズーム（目の間隔計算） |
| #159 | 左目上まぶた | まばたき検出 |
| #145 | 左目下まぶた | まばたき検出 |
| #33 | 左目外隅 | まばたき正規化用 |

## カスタマイズのポイント

### パララックスが弱い/強い場合
- `PARALLAX_SENSITIVITY` を調整（デフォルト: 7.5）
- 高い値 = 大きなカメラ移動 = 強いパララックス

### ズームが敏感すぎる/鈍い場合
- `FACE_DEPTH_FACTOR` を調整（デフォルト: 1200）
- `FACE_DEPTH_LERP` を調整（低い=滑らかだが遅い、高い=即応的）

### VTube Studioとの連携
- 仮想カメラは物理カメラと挙動が異なるため、専用プロファイル（VTS）を用意
- VTSの動きの大きさに合わせて感度と範囲を拡大

## 注意事項

- カメラのアクセス許可が必要（HTTPS環境またはlocalhost）
- VTube Studio等が物理カメラを占有中はブラウザから同じカメラにアクセス不可 → 仮想カメラを使用
- `faceMesh.send()` は処理が重いため、動画の準備が整ってから送信すること（`readyState >= 3`）
- ブラウザは Chrome/Edge を推奨（MediaPipeがWebAssemblyを使用）
