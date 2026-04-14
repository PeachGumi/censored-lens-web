# Image Censor Studio

ブラウザ上で画像の顔を検出し、モザイク＋目線 `BLOCKED` を入れられる静的Webアプリです。  
ドラッグ&ドロップ対応で、ビルド不要のため GitHub Pages / Cloudflare Pages にそのまま公開できます。

## ローカル確認

`index.html` をブラウザで開くだけで動作します。  
（または任意の静的サーバーで配信）

## 使い方

1. 画像をドラッグ&ドロップ（または「画像を選択」）
2. 「顔を検出してモザイク」で自動生成
3. 必要に応じて「目線 BLOCKED」を切り替え
4. `モザイク追加 / 目線追加` で手動追加、ドラッグで移動、四隅ハンドルでサイズ変更
5. 回転スライダーまたは枠上部の回転ハンドルで角度調整
6. `選択を削除` または Deleteキーで削除
7. 「画像を保存」でダウンロード

## GitHub Pages で公開

1. この `censored-lens-web` フォルダ内容を新規リポジトリへ push
2. GitHub の **Settings → Pages**
3. Source を **Deploy from a branch**
4. Branch を `main` / Folder を `/ (root)` に設定
5. 数分後に公開URLが発行されます

## Cloudflare Pages で公開

1. Cloudflare Pages で「Create a project」
2. GitHub リポジトリを接続
3. Build settings:
   - Build command: *(空欄)*
   - Build output directory: `/`
4. Deploy

## 注意

- 顔検出モデルは CDN から読み込みます（初回は少し時間がかかります）。
- 検出精度は画像内容・顔の角度・解像度によって変わります。

## モデル読み込み失敗への対策（推奨）

CDNがブロックされる環境では、`models/` にモデルを同梱すると安定します。  
アプリは `./models` を最優先で読み込み、失敗時にCDNへフォールバックします。

### このリポジトリの同梱モデル

- `tiny_face_detector_model-*`（軽量）
- `face_landmark_68_tiny_model-*`（ランドマーク）
- `ssd_mobilenetv1_model-*`（PC向け高精度）

PCでは高精度モード（SSD）を優先利用する実装です。  
GitHub Pages で公開後、画面の初期ステータスが `準備完了（高精度モード）` と表示されることを確認してください。
