# プロジェクト進捗・課題・仕様書 (Process Plan)

## 1. 現状の進捗 (Current Progress)

### 1.1 3Dモデル表示とアニメーション (3D Model & Animation)
- **VRMモデル読み込み**:
  - `loadVRMAndFBX` 関数により、VRMモデル（`kamuro.vrm`）の読み込みに成功。
  - テクスチャ表示の問題（真っ黒になる現象）は、適切に照明（DirectionalLight, AmbientLight）を追加することで解決済み。
  - レンダリング順序 (`renderOrder = 999`) とフラスタムカリング無効化 (`frustumCulled = false`) により、表示の安定性を確保。

- **FBXアニメーションのリターゲティング**:
  - `loadFBX` 関数でFBXファイル（`dance.fbx`）を読み込み可能。
  - `retargetFBX` 関数にて、Mixamo形式のボーンをVRMのHumanoidボーンにマッピング。
  - **ボーン回転の修正**:
    - **Hips**: Y軸180度回転により体の向きを修正。
    - **UpperLeg (太もも)**: X軸-180度回転 + Z軸データ反転により、股関節のねじれを解消。
    - **LowerLeg (すね)**: X軸+90度回転 + X/Y軸反転により、膝の向きを修正。
    - **Foot/Toe (足/つま先)**: X軸-90度回転により、足の接地角度を修正。
  - **不要なトラックの削除**:
    - 腕（Arm/Hand/Shoulder）のトラックは除外（Freeze）し、足の動きのみ適用する仕様に変更可能（コード上は除外ロジックあり）。

### 1.2 フェイストラッキング (Face Tracking)
- **MediaPipe FaceMesh**:
  - ウェブカメラ映像からユーザーの顔ランドマークを取得。
  - **視線追従 (Eye Contact)**: 鼻の位置に基づき、キャラクターの視線をユーザーのカメラ位置に追従させる (`updateEye`)。
  - **まばたき同期 (Blink Sync)**: 目の開き具合を検知し、VRMモデルの表情（`blink_l`, `blink_r`）に反映 (`updateExpr`)。

### 1.3 リファクタリング完了 (Refactoring) - 🆕 2026-02-07
- **パフォーマンス最適化**: `animate` 関数の冗長なセッター削除
- **セキュリティ修正**: カメラ同意UI & エラーハンドリング実装
- **メモリリーク修正**: クリーンアップ処理と `skeletonHelper` の適切な破棄
- **デバッグコード整理**: 不要なログ削除、`debugLog` 関数導入
- **マジックナンバー定数化**: `CONFIG` オブジェクト導入

### 1.4 ボーンアニメーション修正 (Bone Animation Fixes) - 🆕 2026-02-07
- **腕のアニメーション有効化**: arm/hand/shoulder のフリーズ解除
- **腕の回転補正**: 
  - 左腕 (Left): Y軸+90度
  - 右腕 (Right): Y軸-90度
  - 左右別判定ロジック (`nameLower.endsWith('arml')`) を実装
- **カメラ顔追跡**: `animate()` 関数にカメラ位置追跡を実装（`userEyePosition` 連動）
- **SkeletonHelper削除**: ボーン表示を本番環境から削除

### 1.5 シーン構築 (Scene Setup)
- **環境**:
  - グリッドヘルパーと床面（ShadowMaterial）を配置し、空間の基準を作成。
  - 背景色は黒（`0x000000`）。
- **カメラ**:
  - 初期位置 `(0, 1.0, 6.0)` で全身が収まるように設定。
  - ウィンドウリサイズに対応。

---

## 2. 現在の課題 (Current Issues & Challenges)

### 2.1 コードの整理 (Code Optimization)
- `script.js` 内にデバッグ用のログ出力（`console.log`）やコメントアウトされた試行錯誤の痕跡（古いボーン補正ロジック、削除されたデバッグオブジェクトのコードなど）が多数残っている。
- 可読性と保守性を向上させるため、リファクタリングが必要。

### 2.2 アニメーションの微調整 (Animation Tuning)
- モデルやFBXデータによっては、現在のボーン回転補正値（ハードコードされたクォータニオン操作）が最適でない場合がある。
- より汎用的なリターゲティングロジックへの移行、または設定ファイル化を検討。

### 2.3 前髪の灰色影問題 (Bangs Gray Shadow Issue) - 🆕 2026-02-07
- **症状**: 前髪部分に灰色の影のようなものが表示される
- **調査結果**:
  - `aozame` メッシュは非表示に成功
  - `ch_前髪_baked` (単一MToonMaterial、side=0 FrontSide)
  - `ch_前髪_baked_1` (**2つのMToonMaterialの配列**、side=2 DoubleSide)
  - 配列のマテリアルを FrontSide に変更しても前髪は変化せず、**他のメッシュが影響を受けた**
