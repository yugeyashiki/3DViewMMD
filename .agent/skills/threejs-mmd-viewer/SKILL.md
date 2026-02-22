---
description: Three.jsでMMD（PMX）モデルとVMDモーションを読み込んで3D表示するセットアップ手順
---

# Three.js MMD Viewer Setup

Three.jsを使用してMMDモデル（PMX形式）とモーション（VMD形式）をブラウザ上でレンダリングするための手順。

## 前提条件

### 必要なパッケージ
```json
{
  "dependencies": {
    "three": "^0.160.0",
    "mmd-parser": "^1.0.4"
  },
  "devDependencies": {
    "vite": "^5.0.0"
  }
}
```

### ディレクトリ構成
```
ProjectRoot/
├── Models/
│   ├── *.pmx        # MMDモデル
│   └── *.png        # テクスチャ画像（モデルと同一ディレクトリ必須）
├── Motions/
│   └── *.vmd        # モーションファイル（複数可）
├── index.html
└── script.js
```

## 実装手順

### Step 1: インポート

```javascript
import * as THREE from 'three';
import { MMDLoader } from 'three/addons/loaders/MMDLoader.js';
import { MMDAnimationHelper } from 'three/addons/animation/MMDAnimationHelper.js';
```

### Step 2: CONFIG定義

以下のパラメータを`CONFIG`オブジェクトにまとめる:

```javascript
const CONFIG = {
    CAMERA_FOV: 20,             // 視野角（度）。狭いほど望遠風
    CAMERA_NEAR: 0.1,
    CAMERA_FAR: 1000.0,
    CAMERA_POSITION: { x: 0, y: 12, z: 75 },
    CAMERA_LOOKAT: { x: 0, y: 10, z: 0 },
    BACKGROUND_COLOR: 0x333333,
    LIGHT_INTENSITY: 1.5,       // DirectionalLight強度
    AMBIENT_INTENSITY: 0.8,     // AmbientLight強度
    MMD: {
        MODEL_PATH: './Models/<モデルファイル>.pmx',
        MOTION_PATHS: [
            './Motions/<モーション1>.vmd',
            './Motions/<モーション2>.vmd'   // 複数指定可能
        ],
        USE_PHYSICS: false       // 物理演算（true=髪揺れ等あり、重い）
    }
};
```

### Step 3: シーン・カメラ・レンダラー構築

```javascript
// シーン
const scene = new THREE.Scene();
scene.background = new THREE.Color(CONFIG.BACKGROUND_COLOR);

// カメラ
const camera = new THREE.PerspectiveCamera(
    CONFIG.CAMERA_FOV,
    window.innerWidth / window.innerHeight,
    CONFIG.CAMERA_NEAR,
    CONFIG.CAMERA_FAR
);
camera.position.set(CONFIG.CAMERA_POSITION.x, CONFIG.CAMERA_POSITION.y, CONFIG.CAMERA_POSITION.z);
camera.lookAt(CONFIG.CAMERA_LOOKAT.x, CONFIG.CAMERA_LOOKAT.y, CONFIG.CAMERA_LOOKAT.z);

// レンダラー
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(window.devicePixelRatio);
renderer.shadowMap.enabled = true;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);
```

### Step 4: ライティング（4灯構成推奨）

```javascript
// 1. 半球光 — 上からの自然な環境光
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1.0);
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

// 2. 平行光 — メインライト（影あり）
const dirLight = new THREE.DirectionalLight(0xffffff, CONFIG.LIGHT_INTENSITY);
dirLight.position.set(5, 20, 10);
dirLight.castShadow = true;
scene.add(dirLight);

// 3. 環境光 — 全体のフィル
const ambient = new THREE.AmbientLight(0xffffff, CONFIG.AMBIENT_INTENSITY);
scene.add(ambient);

// 4. 点光源 — モデル付近の補助
const pointLight = new THREE.PointLight(0xffffff, 1.0);
pointLight.position.set(0, 15, 5);
scene.add(pointLight);
```

### Step 5: 床面の構築

```javascript
const floorGeo = new THREE.PlaneGeometry(200, 200);
const floorMat = new THREE.MeshPhongMaterial({
    color: 0x1a1a2e,
    transparent: true,
    opacity: 0.9
});
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.1;
floor.receiveShadow = true;
scene.add(floor);

// グリッド（デバッグ用、不要なら visible: false）
const grid = new THREE.GridHelper(100, 40, 0x555555, 0x222222);
scene.add(grid);
```

### Step 6: MMDモデル＋モーション読込（非同期）

```javascript
const helper = new MMDAnimationHelper({
    sync: true,
    afterglow: 2.0,
    resetPhysicsOnLoop: true
});

async function loadMMDAsync(modelUrl, motionUrls) {
    return new Promise((resolve, reject) => {
        const loader = new MMDLoader();
        loader.loadWithAnimation(modelUrl, motionUrls, (mmd) => {
            const mesh = mmd.mesh;

            // テクスチャ欠落対策
            mesh.traverse((obj) => {
                if (obj.isMesh) {
                    obj.castShadow = true;
                    obj.receiveShadow = true;
                    const materials = Array.isArray(obj.material) ? obj.material : [obj.material];
                    materials.forEach((mat) => {
                        if (!mat.map) {
                            mat.color.setHex(0xcccccc);  // テクスチャなし→グレー
                        }
                        mat.emissiveIntensity = 0.2;     // 若干の自己発光
                    });
                }
            });

            scene.add(mesh);
            helper.add(mesh, {
                animation: mmd.animation,
                physics: CONFIG.MMD.USE_PHYSICS
            });
            resolve(mesh);
        },
        (xhr) => {
            if (xhr.lengthComputable) {
                console.log(`Loading: ${Math.round(xhr.loaded / xhr.total * 100)}%`);
            }
        },
        (error) => reject(error));
    });
}
```

### Step 7: アニメーションループ

```javascript
const clock = new THREE.Clock();

function animate() {
    requestAnimationFrame(animate);
    const delta = clock.getDelta();
    helper.update(delta);
    renderer.render(scene, camera);
}

// 起動
await loadMMDAsync(CONFIG.MMD.MODEL_PATH, CONFIG.MMD.MOTION_PATHS);
animate();
```

### Step 8: リサイズ対応

```javascript
window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
});
```

## 一時停止/再開の実装

```javascript
let isPaused = false;

window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();
        isPaused = !isPaused;
    }
});

// animate() 内で:
if (helper && !isPaused) {
    helper.update(delta);
}
```

## パラメータ調整ガイド

| パラメータ | 効果 | 推奨範囲 |
|---|---|---|
| `CAMERA_FOV` | 狭い=望遠風（圧縮効果）、広い=広角風 | 15-40 |
| `CAMERA_POSITION.z` | 大きい=引き、小さい=寄り | 30-100 |
| `CAMERA_LOOKAT.y` | カメラの注視高さ（モデルの胸～顔） | 8-15 |
| `LIGHT_INTENSITY` | メインライト強度 | 0.5-3.0 |
| `USE_PHYSICS` | 髪揺れ・スカート等の物理演算 | false=軽量 |

## 注意事項

- テクスチャ画像（PNG）はPMXファイルと**同一ディレクトリ**に配置すること
- VMDモーションは複数指定可能（例：体モーション + 表情/リップモーション）
- 物理演算を有効にすると負荷が大幅に増加するため、低スペック環境ではfalse推奨
- `afterglow: 2.0` はモーションブレンドの残光時間。ループ切替の滑らかさに影響
