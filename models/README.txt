Place face-api model files here for offline/reliable loading.

Required files (at minimum):
- tiny_face_detector_model-weights_manifest.json
- tiny_face_detector_model-shard1
- face_landmark_68_tiny_model-weights_manifest.json
- face_landmark_68_tiny_model-shard1

Optional (for high-accuracy SSD mode):
- ssd_mobilenetv1_model-weights_manifest.json
- ssd_mobilenetv1_model-shard1
- ssd_mobilenetv1_model-shard2

When these files exist under ./models, the app will try local load first.
