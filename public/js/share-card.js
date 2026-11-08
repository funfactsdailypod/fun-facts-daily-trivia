import { BADGES, SHOW_CONFIG } from './config.js';
import { formatPubDate } from './audio-player.js';
import { getAnsweredGuidsSet } from './storage.js';

let cachedLogoImg = null;
if (typeof Image !== 'undefined') {
  const img = new Image();
  img.onload = () => {
    cachedLogoImg = img;
  };
  img.src = './icons/logo-192.png';
}

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

  // 3. Brand Header Pill + Podcast Logo
  drawMemphisBox(ctx, 235, 102, 610, 74, 37, '#FFD23F', 6);
  if (cachedLogoImg) {
    ctx.save();
    drawRoundedRect(ctx, 250, 111, 56, 56, 14);
    ctx.clip();
    ctx.drawImage(cachedLogoImg, 250, 111, 56, 56);
    ctx.restore();
    ctx.save();
    drawRoundedRect(ctx, 250, 111, 56, 56, 14);
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#181824';
    ctx.stroke();
    ctx.restore();
  }
  ctx.fillStyle = '#181824';
  ctx.font = '800 27px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('FUN FACTS DAILY • TRIVIA', cachedLogoImg ? W / 2 + 28 : W / 2, 140);

  // 4. Episode / Daily Double Headline Box
  drawMemphisBox(ctx, 104, 200, W - 208, 252, 28, '#FFF6DC', 8);

  if (episode && attempt) {
    const isCorrect = Boolean(attempt.correct);
    const pillColor = isCorrect ? '#D8F8E8' : '#FFE8B3';
    const pillText = isCorrect
      ? `⚡ DAILY DOUBLE NAILED! +${SHOW_CONFIG.points.dailyDouble} PTS`
      : '💡 TODAY’S FUN FACT UNLOCKED!';

    drawMemphisBox(ctx, 250, 222, 580, 54, 27, pillColor, 4);
    ctx.fillStyle = '#181824';
    ctx.font = '800 24px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(pillText, W / 2, 250);

    ctx.fillStyle = '#181824';
    ctx.font = '700 37px "Fredoka", "Plus Jakarta Sans", system-ui, sans-serif';
    wrapCenteredText(ctx, episode.title, W / 2, 322, W - 280, 42, 2);

    const tileY = 388;
    const tileSize = 34;
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
    ctx.font = '700 20px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(formatPubDate(episode.pubDate), W / 2, 434);
  } else {
    drawMemphisBox(ctx, 290, 224, 500, 54, 27, '#FF7A00', 4);
    ctx.fillStyle = '#FFFFFF';
    ctx.font = '800 24px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText('🏆 ALL-TIME LISTENER SCORECARD', W / 2, 252);

    ctx.fillStyle = '#181824';
    ctx.font = '700 42px "Fredoka", "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText('Testing My Daily Curiosity!', W / 2, 336);

    ctx.fillStyle = '#5C5C74';
    ctx.font = '700 25px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText('400+ Episodes of Family-Friendly Fun Facts', W / 2, 398);
  }

  // 5. Three Big Stat Cards (Streak | Points | Questions Played)
  const answeredTotal = getAnsweredGuidsSet(playerState).size;
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
      value: `${answeredTotal}`,
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
    const y = 478;
    drawMemphisBox(ctx, x, y, cardW, 192, 24, st.bg, 7);

    ctx.fillStyle = '#181824';
    ctx.font = '38px system-ui, sans-serif';
    ctx.fillText(st.icon, x + cardW / 2, y + 40);

    ctx.font = '700 50px "Fredoka", "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(st.value, x + cardW / 2, y + 98);

    ctx.font = '800 19px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(st.label, x + cardW / 2, y + 142);

    ctx.fillStyle = '#4B4B63';
    ctx.font = '700 17px "Plus Jakarta Sans", system-ui, sans-serif';
    ctx.fillText(st.sub, x + cardW / 2, y + 168);
  });

  // 6. Unlocked Badges Showcase Shelf (2 Balanced Rows for 17 Badges)
  const unlockedIds = Object.keys(playerState.unlockedBadges || {});
  const earnedBadges = BADGES.filter((b) => unlockedIds.includes(b.id));

  drawMemphisBox(ctx, 104, 696, W - 208, 198, 24, '#FFFFFF', 6);
  ctx.fillStyle = '#181824';
  ctx.font = '800 20px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText(
    `🏅 ACHIEVEMENT BADGES EARNED (${earnedBadges.length} / ${BADGES.length})`,
    W / 2,
    726
  );

  const rowSplit = Math.ceil(BADGES.length / 2);
  const rows = [BADGES.slice(0, rowSplit), BADGES.slice(rowSplit)];
  const badgeSlotSize = 48;
  const badgeGap = 14;

  rows.forEach((rowBadges, rIdx) => {
    const rowWidth = rowBadges.length * badgeSlotSize + (rowBadges.length - 1) * badgeGap;
    const rowStartX = (W - rowWidth) / 2;
    const by = 752 + rIdx * 64;
    rowBadges.forEach((b, idx) => {
      const bx = rowStartX + idx * (badgeSlotSize + badgeGap);
      const isEarned = unlockedIds.includes(b.id);
      drawMemphisBox(ctx, bx, by, badgeSlotSize, badgeSlotSize, 13, isEarned ? b.color : '#ECECF4', isEarned ? 3 : 0);
      ctx.save();
      if (!isEarned) ctx.globalAlpha = 0.28;
      ctx.font = '25px system-ui, sans-serif';
      ctx.fillText(b.icon, bx + badgeSlotSize / 2, by + badgeSlotSize / 2 + 2);
      ctx.restore();
    });
  });

  // 7. Bottom Call-to-Action Banner
  drawMemphisBox(ctx, 160, 918, W - 320, 70, 35, '#FF7A00', 6);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = '800 26px "Plus Jakarta Sans", system-ui, sans-serif';
  ctx.fillText('🎙️ Play & Listen Free • funfactsdailypod.com', W / 2, 954);
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
