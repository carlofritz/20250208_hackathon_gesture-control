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

function toCanvasPoint(point, width, height, mirror) {
  const x = mirror ? (1 - point.x) * width : point.x * width;
  const y = point.y * height;
  return { x, y };
}

function colorForHand(handedness) {
  const side = String(handedness || "").toLowerCase();
  if (side.includes("left")) return "#ff8e4f";
  if (side.includes("right")) return "#4fd1b8";
  return "#b8c5be";
}

export function drawOverlay({ canvas, hands, mirror = true }) {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const width = canvas.width;
  const height = canvas.height;

  ctx.clearRect(0, 0, width, height);

  for (const hand of hands) {
    const color = colorForHand(hand.handedness);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;

    for (const [startIdx, endIdx] of HAND_CONNECTIONS) {
      const start = toCanvasPoint(hand.landmarks[startIdx], width, height, mirror);
      const end = toCanvasPoint(hand.landmarks[endIdx], width, height, mirror);

      ctx.beginPath();
      ctx.moveTo(start.x, start.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }

    ctx.fillStyle = color;
    for (const point of hand.landmarks) {
      const canvasPoint = toCanvasPoint(point, width, height, mirror);
      ctx.beginPath();
      ctx.arc(canvasPoint.x, canvasPoint.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }

    const labelPoint = toCanvasPoint(hand.landmarks[0], width, height, mirror);
    const gestureText = hand.gestures.length ? hand.gestures.join(", ") : "none";
    const label = `${hand.handedness}: ${gestureText}`;

    ctx.font = "600 14px 'Space Grotesk', sans-serif";
    const textWidth = ctx.measureText(label).width;

    ctx.fillStyle = "rgba(0, 0, 0, 0.65)";
    ctx.fillRect(labelPoint.x - 6, labelPoint.y - 28, textWidth + 12, 22);
    ctx.fillStyle = "#fff";
    ctx.fillText(label, labelPoint.x, labelPoint.y - 12);
  }
}