- **推測**: MToonMaterialがメッシュ間で共有されている可能性があり、前髪のマテリアルを変更すると他のパーツにも影響が出る
- **次のステップ候補**:
  1. VRMモデル自体をBlenderで編集し、問題のメッシュ/マテリアルを削除・修正
  2. 前髪専用のマテリアルを複製してから side を変更（共有マテリアルを解除）
  3. レンダリング順序（renderOrder）を調整して影響を軽減

### 2.4 機能の拡張・統合 (Future Integration)
- 過去の会話にある「Lyric Motion Video」機能（歌詞アニメーション）の実装は、現在の `script.js` には含まれていない。
- 今後、3Dビューワーと歌詞演出を統合する場合、DOM要素（HTML/CSS）との連携や、演出用ライブラリ（Remotion等）との住み分け設計が必要。

---

## 3. 仕様書 (Specifications)

### 3.1 技術スタック (Tech Stack)
- **Core**: HTML5, CSS3, JavaScript (ES6 Modules)
- **3D Engine**: Three.js (r128+ equivalent, via Modules)
- **Loaders**:
  - `GLTFLoader` + `VRMLoaderPlugin` (for .vrm)
  - `FBXLoader` (for .fbx animations)
- **Computer Vision**: @mediapipe/face_mesh, @mediapipe/camera_utils

### 3.2 ディレクトリ構成 (Directory Structure)
```
AI3Dview/
├── index.html          # エントリーポイント (Viewer UI)
├── script.js           # メインロジック (Three.js, MediaPipe)
├── VRM/                # VRMモデル格納
│   └── kamuro.vrm
├── Motions/            # モーションデータ格納
│   └── dance.fbx
├── package.json        # 依存関係管理
└── ...
```

### 3.3 コア機能 (Core Features)
1.  **VRM Viewer**:
    - VRM 0.x / 1.0 モデルの読み込みと表示。
    - MToonシェーダーの適切なレンダリング。
2.  **Animation System**:
    - Mixamo形式のFBXアニメーション再生。
    - リアルタイムリターゲティング（ボーンマッピングと回転補正）。
3.  **User Interaction**:
    - ウェブカメラによるフェイストラッキング。
    - ユーザーの頭の動きに合わせた視線追従。
    - まばたきのミラーリング。

---

## 4. 追加実装・変更履歴 (Changelog)

### 4.1 MMD モデルへの切り替え - 🆕 2026-02-14〜
- **Three.js MMDLoader + MMDAnimationHelper** を採用
- `.pmx` モデル + `.vmd` モーション形式に移行
- **物理演算**: アムートフィジックス対応（`USE_PHYSICS` フラグで制御）
- ディレクトリ構成変更:
  ```
  Models/    ← .pmx ファイル
  Motions/   ← .vmd ファイル
  Videos/    ← 背景動画
  Background/ ← 背景テクスチャ
  ```

### 4.2 顔トラッキング HUD の追加 - 🆕 2026-02-23
- **HUD パネル**: 顔検出状態・X/Y/Z 座標・バーグラフをオーバーレイ表示
- **ランドマーク描画**: 顔の特徴点を canvas に描画
- **キーボードショートカット**:
  - `H` キー: HUD 表示/非表示トグル
  - `Space` キー: アニメーション一時停止/再開
- デフォルトは HUD **非表示**（`hudVisible = false`）

### 4.3 自動ファイル監視（Auto-Reload）- 🆕 2026-02-28
- **`vite.config.js`** にカスタムプラグイン `mmd-asset-watcher` を実装
- `Models/` と `Motions/` フォルダをリアルタイム監視（chokidar）
- ファイル追加・変更・削除時に Vite HMR (`mmd:asset-changed`) でブラウザへ通知
- `/__mmd_assets` エンドポイント: 現在のファイル一覧を JSON で提供
- `script.js` に `reloadMMD()` 関数: 旧モデルを破棄して新ファイルを自動ロード
- **有効範囲**: `npm run dev`（開発サーバー）起動時のみ

### 4.4 ブラウザアップロード UI（GitHub 公開対応）- 📋 計画中
- **目的**: GitHub Pages で公開するためアセットなしでも動作させる
- **仕様**:
  - 起動時にモデル未設定の場合、ドラッグ&ドロップ UI を表示
  - `.pmx` ファイル（モデル）と `.vmd` ファイル（モーション、複数可）を受け付ける
  - `URL.createObjectURL()` でブラウザメモリから直接ロード（サーバー送信なし）
  - ロード完了後、通常のビューワーとして動作
  - ページリロードでリセット（ファイルは保持されない）
- **UI イメージ**: 中央に PMX・VMD それぞれのドロップゾーン
- **GitHub Pages 対応**: `vite build` 成果物を `gh-pages` ブランチで配信

### 4.5 GitHub 公開準備 - 📋 計画中
- **`.gitignore` 更新**: `Models/`, `Motions/`, `Videos/` をアセット除外
- **`README.md` 作成**: セットアップ手順・使い方・技術スタック
- **`LICENSE` 追加**: MIT ライセンス
- **GitHub Pages デプロイ**: `vite build` → `gh-pages` ブランチへ公開
