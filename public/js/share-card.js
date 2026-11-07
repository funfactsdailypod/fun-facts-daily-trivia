import { BADGES, SHOW_CONFIG } from './config.js';
import { formatPubDate } from './audio-player.js';

function drawRoundedRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function drawMemphisBox(ctx, x, y, w, h, r, fill, shadowOffset = 10) {
  if (shadowOffset > 0) {
    drawRoundedRect(ctx, x + shadowOffset, y + shadowOffset, w, h, r);
    ctx.fillStyle = '#181824';
    ctx.fill();
  }
  drawRoundedRect(ctx, x, y, w, h, r);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#181824';
  ctx.stroke();
}

function wrapCenteredText(ctx, text, cx, startY, maxWidth, lineHeight, maxLines = 2) {
  const words = String(text || '').split(/\s+/);
  const lines = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);

  const clamped = lines.slice(0, maxLines);
  if (lines.length > maxLines) {
    clamped[maxLines - 1] = clamped[maxLines - 1].replace(/\.*$/, '…');
  }

  clamped.forEach((line, idx) => {
    ctx.fillText(line, cx, startY + idx * lineHeight);
  });
  return startY + clamped.length * lineHeight;
}

/**
 * Renders a 1080x1080 Memphis Design Social Media Score Card onto the given <canvas>.
 */
