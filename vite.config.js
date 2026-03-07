import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';

// ============================================================
// Vite Plugin: MMD Asset Watcher
// Models/ と Motions/ フォルダのファイル変更を監視し、
// HMR 経由でブラウザに通知する
// ============================================================
function mmdAssetWatcher() {
    const WATCH_DIRS = ['Models', 'Motions'];

    return {
        name: 'mmd-asset-watcher',

        configureServer(server) {
            // 監視対象のファイル一覧を取得するユーティリティ
            function getAssetList() {
                const result = {};
                for (const dir of WATCH_DIRS) {
                    const dirPath = path.resolve(dir);
                    try {
                        const files = fs.readdirSync(dirPath)
                            .filter(f => !f.startsWith('.') && fs.statSync(path.join(dirPath, f)).isFile())
                            .map(f => `./${dir}/${f}`);
                        result[dir] = files;
                    } catch {
                        result[dir] = [];
                    }
                }
                return result;
            }

            // カスタム API エンドポイント: 現在のファイル一覧を JSON で返す
            server.middlewares.use('/__mmd_assets', (req, res) => {
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(getAssetList()));
            });

            // chokidar でフォルダを監視
            for (const dir of WATCH_DIRS) {
                const dirPath = path.resolve(dir);
                if (!fs.existsSync(dirPath)) continue;

                server.watcher.add(dirPath);
            }

            // ファイル追加・変更・削除 イベントをブラウザへ送信
            const notify = (eventName, filePath) => {
                const rel = path.relative(process.cwd(), filePath).replace(/\\/g, '/');
                const isModel = rel.startsWith('Models/');
                const isMotion = rel.startsWith('Motions/');
                if (!isModel && !isMotion) return;

                const assetType = isModel ? 'model' : 'motion';
                console.log(`\n[MMD Watcher] 🔄 ${eventName}: ${rel} (${assetType})\n`);

                // HMR カスタムイベントをブラウザへ送信
                server.hot.send('mmd:asset-changed', {
                    event: eventName,
                    path: rel,
                    assetType,
                    assets: getAssetList(),
                });
            };

            server.watcher.on('add', (fp) => notify('add', fp));
            server.watcher.on('change', (fp) => notify('change', fp));
            server.watcher.on('unlink', (fp) => notify('unlink', fp));
        },
    };
}

export default defineConfig({
    base: '/3DViewMMD/',
    plugins: [mmdAssetWatcher()],
    // Models/ Motions/ 配下のファイルを静的アセットとして提供
    assetsInclude: ['**/*.pmx', '**/*.vmd', '**/*.bmp', '**/*.spa', '**/*.sph'],
    server: {
        // ファイル変更時にページ全体をリロードしない（HMR のみ）
        watch: {
            // vite デフォルトの .js/.html 変更による full-reload は維持しつつ
            // Models/ Motions/ は手動制御するため ignored には入れない
        },
    },
});
