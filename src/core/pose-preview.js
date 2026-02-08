const HAND_CONNECTIONS = [
  [0, 1],
  [1, 2],
  [2, 3],
  [3, 4],
  [0, 5],
  [5, 6],
  [6, 7],
  [7, 8],
  [5, 9],
  [9, 10],
  [10, 11],
  [11, 12],
  [9, 13],
  [13, 14],
  [14, 15],
  [15, 16],
  [13, 17],
  [17, 18],
  [18, 19],
  [19, 20],
  [0, 17],
];

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function drawEmpty(canvas, text) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f1a15";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
  ctx.font = "600 12px 'Space Grotesk', sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
}

function handBounds(landmarks) {
  let minX = 1;
  let maxX = 0;
  let minY = 1;
  let maxY = 0;

  for (const point of landmarks) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }

  return { minX, maxX, minY, maxY };
}

function mapPointToPreview(point, cropBounds, canvas, mirror) {
  const rangeX = Math.max(1e-6, cropBounds.maxX - cropBounds.minX);
  const rangeY = Math.max(1e-6, cropBounds.maxY - cropBounds.minY);

  const ux = clamp(((point.x ?? 0) - cropBounds.minX) / rangeX, 0, 1);
  const uy = clamp(((point.y ?? 0) - cropBounds.minY) / rangeY, 0, 1);

  return {
    x: mirror ? (1 - ux) * canvas.width : ux * canvas.width,
    y: uy * canvas.height,
  };
}

function drawPreviewSkeleton({ ctx, canvas, hand, cropBounds, mirror }) {
  if (!hand?.landmarks?.length) {
    return;
  }

  ctx.strokeStyle = "rgba(79, 209, 184, 0.95)";
  ctx.lineWidth = 2.2;

  for (const [start, end] of HAND_CONNECTIONS) {
    const a = mapPointToPreview(hand.landmarks[start], cropBounds, canvas, mirror);
    const b = mapPointToPreview(hand.landmarks[end], cropBounds, canvas, mirror);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.fillStyle = "rgba(255, 200, 120, 0.96)";
  for (const point of hand.landmarks) {
    const p = mapPointToPreview(point, cropBounds, canvas, mirror);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function drawLivePosePreview({ canvas, video, hand, mirror = true, drawSkeleton = false }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  if (!hand || !video.videoWidth || !video.videoHeight) {
    drawEmpty(canvas, "No hand");
    return;
  }

  const bounds = handBounds(hand.landmarks);
  const padding = 0.12;

  const minX = clamp(bounds.minX - padding, 0, 1);
  const maxX = clamp(bounds.maxX + padding, 0, 1);
  const minY = clamp(bounds.minY - padding, 0, 1);
  const maxY = clamp(bounds.maxY + padding, 0, 1);

  const sourceWidth = Math.max(2, (maxX - minX) * video.videoWidth);
  const sourceHeight = Math.max(2, (maxY - minY) * video.videoHeight);
  const sx = minX * video.videoWidth;
  const sy = minY * video.videoHeight;
  const cropBounds = { minX, maxX, minY, maxY };

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f1a15";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  if (mirror) {
    ctx.save();
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }

  ctx.drawImage(video, sx, sy, sourceWidth, sourceHeight, 0, 0, canvas.width, canvas.height);

  if (mirror) {
    ctx.restore();
  }

  ctx.strokeStyle = "#4fd1b8";
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);

  if (drawSkeleton) {
    drawPreviewSkeleton({
      ctx,
      canvas,
      hand,
      cropBounds,
      mirror,
    });
  }
}

export function drawStoredPosePreview({ canvas, pose, mirror = true }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  if (!pose?.estimation?.normalizedLandmarks?.length) {
    drawEmpty(canvas, "Empty slot");
    return;
  }

  const landmarks = pose.estimation.normalizedLandmarks;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#0f1a15";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const scale = Math.min(canvas.width, canvas.height) * 0.34;
  const cx = canvas.width / 2;
  const cy = canvas.height / 2;

  function pointToCanvas(point) {
    const x = mirror ? cx - point.x * scale : cx + point.x * scale;
    const y = cy + point.y * scale;
    return { x, y };
  }

  ctx.strokeStyle = "#4fd1b8";
  ctx.lineWidth = 1.5;

  for (const [start, end] of HAND_CONNECTIONS) {
    const a = pointToCanvas(landmarks[start]);
    const b = pointToCanvas(landmarks[end]);

    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  ctx.fillStyle = "#ff8e4f";
  for (const point of landmarks) {
    const p = pointToCanvas(point);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
    ctx.fill();
  }
}
