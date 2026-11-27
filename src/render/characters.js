// Character and corpse drawing: directional fedora figures, weapons, bars.

import { ctx } from './canvas.js';


export function drawDeadBody(body) {
  const alpha = Math.min(1, body.life / 3);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(body.x, body.y);

  // Expanding dark crimson blood pool beneath fallen body
  ctx.fillStyle = 'rgba(127, 29, 29, 0.82)';
  ctx.beginPath();
  ctx.ellipse(body.collapseDir * 3, 2, body.poolRadius, body.poolRadius * 0.56, body.tiltAngle, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = 'rgba(69, 10, 10, 0.9)';
  ctx.beginPath();
  ctx.ellipse(body.collapseDir * 2, 2, body.poolRadius * 0.62, body.poolRadius * 0.34, body.tiltAngle, 0, Math.PI * 2);
  ctx.fill();

  // Sideways collapsed character silhouette
  ctx.save();
  ctx.rotate(body.collapseDir * (Math.PI * 0.46) + body.tiltAngle);

  // Legs
  ctx.fillStyle = '#09090b';
  ctx.fillRect(-5, 3, 4, 12);
  ctx.fillRect(1, 3, 4, 12);

  // Suit torso
  ctx.fillStyle = body.coatColor;
  ctx.beginPath();
  ctx.roundRect(-8, -11, 16, 16, 4);
  ctx.fill();

  // Shirt & tie
  ctx.fillStyle = '#e4e4e7';
  ctx.fillRect(-2, -10, 4, 9);
  ctx.fillStyle = body.accentColor;
  ctx.fillRect(-1, -9, 2, 7);

  // Head with closed eyes
  ctx.fillStyle = '#eab38f';
  ctx.beginPath();
  ctx.arc(0, -17, 6.2, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#18181b';
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(-3.2, -17);
  ctx.lineTo(-1.0, -17);
  ctx.moveTo(1.0, -17);
  ctx.lineTo(3.2, -17);
  ctx.stroke();

  ctx.restore();

  // Knocked-off fedora hat resting nearby on the asphalt
  const hatX = -body.collapseDir * 17;
  const hatY = 5;
  ctx.fillStyle = body.isBoss ? '#18181b' : '#27272a';
  ctx.beginPath();
  ctx.ellipse(hatX, hatY, 8, 3.2, -0.25 * body.collapseDir, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(hatX - 4.5, hatY - 4.5, 9, 4.5);
  ctx.fillStyle = body.accentColor;
  ctx.fillRect(hatX - 4.5, hatY - 1.5, 9, 1.5);

  ctx.restore();
}

export function drawCharacter(x, y, config) {
  const {
    coatColor,
    accentColor,
    label,
    hp,
    maxHp,
    armor = 0,
    maxArmor = 0,
    facing = 0,
    isBoss = false,
    isUnderboss = false,
    isCaptain = false,
    isAttacking = false,
    slashProgress = 0,
    slashArc = 150 / 360,
    isMoving = false,
    walkPhase = 0,
    isShooting = false,
    hitFlash = false,
  } = config;

  const cosF = Math.cos(facing);
  const sinF = Math.sin(facing);
  const facingUp = sinF < -0.45;
  const horizShift = Math.max(-1, Math.min(1, cosF));

  ctx.save();
  ctx.translate(x, y);

  // Ground contact shadow
  ctx.fillStyle = 'rgba(0, 0, 0, 0.42)';
  ctx.beginPath();
  ctx.ellipse(0, 2, isBoss ? 13 : 11, 5.5, 0, 0, Math.PI * 2);
  ctx.fill();

  const walking = isMoving && !isAttacking;
  const step = walking ? Math.sin(walkPhase) : 0;
  const bob = walking ? Math.abs(step) * 1.2 : 0;
  ctx.save();
  ctx.translate(0, -bob);

  // Legs: alternate a small forward swing and foot lift while walking.
  const legSwing = walking ? step * 2.2 : 0;
  const liftL = walking ? Math.max(0, step) * 1.4 : 0;
  const liftR = walking ? Math.max(0, -step) * 1.4 : 0;
  ctx.fillStyle = '#09090b';
  ctx.fillRect(-5.5 + legSwing, -10 - liftL, 4.5, 11);
  ctx.fillRect(1 - legSwing, -10 - liftR, 4.5, 11);

  // Suit coat torso
  ctx.fillStyle = hitFlash ? '#ffffff' : coatColor;
  ctx.beginPath();
  ctx.roundRect(-9.5, -26, 19, 18, 5);
  ctx.fill();

  // Kevlar vest overlay if armored
  if (armor > 0) {
    ctx.fillStyle = 'rgba(14, 165, 233, 0.35)';
    ctx.strokeStyle = '#38bdf8';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.roundRect(-8.5, -25, 17, 14, 3);
    ctx.fill();
    ctx.stroke();
  }

  if (!facingUp) {
    // Shirt & tie shifted horizontally with facing direction
    const lapelX = horizShift * 2.4;
    ctx.fillStyle = '#f4f4f5';
    ctx.beginPath();
    ctx.moveTo(lapelX - 3, -25);
    ctx.lineTo(lapelX + 3, -25);
    ctx.lineTo(lapelX, -14);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = accentColor;
    ctx.fillRect(lapelX - 1, -24, 2, 9);
  } else {
    // Back coat center seam when moving away (up)
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -24);
    ctx.lineTo(0, -9);
    ctx.stroke();
  }

  // Head
  ctx.fillStyle = hitFlash ? '#ffffff' : '#f1c29b';
  ctx.beginPath();
  ctx.arc(0, -31.5, 6.8, 0, Math.PI * 2);
  ctx.fill();

  // Coherent Directional Eyes (Right -> right, Left -> left, Down -> center, Up -> hidden)
  if (!facingUp) {
    const eyeOffsetX = horizShift * 2.5;
    const eyeY = -31.2 + Math.max(0, sinF) * 0.8;

    // Eye whites
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(eyeOffsetX - 2.2, eyeY, 1.45, 1.15, 0, 0, Math.PI * 2);
    ctx.ellipse(eyeOffsetX + 2.2, eyeY, 1.45, 1.15, 0, 0, Math.PI * 2);
    ctx.fill();

    // Dark pupils tracking look direction
    const pupilShiftX = horizShift * 0.55;
    ctx.fillStyle = '#09090b';
    ctx.beginPath();
    ctx.arc(eyeOffsetX - 2.2 + pupilShiftX, eyeY, 0.85, 0, Math.PI * 2);
    ctx.arc(eyeOffsetX + 2.2 + pupilShiftX, eyeY, 0.85, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Back of hair when facing up
    ctx.fillStyle = '#18181b';
    ctx.beginPath();
    ctx.arc(0, -31.2, 6.6, Math.PI * 0.1, Math.PI * 0.9);
    ctx.fill();
  }

  // Fedora Hat (Bosses & Underbosses)
  if (isBoss || isUnderboss || isCaptain) {
    ctx.fillStyle = isBoss ? '#09090b' : '#18181b';
    ctx.beginPath();
    ctx.ellipse(0, -36.5, isBoss ? 11.5 : 10, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.roundRect(isBoss ? -6.5 : -5.5, -42.5, isBoss ? 13 : 11, 6.5, 2.5);
    ctx.fill();

    ctx.fillStyle = accentColor;
    ctx.fillRect(isBoss ? -6.5 : -5.5, -38.2, isBoss ? 13 : 11, 1.8);
  }

  // Weapon Rendering:
  // Bosses and underbosses have 9mm Pistol as main weapon, stow it to swing a Machete during slash,
  // and re-equip the pistol immediately after the slash completes.
  const hasPistolMain = isBoss || isUnderboss;
  if (isAttacking) {
    // Sweep the machete across the attacker's exact hit arc (facing ± halfArc).
    const halfArc = Math.PI * slashArc;
    const swingAngle = facing - halfArc + slashProgress * halfArc * 2;
    ctx.save();
    ctx.translate(0, -17);
    ctx.rotate(swingAngle);

    // Subtle thin curved blade trail
    ctx.strokeStyle = 'rgba(244, 63, 94, 0.52)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, 21, -0.55, 0.08);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.65)';
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.arc(0, 0, 22.5, -0.45, 0.05);
    ctx.stroke();

    // Machete grip & broad steel blade
    ctx.fillStyle = '#451a03';
    ctx.fillRect(6, -1.5, 5, 3);
    ctx.fillStyle = '#e4e4e7';
    ctx.beginPath();
    ctx.moveTo(11, -1.6);
    ctx.lineTo(24, -2.4);
    ctx.lineTo(26, 0.5);
    ctx.lineTo(11, 1.6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  } else if (hasPistolMain) {
    // 9mm Pistol equipped in hand
    ctx.save();
    ctx.translate(0, -17);
    ctx.rotate(facing);
    ctx.fillStyle = '#27272a';
    ctx.fillRect(7, -1.8, 10, 3.4);
    ctx.fillStyle = '#71717a';
    ctx.fillRect(8, -1.3, 8, 1.2);
    if (isShooting) {
      ctx.fillStyle = '#fef08a';
      ctx.beginPath();
      ctx.arc(19, 0, 4.2, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  } else {
    // Switchblade / bat ready for Captains & Soldiers
    ctx.save();
    ctx.translate(0, -17);
    ctx.rotate(facing);
    ctx.fillStyle = '#d4d4d8';
    ctx.fillRect(7, -1.1, 8, 2.2);
    ctx.restore();
  }

  ctx.restore();
  ctx.restore();

  // Overhead Rank/Boss Label, Armor Bar & HP Bar (anchored cleanly at state.world x, y)
  const hasArmor = armor > 0 && maxArmor > 0;
  const barW = isBoss ? 36 : 28;
  const barH = 3.5;
  const barTopY = y + (hasArmor ? -53 : -48);

  if (hasArmor) {
    ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
    ctx.fillRect(x - barW / 2 - 1, barTopY - 1, barW + 2, barH + 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(x - barW / 2, barTopY, barW * Math.max(0, Math.min(1, armor / maxArmor)), barH);
  }

  const hpY = hasArmor ? barTopY + 5 : barTopY;
  ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
  ctx.fillRect(x - barW / 2 - 1, hpY - 1, barW + 2, barH + 2);

  const hpRatio = Math.max(0, Math.min(1, hp / Math.max(1, maxHp)));
  ctx.fillStyle = hpRatio > 0.5 ? '#10b981' : hpRatio > 0.25 ? '#f59e0b' : '#ef4444';
  ctx.fillRect(x - barW / 2, hpY, barW * hpRatio, barH);

  if (label) {
    ctx.font = isBoss ? 'bold 10px Inter, sans-serif' : '700 9px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(9, 9, 11, 0.85)';
    ctx.fillText(label, x + 1, barTopY - 3);
    ctx.fillStyle = isBoss ? '#fef08a' : accentColor;
    ctx.fillText(label, x, barTopY - 4);
  }
}
