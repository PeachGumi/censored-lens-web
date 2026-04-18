# Image Censor Studio

画像の顔にモザイク・目線（黒帯＋文字）・素材スタンプを重ねて編集し、1枚の画像として保存できるブラウザアプリです。  
ビルド不要の静的構成なので、ローカル確認も公開もシンプルです。

## 主な機能

- 顔検出による自動配置（モザイク＋目線）
- 手動追加（モザイク / 目線 / 素材）
- 移動・拡大縮小・回転編集
- 目線文字の編集（初期値: `BLOCKED`）
- PNG保存

## すぐに試す

`index.html` をブラウザで開くだけで動作します。  
（任意の静的サーバー配信でも可）

## 使い方

1. 画像をドラッグ&ドロップ、または「画像を選択」で読み込む
2. 「顔を検出してモザイク」を押して自動生成する
3. 必要に応じて `モザイク追加 / 目線追加 / 素材` で手動調整する
4. 効果オブジェクトを選択し、ドラッグで移動・四隅でサイズ変更・上部ハンドルで回転する
5. 目線の文字を変更したい場合は、目線オブジェクトを選択して編集欄に入力する
6. 不要なオブジェクトは `選択を削除`（または Delete / Backspace）で削除する
7. 「画像を保存」で書き出す

## 素材の追加方法

- 素材ファイル配置先: `materials/`
- マニフェスト: `materials/manifest.json`

追加手順:

1. `materials/` に画像ファイルを追加する
2. `materials/manifest.json` の `materials` 配列に素材情報を追記する
3. ページを再読み込みする

## 公開（静的ホスティング）

### GitHub Pages

1. このフォルダ内容をリポジトリに push
2. **Settings → Pages**
3. Source を **Deploy from a branch**
4. Branch: `main` / Folder: `/ (root)` を選択
5. 公開URLで確認

### Cloudflare Pages

1. Cloudflare Pages で **Create a project**
2. GitHub リポジトリを接続
3. Build settings:
   - Build command: *(空欄)*
   - Build output directory: `/`
4. Deploy

## Cloudflare Pages向けZIP作成

配布用ZIPを作るスクリプトを用意しています。

```bash
./deploy/make_cloudflare_zip.sh
```

生成物:

- `deploy/cloudflare-pages/`（ステージング）
- `deploy/censored-lens-web-cloudflare.zip`（配布ZIP）

不要ファイル（例: `.DS_Store`）を除外したうえで、公開に必要なファイルだけを含めます。

## モデル読み込みについて

- モデルは `./models` を優先して読み込み、失敗時にCDNへフォールバックします
- CDN制限環境では `models/` 同梱運用が安定です
- PCでは高精度モード（SSD）を優先利用します

同梱モデル（このリポジトリ）:

- `tiny_face_detector_model-*`
- `face_landmark_68_tiny_model-*`
- `ssd_mobilenetv1_model-*`

公開後は、画面の初期ステータスが `準備完了（高精度モード）` または `準備完了（軽量モード）` と表示されることを確認してください。

## 注意事項

- 初回はモデル読み込みに時間がかかる場合があります
- 検出精度は画像の解像度・顔の向き・明るさなどに依存します
