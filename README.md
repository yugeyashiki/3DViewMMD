# 🎭 MMD Web 3D Viewer

> ブラウザ上でMMDモデルを3D表示し、Webカメラの顔トラッキングでリアルタイムにカメラを操作するインタラクティブビューアー

**[🌐 Live Demo](https://yugeyashiki.github.io/3DViewMMD/)**

---

## 📖 概要 / Overview

| | |
|---|---|
| **言語** | 日本語 / English |
| **動作環境** | Chrome / Edge（最新版推奨） |
| **インストール** | 不要（ブラウザのみで動作） |
| **プライバシー** | カメラ映像は端末内のみで処理・外部送信なし |

---

## ✨ 主な機能

### 🎯 顔トラッキングによるカメラ制御
- **パララックス効果** — 顔の左右・上下移動でカメラが連動し、立体感のある視差効果を生成
- **奥行きズーム** — 顔の前後移動（目の間の距離）でカメラが自動ズーム
- **VTube Studio 対応** — VTS 仮想カメラを接続すると高感度モード（VTS プロファイル）に自動切替

### 🎬 MMD モデル・モーション再生
- **PMX モデル**をフォルダごとドロップ（テクスチャ込みで自動解決）
- **VMD モーション**を複数同時読み込み可能
- 物理演算なしで軽快に動作

### 🎥 3D ボックスステージ
- バックスクリーン・左右壁・天井で構成される3D空間
- カメラが動くと壁が見え隠れし、没入感のある演出を実現

### 📷 カメラ管理
- 接続されたカメラを自動列挙・物理カメラを優先選択
- UIボタン「📷 ｶﾒﾗ切替」でカメラをその場で切替

---

## 🚀 使い方

### ブラウザで開く（推奨）

[Live Demo](https://yugeyashiki.github.io/3DViewMMD/) にアクセスするだけで動作します。Node.js 等のインストールは不要です。

### 手順

1. **PMX モデルフォルダ**を左のドロップゾーンにドロップ（または「クリックして選択」）  
   例: `MyModel/` フォルダ（`model.pmx` + `textures/` を含む）
2. **VMD モーションファイル**を右のドロップゾーンにドロップ
3. **「▶ 再生開始」** ボタンをクリック
4. カメラアクセス許可ダイアログが表示されたら「許可する」をクリック
5. Webカメラに顔を向けると、カメラが顔の動きに追従します

---

## ⌨️ キーボードショートカット

| キー | 機能 |
|---|---|
| `Space` | アニメーションの一時停止 / 再開 |
| `H` | フェイストラッキング HUD の表示 / 非表示 |

---

## 🖱️ マウス操作

| 操作 | 機能 |
|---|---|
| 左クリック + ドラッグ | カメラアングルを手動操作（離すと顔トラッキングに自動復帰） |
| マウスホイール | 手動ズーム |

---

## 🔧 ローカル開発

```bash
# 依存関係のインストール
npm install

# 開発サーバー起動
npm run dev
```

ブラウザで `http://localhost:5173` にアクセスします。

`Models/` や `Motions/` にファイルを配置すると、変更を検知して自動リロードされます（HMR）。

---

## 🛠️ 技術スタック

| カテゴリ | 技術 |
|---|---|
| 3D レンダリング | [Three.js](https://threejs.org/) v0.160 |
| MMD 読込 | MMDLoader / MMDAnimationHelper (Three.js addon) |
| 顔トラッキング | [MediaPipe Face Mesh](https://google.github.io/mediapipe/solutions/face_mesh) |
| ビルドツール | [Vite](https://vitejs.dev/) v5 |
| CI/CD | GitHub Actions → GitHub Pages |

---

## ⚠️ 注意事項

- **Chrome / Edge 推奨** — MediaPipe は WebAssembly を使用するため、対応ブラウザが必要です
- **カメラの排他使用** — VTube Studio が物理カメラを占有している場合は、VTS の仮想カメラ（VTubeStudioCam）を使用してください
- **モデルデータについて** — PMX / VMD ファイルは著作権があります。各モデル・モーションの配布規約を必ず確認してください
- **音声** — 背景動画はミュートで再生されます

---

## 📜 ライセンス

MIT License — コード自体は自由に利用できます。  
使用する MMD モデル・モーション・動画素材については、各素材の規約に従ってください。

---

---

# 🎭 MMD Web 3D Viewer

> An interactive browser-based MMD model viewer with real-time face-tracking camera control via webcam.

**[🌐 Live Demo](https://yugeyashiki.github.io/3DViewMMD/)**

---

## 📖 Overview

| | |
|---|---|
| **Language** | Japanese / English |
| **Browser** | Chrome / Edge (latest recommended) |
| **Installation** | None required — runs entirely in the browser |
| **Privacy** | Camera feed is processed locally only, never sent to any server |

---

## ✨ Features

### 🎯 Face Tracking Camera Control
- **Parallax effect** — Camera follows your head movement (left/right/up/down) for a natural 3D depth illusion
- **Depth zoom** — Camera zooms in/out based on the inter-eye distance (how close you are to the camera)
- **VTube Studio support** — Automatically switches to a high-sensitivity VTS profile when a virtual camera is detected

### 🎬 MMD Model & Motion Playback
- Drag & drop a **PMX model folder** (textures resolved automatically)
- Load **multiple VMD motion files** simultaneously
- Lightweight rendering without physics simulation

### 🎥 3D Box Stage
- A virtual room with a back screen, side walls, and ceiling
- Walls appear/disappear as the camera moves, creating an immersive depth effect

### 📷 Camera Management
- Auto-detects connected cameras, prioritizing physical cameras
- Switch cameras on-the-fly with the "📷 Switch Camera" button

---

## 🚀 How to Use

### Open in Browser (Recommended)

Just visit the [Live Demo](https://yugeyashiki.github.io/3DViewMMD/) — no installation needed.

### Steps

1. Drop your **PMX model folder** onto the left drop zone  
   (e.g. `MyModel/` containing `model.pmx` + `textures/`)
2. Drop your **VMD motion file(s)** onto the right drop zone
3. Click **"▶ Start"**
4. Click "Allow" in the camera permission dialog
5. Look at your webcam — the camera will follow your face movements

---

## ⌨️ Keyboard Shortcuts

| Key | Function |
|---|---|
| `Space` | Pause / Resume animation |
| `H` | Toggle face tracking HUD |

---

## 🖱️ Mouse Controls

| Action | Function |
|---|---|
| Left-click + Drag | Manual camera angle control (auto-returns to face tracking on release) |
| Mouse Wheel | Manual zoom |

---

## 🔧 Local Development

```bash
# Install dependencies
npm install

# Start dev server
npm run dev
```

Open `http://localhost:5173` in your browser.

Files placed in `Models/` or `Motions/` are hot-reloaded automatically (HMR).

---

## 🛠️ Tech Stack

| Category | Technology |
|---|---|
| 3D Rendering | [Three.js](https://threejs.org/) v0.160 |
| MMD Loading | MMDLoader / MMDAnimationHelper (Three.js addon) |
| Face Tracking | [MediaPipe Face Mesh](https://google.github.io/mediapipe/solutions/face_mesh) |
| Build Tool | [Vite](https://vitejs.dev/) v5 |
| CI/CD | GitHub Actions → GitHub Pages |

---

## ⚠️ Notes

- **Chrome / Edge required** — MediaPipe uses WebAssembly; unsupported browsers may not work
- **Camera exclusivity** — If VTube Studio occupies your physical camera, use the VTS virtual camera (VTubeStudioCam) instead
- **Model data** — PMX / VMD files are subject to copyright. Always check the terms of each model and motion
- **Audio** — Background video plays muted

---

## 📜 License

MIT License — The source code is freely usable.  
Please follow the individual licenses of any MMD models, motions, or video assets you use.