export function renderScoreCardCanvas(canvas, { playerState, episode = null, attempt = null } = {}) {
  const W = 1080;
  const H = 1080;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // 1. Warm Sunlit Background + Memphis Polka-Dot Pattern
  const bgGrad = ctx.createLinearGradient(0, 0, W, H);
  bgGrad.addColorStop(0, '#FFF6D6');
  bgGrad.addColorStop(0.55, '#FFE596');
  bgGrad.addColorStop(1, '#FFC947');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  ctx.fillStyle = 'rgba(24, 24, 36, 0.08)';
  for (let gx = 36; gx < W; gx += 48) {
    for (let gy = 36; gy < H; gy += 48) {
      ctx.beginPath();
      ctx.arc(gx, gy, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Decorative Memphis Corner Shapes
  ctx.save();
  ctx.strokeStyle = '#FF7A00';
  ctx.lineWidth = 14;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(64, 98);
  ctx.bezierCurveTo(92, 62, 120, 62, 148, 98);
  ctx.bezierCurveTo(176, 134, 204, 134, 232, 98);
  ctx.stroke();

  // Teal Donut Top-Right
  ctx.strokeStyle = '#00BFA6';
  ctx.lineWidth = 20;
  ctx.beginPath();
  ctx.arc(976, 108, 38, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = '#181824';
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(976, 108, 49, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();

  // 2. Main Outer Card Frame
  drawMemphisBox(ctx, 56, 56, W - 112, H - 112, 42, '#FFFDF7', 14);

  // Striped Memphis Top Ribbon inside Main Card
  const stripeColors = ['#FFD23F', '#FF7A00', '#00BFA6', '#FF4D6D', '#4CC9F0'];
  const stripeW = (W - 220) / stripeColors.length;
  stripeColors.forEach((col, i) => {
    ctx.fillStyle = col;
    ctx.fillRect(110 + i * stripeW, 59, stripeW, 16);
  });

  // 3. Brand Header Pill
  drawMemphisBox(ctx, 270, 108, 540, 66, 33, '#FFD23F', 6);
  ctx.fillStyle = '#181824';
  ctx.font = '800 27px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('💡 FUN FACTS DAILY • TRIVIA', W / 2, 142);

  // 4. Episode / Daily Double Headline Box
  drawMemphisBox(ctx, 104, 206, W - 208, 256, 28, '#FFF6DC', 8);

  if (episode && attempt) {
    const isCorrect = Boolean(attempt.correct);
    const pillColor = isCorrect ? '#D8F8E8' : '#FFE8B3';
    const pillText = isCorrect
      ? `⚡ DAILY DOUBLE NAILED! +${SHOW_CONFIG.points.dailyDouble} PTS`
      : '💡 TODAY’S FUN FACT UNLOCKED!';

    drawMemphisBox(ctx, 250, 230, 580, 56, 28, pillColor, 4);
    ctx.fillStyle = '#181824';
    ctx.font = '800 24px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(pillText, W / 2, 259);

    ctx.fillStyle = '#181824';
    ctx.font = '700 38px "Fredoka", "Plus Jakarta Sans", system-ui, sans-serif';
    wrapCenteredText(ctx, episode.title, W / 2, 332, W - 280, 44, 2);

    // Spoiler-free 4-option visual grid (shows pick accuracy without spoiling answer text!)
    const tileY = 402;
    const tileSize = 36;
    const gap = 16;
    const startX = W / 2 - (4 * tileSize + 3 * gap) / 2;
    for (let i = 0; i < 4; i++) {
      let fill = '#FFFFFF';
      if (i === episode.correctIndex && isCorrect) fill = '#00BFA6';
      else if (i === attempt.selectedIndex && !isCorrect) fill = '#FF5C5C';
      else if (i === episode.correctIndex && !isCorrect) fill = '#FFD23F';
      drawMemphisBox(ctx, startX + i * (tileSize + gap), tileY, tileSize, tileSize, 9, fill, 3);
    }

    ctx.fillStyle = '#5C5C74';
    ctx.font = '700 21px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(formatPubDate(episode.pubDate), W / 2, 448);
  } else {
    drawMemphisBox(ctx, 290, 232, 500, 54, 27, '#FF7A00', 4);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 24px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText('🏆 ALL-TIME LISTENER SCORECARD', W / 2, 260);

    ctx.fillStyle = '#181824';
    ctx.font = '700 42px "Fredoka", "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText('Testing My Daily Curiosity!', W / 2, 344);

    ctx.fillStyle = '#5C5C74';
    ctx.font = '700 25px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText('400+ Episodes of Family-Friendly Fun Facts', W / 2, 405);
  }

  // 5. Three Big Stat Cards (Streak | Points | Explored)
  const stats = [
    {
      icon: '🔥',
      value: `${playerState.currentStreak}`,
      label: 'DAY STREAK',
      sub: `Best: ${playerState.bestStreak}`,
      bg: '#FFE5B4'
    },
    {
      icon: '⭐',
      value: playerState.totalPoints.toLocaleString(),
      label: 'TOTAL POINTS',
      sub: 'Running Tally',
      bg: '#FFF3B0'
    },
    {
      icon: '🧭',
      value: `${(playerState.seenArchiveGuids?.length || 0) + Object.keys(playerState.dailyAttempts || {}).length}`,
      label: 'QUESTIONS PLAYED',
      sub: 'Archive + Daily',
      bg: '#D8F8E8'
    }
  ];

  const cardW = 272;
  const cardGap = 28;
  const cardsStartX = (W - (cardW * 3 + cardGap * 2)) / 2;
  stats.forEach((st, idx) => {
    const x = cardsStartX + idx * (cardW + cardGap);
    const y = 496;
    drawMemphisBox(ctx, x, y, cardW, 206, 24, st.bg, 7);

    ctx.fillStyle = '#181824';
    ctx.font = '40px system-ui, sans-serif';
    ctx.fillText(st.icon, x + cardW / 2, y + 44);

    ctx.font = '700 54px "Fredoka", "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(st.value, x + cardW / 2, y + 108);

    ctx.font = '800 20px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(st.label, x + cardW / 2, y + 154);

    ctx.fillStyle = '#4B4B63';
    ctx.font = '700 18px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(st.sub, x + cardW / 2, y + 182);
  });

  // 6. Unlocked Badges Showcase Shelf
  const unlockedIds = Object.keys(playerState.unlockedBadges || {});
  const earnedBadges = BADGES.filter((b) => unlockedIds.includes(b.id));

  drawMemphisBox(ctx, 104, 736, W - 208, 148, 24, '#FFFFFF', 6);
  ctx.fillStyle = '#181824';
  ctx.font = '800 21px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    `🏅 ACHIEVEMENT BADGES EARNED (${earnedBadges.length} / ${BADGES.length})`,
    W / 2,
    768
  );

  const badgeSlotSize = 54;
  const badgeGap = 14;
  const totalSlots = BADGES.length;
  const shelfStartX = (W - (totalSlots * badgeSlotSize + (totalSlots - 1) * badgeGap)) / 2;
  BADGES.forEach((b, idx) => {
    const bx = shelfStartX + idx * (badgeSlotSize + badgeGap);
    const by = 798;
    const isEarned = unlockedIds.includes(b.id);
    drawMemphisBox(ctx, bx, by, badgeSlotSize, badgeSlotSize, 14, isEarned ? b.color : '#ECECF4', isEarned ? 3 : 0);
    ctx.save();
    if (!isEarned) ctx.globalAlpha = 0.28;
    ctx.font = '28px system-ui, sans-serif';
    ctx.fillText(b.icon, bx + badgeSlotSize / 2, by + badgeSlotSize / 2 + 2);
    ctx.restore();
  });

  // 7. Bottom Call-to-Action Banner
  drawMemphisBox(ctx, 160, 916, W - 320, 72, 36, '#FF7A00', 6);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 26px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('🎙️ Play & Listen Free • funfactsdailypod.com', W / 2, 953);
}

export function buildShareCaption({ playerState, episode = null, attempt = null }) {
  if (episode && attempt) {
    const mark = attempt.correct ? '🟨✅ (+20 pts)' : '🟨💡';
    return [
      `Fun Facts Daily Trivia 💡 (${formatPubDate(episode.pubDate)})`,
      `${episode.title}: ${mark}`,
      `🔥 ${playerState.currentStreak}-Day Streak | ⭐ ${playerState.totalPoints.toLocaleString()} Pts`,
      `Play & listen free: https://www.funfactsdailypod.com`
    ].join('\n');
  }
  const badgeCount = Object.keys(playerState.unlockedBadges || {}).length;
  return [
    `My Fun Facts Daily Trivia Scorecard 💡`,
    `🔥 Streak: ${playerState.currentStreak} | ⭐ Points: ${playerState.totalPoints.toLocaleString()} | 🏅 Badges: ${badgeCount}/${BADGES.length}`,
    `Play & listen free: https://www.funfactsdailypod.com`
  ].join('\n');
}

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not generate score card image.'));
    }, 'image/png');
  });
}
