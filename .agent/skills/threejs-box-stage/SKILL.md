---
description: Three.jsで3Dボックス型ステージ（背面壁・側壁・天井）を構築し、パララックス効果で没入感を出す手順
---

# Three.js 3D Box Stage

Three.jsシーン内にボックス型の仮想空間（背面壁・左右壁・天井）を構築し、カメラの動きで壁が見え隠れする立体的な没入感を実現する手順。

## 効果

- カメラが**左右**に動く → 側面壁が見え隠れ → 「箱の中にいる」ような立体感
- カメラが**上下**に動く → 天井・床の境界が見える
- **ズームイン/アウト** → バックスクリーンとの距離感が変化
- **ウィンドウリサイズ** → ボックス寸法が自動再計算

## アーキテクチャ

```
         ┌─────────────── 天井 ───────────────┐
         │                                     │
    ┌────┤                                     ├────┐
    │左壁│        バックスクリーン（背面壁）        │右壁│
    │    │     ← ビューポート全体を覆うサイズ →     │    │
    │    │                                     │    │
    └────┤                                     ├────┘
         └──────────────────────────────────────┘
                         床面
                   ← カメラここ（手前）
```

## 実装手順

### Step 1: CONFIG定義

```javascript
const CONFIG = {
    CAMERA_FOV: 20,
    CAMERA_POSITION: { x: 0, y: 12, z: 75 },
    BOX_STAGE: {
        BACK_Z: -50,            // バックスクリーンのZ位置
        WALL_COLOR: 0x1a1a2e,   // 壁面の色
        WALL_OPACITY: 0.95,     // 壁面の不透明度
        DEPTH: 50               // 箱の奥行き（バックスクリーンから手前への長さ）
    }
};
```

### Step 2: バックスクリーンサイズの計算

バックスクリーンはカメラの初期位置から見たとき、ビューポート全体を覆うサイズにする:

```javascript
function calculateBackScreenSize() {
    const backZ = CONFIG.BOX_STAGE.BACK_Z;
    const camZ = CONFIG.CAMERA_POSITION.z;
    const distance = camZ - backZ;
    const fovRad = THREE.MathUtils.degToRad(CONFIG.CAMERA_FOV);

    const height = 2 * distance * Math.tan(fovRad / 2);
    const width = height * (window.innerWidth / window.innerHeight);

    return { width, height };
}
```

**数式:**
```
D (距離) = カメラZ位置 − バックスクリーンZ位置
height   = 2 × D × tan(FOV / 2)
width    = height × アスペクト比
```

### Step 3: ボックスステージの構築

```javascript
let boxStage = { back: null, left: null, right: null, ceiling: null };

function setupBoxStage(parentGroup) {
    const backZ = CONFIG.BOX_STAGE.BACK_Z;
    const depth = CONFIG.BOX_STAGE.DEPTH;
    const color = CONFIG.BOX_STAGE.WALL_COLOR;
    const opacity = CONFIG.BOX_STAGE.WALL_OPACITY;
    const { width: backW, height: backH } = calculateBackScreenSize();

    // 共通マテリアル
    const wallMat = new THREE.MeshStandardMaterial({
        color: color,
        transparent: true,
        opacity: opacity,
        side: THREE.DoubleSide,   // 箱の内側から見えるように両面描画
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
}
```

### Step 4: ウィンドウリサイズ時の再計算

```javascript
function updateBoxStageSize() {
    if (!boxStage.back) return;

    const backZ = CONFIG.BOX_STAGE.BACK_Z;
    const depth = CONFIG.BOX_STAGE.DEPTH;
    const { width: backW, height: backH } = calculateBackScreenSize();

    // バックスクリーン更新
    boxStage.back.geometry.dispose();
    boxStage.back.geometry = new THREE.PlaneGeometry(backW, backH);
    boxStage.back.position.set(0, backH / 2 - 0.1, backZ);

    // 左壁更新
    boxStage.left.geometry.dispose();
    boxStage.left.geometry = new THREE.PlaneGeometry(depth, backH);
    boxStage.left.position.set(-backW / 2, backH / 2 - 0.1, backZ + depth / 2);

    // 右壁更新
    boxStage.right.geometry.dispose();
    boxStage.right.geometry = new THREE.PlaneGeometry(depth, backH);
    boxStage.right.position.set(backW / 2, backH / 2 - 0.1, backZ + depth / 2);

    // 天井更新
    boxStage.ceiling.geometry.dispose();
    boxStage.ceiling.geometry = new THREE.PlaneGeometry(backW, depth);
    boxStage.ceiling.position.set(0, backH - 0.1, backZ + depth / 2);
}

// リサイズイベントに登録
window.addEventListener('resize', () => {
    // カメラ・レンダラーの更新後に呼ぶ
    updateBoxStageSize();
});
```

### Step 5: 使用例

```javascript
const scene = new THREE.Scene();
const roomGroup = new THREE.Group();

// 床面を追加
const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(200, 200),
    new THREE.MeshPhongMaterial({ color: 0x1a1a2e, transparent: true, opacity: 0.9 })
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.1;
floor.receiveShadow = true;
roomGroup.add(floor);

// ボックスステージを追加
setupBoxStage(roomGroup);

scene.add(roomGroup);
```

## カスタマイズ

### 壁面にテクスチャを適用
```javascript
const textureLoader = new THREE.TextureLoader();
const wallTexture = textureLoader.load('path/to/texture.jpg');
boxStage.back.material.map = wallTexture;
boxStage.back.material.needsUpdate = true;
```

### 壁面に動画を適用（バックスクリーン）
```javascript
const video = document.getElementById('bg-video');
const videoTexture = new THREE.VideoTexture(video);
videoTexture.colorSpace = THREE.SRGBColorSpace;
boxStage.back.material.map = videoTexture;
boxStage.back.material.color.setHex(0xffffff);  // テクスチャの色を活かす
boxStage.back.material.needsUpdate = true;
```

### 壁ごとに異なる色/テクスチャ
マテリアルは `.clone()` で生成しているため、各壁面のマテリアルは独立。個別に変更可能。

## パラメータ調整ガイド

| パラメータ | 効果 | 推奨範囲 |
|---|---|---|
| `BACK_Z` | バックスクリーンの奥行き位置。小さい=遠い | -80 〜 -20 |
| `DEPTH` | 箱の奥行き。大きい=視差効果が大きい | 20 〜 100 |
| `WALL_COLOR` | 壁面色。暗い色=シアター風 | 任意のhex値 |
| `WALL_OPACITY` | 壁面の不透明度。1.0=完全不透明 | 0.8 〜 1.0 |

## 注意事項

- `DoubleSide` はパフォーマンスに影響するが、箱の内側から壁を見るために必須
- `geometry.dispose()` をリサイズ時に呼ばないとメモリリークの原因になる
- バックスクリーンのサイズ計算はカメラの**初期位置**基準。ズームしてもビューポートを覆い続ける保証はない（意図的な仕様）
